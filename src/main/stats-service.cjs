"use strict";

const electron = require("electron");
const fs = require("fs");
const path = require("path");
const log = require("electron-log");
const { listCoreAgentDescriptors } = require("../shared/agent-catalog.cjs");

const MAX_RECORDS = 1e5;
const SAVE_DEBOUNCE_MS = 3e5;
// PRD-015：保留期从 8 天扩展到 90 天（可通过 settings.statsRetentionDays 覆盖）。
const DEFAULT_RETENTION_DAYS = 90;
// 与 agent-catalog 对齐，避免零填充聚合时漏掉后来新增的 agent。
const ALL_TOOLS = listCoreAgentDescriptors().map((d) => d.agentId);
function collectActiveTools(sessions, tokens) {
  const set = new Set(ALL_TOOLS);
  for (const r of sessions) set.add(r.tool);
  for (const r of tokens) set.add(r.tool);
  return Array.from(set);
}
class StatsService {
  sessions = [];
  tokens = [];
  saveTimer = null;
  dirty = false;
  listeners = /* @__PURE__ */ new Set();
  /**
   * 支持依赖注入（测试传入临时目录，见 tests/stats-service.test.mjs）；
   * 不传时落到 userData/stats，保留期用默认值，由 AppCoordinator 按
   * settings.statsRetentionDays 再行覆盖。
   */
  constructor({ statsDir, retentionDays } = {}) {
    this.statsDir = statsDir ?? path.join(electron.app.getPath("userData"), "stats");
    this.sessionsFile = path.join(this.statsDir, "session_records.json");
    this.tokensFile = path.join(this.statsDir, "token_records.json");
    this.retentionDays = DEFAULT_RETENTION_DAYS;
    if (typeof retentionDays === "number" && Number.isFinite(retentionDays)) {
      this.setRetentionDays(retentionDays);
    }
    this.loadFromDisk();
  }
  /** 保留期配置（天），收紧到 [8, 730] 防误配。 */
  setRetentionDays(days) {
    const n = Math.round(Number(days));
    if (!Number.isFinite(n)) return;
    this.retentionDays = Math.min(730, Math.max(8, n));
  }
  /** 订阅 token 变更事件，返回取消订阅函数 */
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  recordSession(tool, startedAt, completedAt, sessionId) {
    const record = { tool, startedAt, completedAt };
    if (sessionId) record.sessionId = sessionId;
    this.sessions.push(record);
    this.dirty = true;
    this.scheduleSave();
  }
  /**
   * timestamp 可选：用量发现通道（usage-discovery）回填历史用量时传记录的
   * 真实时间，让旧会话落到对应日期；缺省仍按当前时间入账。
   */
  recordToken(tool, sessionId, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, remote, model, timestamp) {
    const record = {
      tool,
      sessionId,
      timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now(),
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      model: model || "unknown"
    };
    if (remote) {
      record.isRemote = true;
      if (remote.remoteHost) record.remoteHost = remote.remoteHost;
    }
    this.tokens.push(record);
    this.dirty = true;
    this.scheduleSave();
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (e) {
        console.error("[StatsService] onChange listener threw:", e);
      }
    }
  }
  /**
   * 某个会话已入账的 token 累计值。
   * transcript 采集器给出的是会话累计数，重启后进程内的基线会丢失；
   * 用已入账的累计值当基线，重复采集才不会重复计数。
   */
  getTokenTotals(tool, sessionId) {
    const totals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
    for (const record of this.tokens) {
      if (record.tool !== tool || record.sessionId !== sessionId) continue;
      totals.input += Number(record.inputTokens) || 0;
      totals.output += Number(record.outputTokens) || 0;
      totals.cacheRead += Number(record.cacheReadTokens) || 0;
      totals.cacheCreation += Number(record.cacheCreationTokens) || 0;
    }
    return totals;
  }
  getSnapshot(timeRange) {
    const now = Date.now();
    const startOfToday = this.getStartOfDay(now);
    const cutoff = timeRange === "today" ? startOfToday : startOfToday - 6 * 24 * 60 * 60 * 1e3;
    const filteredSessions = this.sessions.filter((r) => r.completedAt >= cutoff);
    const filteredTokens = this.tokens.filter((r) => r.timestamp >= cutoff);
    const totalSessionCount = filteredSessions.length;
    const totalInputTokens = filteredTokens.reduce((s, r) => s + r.inputTokens, 0);
    const totalOutputTokens = filteredTokens.reduce((s, r) => s + r.outputTokens, 0);
    const totalCacheReadTokens = filteredTokens.reduce((s, r) => s + (r.cacheReadTokens ?? 0), 0);
    const totalCacheCreationTokens = filteredTokens.reduce((s, r) => s + (r.cacheCreationTokens ?? 0), 0);
    const sessionCountByTool = /* @__PURE__ */ new Map();
    for (const r of filteredSessions) {
      sessionCountByTool.set(r.tool, (sessionCountByTool.get(r.tool) ?? 0) + 1);
    }
    const tokensByTool = /* @__PURE__ */ new Map();
    for (const r of filteredTokens) {
      const prev = tokensByTool.get(r.tool) ?? { input: 0, output: 0 };
      prev.input += r.inputTokens;
      prev.output += r.outputTokens;
      tokensByTool.set(r.tool, prev);
    }
    let mostUsedAgent = null;
    let mostUsedAgentCount = 0;
    for (const [tool, count] of sessionCountByTool) {
      if (count > mostUsedAgentCount) {
        mostUsedAgent = tool;
        mostUsedAgentCount = count;
      }
    }
    const mostUsedAgentPercent = totalSessionCount > 0 ? Math.round(mostUsedAgentCount / totalSessionCount * 100) : 0;
    const activeTools = collectActiveTools(filteredSessions, filteredTokens);
    const agentAggregates = activeTools.filter((tool) => sessionCountByTool.has(tool) || tokensByTool.has(tool)).map((tool) => ({
      tool,
      sessionCount: sessionCountByTool.get(tool) ?? 0,
      totalInputTokens: tokensByTool.get(tool)?.input ?? 0,
      totalOutputTokens: tokensByTool.get(tool)?.output ?? 0
    }));
    const dailyByAgent = this.buildDailyByAgent(filteredSessions, filteredTokens, timeRange, startOfToday, activeTools);
    return {
      timeRange,
      totalSessionCount,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      totalCacheCreationTokens,
      mostUsedAgent,
      mostUsedAgentCount,
      mostUsedAgentPercent,
      agentAggregates,
      dailyByAgent
    };
  }
  buildDailyByAgent(sessions, tokens, timeRange, startOfToday, tools) {
    const result = {};
    if (timeRange === "today") {
      const todayStr2 = this.formatDate(new Date(startOfToday));
      for (const tool of tools) {
        result[tool] = Array.from({ length: 24 }, (_, h) => ({
          date: todayStr2,
          hour: h,
          sessionCount: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0
        }));
      }
      for (const r of sessions) {
        const h = new Date(r.completedAt).getHours();
        const point = result[r.tool]?.[h];
        if (point) point.sessionCount += 1;
      }
      for (const r of tokens) {
        const h = new Date(r.timestamp).getHours();
        const point = result[r.tool]?.[h];
        if (!point) continue;
        point.totalInputTokens += r.inputTokens;
        point.totalOutputTokens += r.outputTokens;
        point.cacheReadTokens += r.cacheReadTokens ?? 0;
        point.cacheCreationTokens += r.cacheCreationTokens ?? 0;
      }
    } else {
      const dates = [];
      for (let i = 6; i >= 0; i--) {
        dates.push(this.formatDate(new Date(startOfToday - i * 24 * 60 * 60 * 1e3)));
      }
      for (const tool of tools) {
        result[tool] = dates.map((date) => ({
          date,
          sessionCount: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0
        }));
      }
      for (const r of sessions) {
        const dateStr = this.formatDate(new Date(r.completedAt));
        const dayPoint = result[r.tool]?.find((d) => d.date === dateStr);
        if (dayPoint) dayPoint.sessionCount += 1;
      }
      for (const r of tokens) {
        const dateStr = this.formatDate(new Date(r.timestamp));
        const dayPoint = result[r.tool]?.find((d) => d.date === dateStr);
        if (!dayPoint) continue;
        dayPoint.totalInputTokens += r.inputTokens;
        dayPoint.totalOutputTokens += r.outputTokens;
        dayPoint.cacheReadTokens += r.cacheReadTokens ?? 0;
        dayPoint.cacheCreationTokens += r.cacheCreationTokens ?? 0;
      }
    }
    return result;
  }
  getStartOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  loadFromDisk() {
    try {
      if (fs.existsSync(this.sessionsFile)) {
        const raw = fs.readFileSync(this.sessionsFile, "utf-8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.sessions = parsed;
          log.info("[StatsService] loaded %d session records from disk", this.sessions.length);
        }
      }
    } catch (err) {
      log.warn("[StatsService] failed to load session records:", err);
    }
    try {
      if (fs.existsSync(this.tokensFile)) {
        const raw = fs.readFileSync(this.tokensFile, "utf-8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          // 迁移：PRD-015 之前的记录没有 model 字段，读入时归一化为 "unknown"，
          // 不丢弃任何历史数据；保留期延长后旧记录也继续可用。
          this.tokens = parsed.map((r) => (r && !r.model ? { ...r, model: "unknown" } : r));
          log.info("[StatsService] loaded %d token records from disk", this.tokens.length);
        }
      }
    } catch (err) {
      log.warn("[StatsService] failed to load token records:", err);
    }
  }
  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flushToDisk();
    }, SAVE_DEBOUNCE_MS);
  }
  flushToDisk() {
    if (!this.dirty) return;
    this.dirty = false;
    const retentionCutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1e3;
    this.sessions = this.sessions.filter((r) => r.completedAt >= retentionCutoff);
    this.tokens = this.tokens.filter((r) => r.timestamp >= retentionCutoff);
    if (this.sessions.length > MAX_RECORDS) {
      this.sessions = this.sessions.slice(-MAX_RECORDS);
    }
    if (this.tokens.length > MAX_RECORDS) {
      this.tokens = this.tokens.slice(-MAX_RECORDS);
    }
    try {
      fs.mkdirSync(this.statsDir, { recursive: true });
    } catch {
    }
    try {
      const tmp = this.sessionsFile + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(this.sessions), "utf-8");
      fs.renameSync(tmp, this.sessionsFile);
    } catch (err) {
      log.warn("[StatsService] failed to save session records:", err);
    }
    try {
      const tmp = this.tokensFile + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(this.tokens), "utf-8");
      fs.renameSync(tmp, this.tokensFile);
    } catch (err) {
      log.warn("[StatsService] failed to save token records:", err);
    }
  }
  dispose() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.flushToDisk();
  }
}
let _instance = null;
function getStatsService() {
  if (!_instance) {
    _instance = new StatsService();
  }
  return _instance;
}
module.exports = { StatsService, getStatsService, DEFAULT_RETENTION_DAYS };
