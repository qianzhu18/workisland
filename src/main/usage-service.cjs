"use strict";

/**
 * PRD-015 T4：用量聚合与查询。
 *
 * 只消费 StatsService 的聚合 token 记录（不读 prompt/transcript/目录/密钥，
 * ADR-0004 local-first 边界）。所有成本为整数微美元；定价缺失的 token
 * 单列为 unknownCostTokens，绝不折算成 0。
 *
 * 会话分类（保守初版阈值，待真实数据校准，PRD-015 风险 3）：
 *   automation —— 带 remote 标记的会话（远程 agent 自动化）
 *   marathon   —— 活跃跨度 ≥ 60min 或总 token ≥ 200k
 *   quick      —— 活跃跨度 < 10min 且总 token < 50k
 *   standard   —— 其余
 * peak context 为估计值：会话内单条记录的 input+cacheRead+cacheCreation 峰值。
 */

const DAY = 24 * 60 * 60 * 1e3;
const MAX_DAYS = 90;
const QUICK_MAX_MS = 10 * 60 * 1e3;
const QUICK_MAX_TOKENS = 5e4;
const MARATHON_MIN_MS = 60 * 60 * 1e3;
const MARATHON_MIN_TOKENS = 2e5;

function emptyBucket() {
  return {
    sessionCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costMicroUsd: 0,
    unknownCostTokens: 0
  };
}

function addToBucket(bucket, tokens) {
  bucket.inputTokens += tokens.inputTokens ?? 0;
  bucket.outputTokens += tokens.outputTokens ?? 0;
  bucket.cacheReadTokens += tokens.cacheReadTokens ?? 0;
  bucket.cacheCreationTokens += tokens.cacheCreationTokens ?? 0;
  bucket.costMicroUsd += tokens.costMicroUsd ?? 0;
  bucket.unknownCostTokens += tokens.unknownCostTokens ?? 0;
}

function totalTokensOf(record) {
  return (record.inputTokens ?? 0) + (record.outputTokens ?? 0) + (record.cacheReadTokens ?? 0) + (record.cacheCreationTokens ?? 0);
}

class UsageService {
  /** statsService / pricing 可注入（测试）。 */
  constructor({ statsService, pricing, now = Date.now } = {}) {
    this.statsService = statsService;
    this.pricing = pricing;
    this.now = now;
    this.listeners = new Set();
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emitChange() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (e) {
        console.error("[UsageService] onChange listener threw:", e);
      }
    }
  }

  normalizeDays(days) {
    const n = Math.round(Number(days));
    if (!Number.isFinite(n)) return 7;
    return Math.min(MAX_DAYS, Math.max(1, n));
  }

  /** 本地时区日期键（PRD 验收：时区正确的按日分桶）。 */
  localDateKey(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  startOfLocalDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /** 给 token 记录补上成本字段（pricing 可能缺席 -> 全部 unknown）。 */
  costAwareTokens(record) {
    if (this.pricing) {
      const cost = this.pricing.costFor(record);
      return {
        ...record,
        costMicroUsd: cost.costMicroUsd === null ? 0 : cost.costMicroUsd,
        unknownCost: cost.unknown,
        unknownCostTokens: cost.unknown ? cost.unknownTokens : 0
      };
    }
    return {
      ...record,
      costMicroUsd: 0,
      unknownCost: true,
      unknownCostTokens: totalTokensOf(record)
    };
  }

  /**
   * 按日 / 每 Agent / 每模型聚合。
   * days: 1..90（默认 7），按本地时区分桶，含每日全零填充。
   */
  getUsageSummary({ days } = {}) {
    const rangeDays = this.normalizeDays(days);
    const now = this.now();
    const startOfToday = this.startOfLocalDay(now);
    const cutoff = startOfToday - (rangeDays - 1) * DAY;

    const dates = [];
    for (let i = rangeDays - 1; i >= 0; i--) {
      dates.push(this.localDateKey(startOfToday - i * DAY));
    }
    const dayIndex = new Map(dates.map((d, i) => [d, i]));

    const sessions = this.statsService.sessions.filter((r) => r.completedAt >= cutoff);
    const tokens = this.statsService.tokens
      .filter((r) => r.timestamp >= cutoff)
      .map((r) => this.costAwareTokens(r));

    const byDay = dates.map((date) => ({ date, ...emptyBucket() }));
    const byAgent = new Map();
    const byModel = new Map();
    const totals = emptyBucket();
    let remoteTokens = 0;
    let remoteRecords = 0;

    const bucketFor = (map, key) => {
      let b = map.get(key);
      if (!b) {
        b = { key, ...emptyBucket() };
        map.set(key, b);
      }
      return b;
    };

    for (const record of tokens) {
      const dateKey = this.localDateKey(record.timestamp);
      const idx = dayIndex.get(dateKey);
      if (idx === undefined) continue;
      addToBucket(byDay[idx], record);
      addToBucket(bucketFor(byAgent, record.tool), record);
      addToBucket(bucketFor(byModel, record.model || "unknown"), record);
      addToBucket(totals, record);
      if (record.isRemote) {
        remoteTokens += totalTokensOf(record);
        remoteRecords += 1;
      }
    }
    for (const r of sessions) {
      const idx = dayIndex.get(this.localDateKey(r.completedAt));
      if (idx === undefined) continue;
      byDay[idx].sessionCount += 1;
    }

    const totalBucketTokens = (b) => b.inputTokens + b.outputTokens + b.cacheReadTokens + b.cacheCreationTokens;
    const sortDesc = (a, b) => b.costMicroUsd - a.costMicroUsd || totalBucketTokens(b) - totalBucketTokens(a);

    return {
      days: rangeDays,
      generatedAt: now,
      totals: { ...totals, sessionCount: sessions.length },
      byDay,
      byAgent: Array.from(byAgent.values()).sort(sortDesc).map(({ key, ...rest }) => ({ tool: key, ...rest })),
      byModel: Array.from(byModel.values()).sort(sortDesc).map(({ key, ...rest }) => ({ model: key, ...rest })),
      remote: { tokens: remoteTokens, records: remoteRecords },
      pricing: this.pricing ? { source: "litellm", fetchedAt: this.pricing.lastFetchedAt ?? null } : null
    };
  }

  /** 会话维度洞察：output token / peak context / 时长 / 分类。 */
  getSessionInsights({ days } = {}) {
    const rangeDays = this.normalizeDays(days);
    const now = this.now();
    const cutoff = this.startOfLocalDay(now) - (rangeDays - 1) * DAY;

    const tokenRecords = this.statsService.tokens.filter((r) => r.timestamp >= cutoff);
    const bySession = new Map();
    for (const record of tokenRecords) {
      let s = bySession.get(record.sessionId);
      if (!s) {
        s = {
          sessionId: record.sessionId,
          tool: record.tool,
          model: record.model || "unknown",
          firstTokenAt: record.timestamp,
          lastTokenAt: record.timestamp,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          peakContextTokens: 0,
          isRemote: false,
          recordCount: 0
        };
        bySession.set(record.sessionId, s);
      }
      s.lastTokenAt = Math.max(s.lastTokenAt, record.timestamp);
      s.inputTokens += record.inputTokens ?? 0;
      s.outputTokens += record.outputTokens ?? 0;
      s.cacheReadTokens += record.cacheReadTokens ?? 0;
      s.cacheCreationTokens += record.cacheCreationTokens ?? 0;
      s.recordCount += 1;
      if (record.isRemote) s.isRemote = true;
      if (record.model && record.model !== "unknown") s.model = record.model;
      // peak context 估计：单条记录的 input+cacheRead+cacheCreation 峰值
      const ctx = (record.inputTokens ?? 0) + (record.cacheReadTokens ?? 0) + (record.cacheCreationTokens ?? 0);
      if (ctx > s.peakContextTokens) s.peakContextTokens = ctx;
    }

    // 时长优先用 session_records（有 sessionId 的记录），否则退回 token 活跃跨度
    const sessionTimes = new Map();
    for (const r of this.statsService.sessions) {
      if (r.sessionId && r.completedAt >= cutoff) {
        sessionTimes.set(r.sessionId, { startedAt: r.startedAt, completedAt: r.completedAt });
      }
    }

    const insights = [];
    for (const s of bySession.values()) {
      const times = sessionTimes.get(s.sessionId);
      const startedAt = times?.startedAt ?? s.firstTokenAt;
      const completedAt = times?.completedAt ?? s.lastTokenAt;
      const durationMs = Math.max(0, completedAt - startedAt);
      const total = s.inputTokens + s.outputTokens + s.cacheReadTokens + s.cacheCreationTokens;
      let category = "standard";
      if (s.isRemote) {
        category = "automation";
      } else if (durationMs >= MARATHON_MIN_MS || total >= MARATHON_MIN_TOKENS) {
        category = "marathon";
      } else if (durationMs < QUICK_MAX_MS && total < QUICK_MAX_TOKENS) {
        category = "quick";
      }
      insights.push({
        sessionId: s.sessionId,
        tool: s.tool,
        model: s.model,
        startedAt,
        completedAt,
        durationMs,
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        cacheReadTokens: s.cacheReadTokens,
        cacheCreationTokens: s.cacheCreationTokens,
        peakContextTokens: s.peakContextTokens,
        recordCount: s.recordCount,
        isRemote: s.isRemote,
        category
      });
    }
    insights.sort((a, b) => b.completedAt - a.completedAt);
    return { days: rangeDays, generatedAt: now, sessions: insights };
  }

  /** 导出用户自己的数据（PRD：数据可带走）。 */
  exportUsageData() {
    return {
      exportedAt: this.now(),
      retentionDays: this.statsService.retentionDays,
      tokenRecords: this.statsService.tokens,
      sessionRecords: this.statsService.sessions,
      pricing: this.pricing
        ? { source: "litellm", fetchedAt: this.pricing.lastFetchedAt ?? null, modelCount: Object.keys(this.pricing.getModels?.() ?? {}).length }
        : null
    };
  }

  /** 一键清除全部用量记录（UI 二次确认后调用）。 */
  clearUsageData() {
    this.statsService.tokens = [];
    this.statsService.sessions = [];
    this.statsService.dirty = true;
    this.statsService.flushToDisk();
    this.emitChange();
    return { clearedAt: this.now() };
  }
}

module.exports = { UsageService };
