"use strict";

/**
 * 用量发现通道（issue #90）—— 与 hook 通道并行的第二采集路线。
 *
 * hook 通道要求客户端装 hook 且事件携带 transcript_path，且 token 采集
 * switch 只覆盖 claude/codex/gemini/hermes。本模块参考 agentsview
 * （kenn-io/agentsview）的会话目录矩阵，不依赖 hook，直接发现客户端
 * 落盘的用量数据并入账 StatsService。首批来源（格式已在本机实证）：
 *
 *   zcode    ~/.zcode/cli/db/db.sqlite               model_usage 表（sqlite3 CLI，同 hermes 模式）
 *   opencode ~/.local/share/opencode/storage/message/ 会话目录 msg json（assistant 带 tokens）
 *   claude   ~/.claude/projects/                     *.jsonl（复用 parseClaudeTokens）
 *
 * 入账规则：
 *   - 基线差分：每轮扫描先从 StatsService 已入账记录重建基线，只入账增量，
 *     重复扫描 / 重启回填不重复计数（与 applyBaselineDiff 同思路，但按
 *     tool+session(+model) 建基线，且不依赖进程内 Map）。
 *   - 所有权：claude 会话只要已被任何通道入账过（hook 通道或本通道）即跳过，
 *     两条通道不会对同一会话重复计费；zcode/opencode 没有 hook token 通道，
 *     按基线差分自然幂等。
 *   - 历史时间戳：recordToken 传记录真实时间（最后活跃时间），按日归档正确。
 *   - ADR-0004 边界：只读 token 计数 / 时间 / 模型标识，不读 prompt 正文、
 *     目录内容与密钥。
 *
 * 归档口径：整段会话的增量入账到「最后一次活跃」所在的日期（与 hook 通道
 * 在完成时一次性入账的口径一致）。
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const promises = require("node:fs/promises");
const log = require("electron-log");
const { parseClaudeTokens } = require("./adapters-extended.cjs");

const DAY_MS = 24 * 60 * 60 * 1e3;
const DEFAULT_SCAN_INTERVAL_MS = 10 * 60 * 1e3;
const DEFAULT_START_DELAY_MS = 8 * 1e3;
// 超大 transcript 跳过解析（hook 通道完成时也要整读一次，这里只挡离谱值）
const MAX_CLAUDE_FILE_BYTES = 50 * 1024 * 1024;
const SQLITE_TIMEOUT_MS = 3e3;

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

function emptyTotals() {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
}

function totalsNonZero(t) {
  return t.input > 0 || t.output > 0 || t.cacheRead > 0 || t.cacheCreation > 0;
}

/** 增量 = 累计 - 基线，逐项下限 0；全零返回 null。 */
function diffTotals(cumulative, baseline) {
  const input = Math.max(0, cumulative.input - baseline.input);
  const output = Math.max(0, cumulative.output - baseline.output);
  const cacheRead = Math.max(0, cumulative.cacheRead - baseline.cacheRead);
  const cacheCreation = Math.max(0, cumulative.cacheCreation - baseline.cacheCreation);
  if (input === 0 && output === 0 && cacheRead === 0 && cacheCreation === 0) return null;
  return { input, output, cacheRead, cacheCreation };
}

// ── zcode：~/.zcode/cli/db/db.sqlite · model_usage ──────────────────────────

const ZCODE_USAGE_SQL = (cutoffMs) => [
  "SELECT session_id, model_id,",
  "       SUM(input_tokens), SUM(output_tokens),",
  "       SUM(cache_read_input_tokens), SUM(cache_creation_input_tokens),",
  "       MAX(started_at)",
  "FROM model_usage",
  `WHERE started_at >= ${Math.floor(cutoffMs)}`,
  "GROUP BY session_id, model_id"
].join(" ");

function parseSqliteRows(stdout, columnCount) {
  const rows = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const fields = line.split("|");
    if (fields.length < columnCount) continue;
    rows.push(fields);
  }
  return rows;
}

function collectZcodeUsage({ dbPath, cutoffMs }) {
  if (!fs.existsSync(dbPath)) return [];
  const stdout = execFileSync(
    "sqlite3",
    [dbPath, ZCODE_USAGE_SQL(cutoffMs)],
    { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: SQLITE_TIMEOUT_MS }
  ).trim();
  const rows = parseSqliteRows(stdout, 7);
  const results = [];
  for (const [sessionId, modelId, input, output, cacheRead, cacheCreation, lastActive] of rows) {
    if (!sessionId) continue;
    const totals = {
      input: Number(input) || 0,
      output: Number(output) || 0,
      cacheRead: Number(cacheRead) || 0,
      cacheCreation: Number(cacheCreation) || 0
    };
    if (!totalsNonZero(totals)) continue;
    const lastActiveAt = Number(lastActive);
    results.push({
      sessionId,
      model: modelId || "unknown",
      ...totals,
      lastActiveAt: Number.isFinite(lastActiveAt) && lastActiveAt > 0 ? lastActiveAt : undefined
    });
  }
  return results;
}

// ── opencode：~/.local/share/opencode/storage/message/ses_*/msg_*.json ──────

function opencodeTotalsOf(message) {
  if (message?.role !== "assistant" || !message.tokens) return null;
  const t = message.tokens;
  const totals = {
    input: Number(t.input) || 0,
    output: Number(t.output) || 0,
    cacheRead: Number(t.cache?.read) || 0,
    cacheCreation: Number(t.cache?.write) || 0
  };
  // reasoning tokens 是输出的一部分被 opencode 单列，这里不并入 output，
  // 与其他客户端「output 即 API 返回 output_tokens」的口径一致。
  if (!totalsNonZero(totals)) return null;
  return totals;
}

async function collectOpencodeUsage({ storageRoot, cutoffMs, seenDirMtime }) {
  const messageRoot = path.join(storageRoot, "storage", "message");
  let sessionDirs;
  try {
    sessionDirs = await promises.readdir(messageRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const results = [];
  for (const entry of sessionDirs) {
    if (!entry.isDirectory() || !entry.name.startsWith("ses_")) continue;
    const dirPath = path.join(messageRoot, entry.name);
    let mtimeMs = 0;
    try {
      mtimeMs = (await promises.stat(dirPath)).mtimeMs;
    } catch {
      continue;
    }
    // 目录 mtime 未变化的会话上一轮已扫过，直接跳过（首次扫描除外）
    if (seenDirMtime && seenDirMtime.get(dirPath) === mtimeMs) continue;
    if (seenDirMtime) seenDirMtime.set(dirPath, mtimeMs);
    if (mtimeMs < cutoffMs) continue;

    let files;
    try {
      files = await promises.readdir(dirPath);
    } catch {
      continue;
    }
    // 整段会话全量累加（截断会导致累计值小于基线、漏记增量）
    const perModel = new Map();
    let lastActiveAt = 0;
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      let message;
      try {
        message = JSON.parse(await promises.readFile(path.join(dirPath, file), "utf-8"));
      } catch {
        continue;
      }
      const totals = opencodeTotalsOf(message);
      if (!totals) continue;
      const model = message.model?.modelID || message.model?.providerID || "unknown";
      let bucket = perModel.get(model);
      if (!bucket) {
        bucket = { ...emptyTotals() };
        perModel.set(model, bucket);
      }
      bucket.input += totals.input;
      bucket.output += totals.output;
      bucket.cacheRead += totals.cacheRead;
      bucket.cacheCreation += totals.cacheCreation;
      const completedAt = Number(message.time?.completed) || Number(message.time?.created) || 0;
      if (completedAt > lastActiveAt) lastActiveAt = completedAt;
      await yieldToEventLoop();
    }
    for (const [model, totals] of perModel) {
      if (!totalsNonZero(totals)) continue;
      results.push({
        sessionId: entry.name,
        model,
        ...totals,
        lastActiveAt: lastActiveAt || undefined
      });
    }
  }
  return results;
}

// ── claude：~/.claude/projects/*/*.jsonl（复用 parseClaudeTokens）───────────

async function collectClaudeUsage({ projectsRoot, cutoffMs, ownedSessions }) {
  let projectDirs;
  try {
    projectDirs = await promises.readdir(projectsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const results = [];
  for (const entry of projectDirs) {
    if (!entry.isDirectory()) continue;
    let files;
    try {
      files = await promises.readdir(path.join(projectsRoot, entry.name));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const sessionId = file.slice(0, -".jsonl".length);
      // 已被任何通道入账过的会话归原通道所有，跳过
      if (ownedSessions.has(sessionId)) continue;
      const filePath = path.join(projectsRoot, entry.name, file);
      let stat;
      try {
        stat = await promises.stat(filePath);
      } catch {
        continue;
      }
      if (stat.mtimeMs < cutoffMs) continue;
      if (stat.size > MAX_CLAUDE_FILE_BYTES) {
        log.warn("[UsageDiscovery] claude transcript 超过大小上限，跳过: %s", filePath);
        continue;
      }
      const cumulative = await parseClaudeTokens(filePath);
      await yieldToEventLoop();
      if (!cumulative) continue;
      const totals = {
        input: cumulative.inputTokens ?? 0,
        output: cumulative.outputTokens ?? 0,
        cacheRead: cumulative.cacheReadTokens ?? 0,
        cacheCreation: cumulative.cacheCreationTokens ?? 0
      };
      if (!totalsNonZero(totals)) continue;
      results.push({
        sessionId,
        model: cumulative.model || "unknown",
        ...totals,
        lastActiveAt: Math.round(stat.mtimeMs)
      });
    }
  }
  return results;
}

// ── 服务编排 ────────────────────────────────────────────────────────────────

class UsageDiscoveryService {
  /**
   * 全部依赖可注入（测试传临时 homeDir / 假 statsService / 假 collect）。
   * collectZcode/collectOpencode/collectClaude 覆写点见 this._collectors。
   */
  constructor({ statsService, homeDir, scanIntervalMs, startDelayMs, now = Date.now } = {}) {
    this.statsService = statsService;
    this.homeDir = homeDir ?? os.homedir();
    this.scanIntervalMs = scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS;
    this.startDelayMs = startDelayMs ?? DEFAULT_START_DELAY_MS;
    this.now = now;
    this.scanTimer = null;
    this.startTimer = null;
    this.running = false;
    this.scanning = false;
    /** opencode 会话目录 mtime 快照（进程内，重启后首轮全量重扫） */
    this.seenDirMtime = new Map();
    this._collectors = {
      zcode: (cutoffMs) => collectZcodeUsage({
        dbPath: path.join(this.homeDir, ".zcode", "cli", "db", "db.sqlite"),
        cutoffMs
      }),
      opencode: (cutoffMs) => collectOpencodeUsage({
        storageRoot: path.join(this.homeDir, ".local", "share", "opencode"),
        cutoffMs,
        seenDirMtime: this.seenDirMtime
      }),
      claude: (cutoffMs, ownedSessions) => collectClaudeUsage({
        projectsRoot: path.join(this.homeDir, ".claude", "projects"),
        cutoffMs,
        ownedSessions
      })
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      if (!this.running) return;
      void this.scanAll();
      this.scanTimer = setInterval(() => {
        if (!this.scanning) void this.scanAll();
      }, this.scanIntervalMs);
    }, this.startDelayMs);
    log.info(
      "[UsageDiscovery] started (interval=%ds, home=%s)",
      Math.round(this.scanIntervalMs / 1e3),
      this.homeDir
    );
  }

  stop() {
    this.running = false;
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }

  /** 保留窗口（与 StatsService 保留期一致），超窗的旧数据不再扫描。 */
  cutoffMs() {
    const retentionDays = Number(this.statsService?.retentionDays) || 90;
    return this.now() - retentionDays * DAY_MS;
  }

  /**
   * 基线：StatsService 已入账记录重建。
   * perSession 用于 claude 所有权判定（任何通道入账过即跳过）；
   * perSessionModel 用于 zcode/opencode 的按 (session, model) 增量差分。
   */
  buildBaselines(tool) {
    const perSession = new Map();
    const perSessionModel = new Map();
    for (const record of this.statsService.tokens) {
      if (record.tool !== tool) continue;
      const add = (map, key) => {
        let t = map.get(key);
        if (!t) {
          t = { ...emptyTotals() };
          map.set(key, t);
        }
        t.input += Number(record.inputTokens) || 0;
        t.output += Number(record.outputTokens) || 0;
        t.cacheRead += Number(record.cacheReadTokens) || 0;
        t.cacheCreation += Number(record.cacheCreationTokens) || 0;
      };
      add(perSession, record.sessionId);
      add(perSessionModel, `${record.sessionId}\u0000${record.model || "unknown"}`);
    }
    return { perSession, perSessionModel };
  }

  /** 单个来源入账，返回 {records, tokens}（tokens 为增量总和）。 */
  ingest(tool, discovered) {
    const { perSessionModel } = this.buildBaselines(tool);
    let records = 0;
    let tokenSum = 0;
    for (const item of discovered) {
      const key = `${item.sessionId}\u0000${item.model || "unknown"}`;
      const delta = diffTotals(
        { input: item.input, output: item.output, cacheRead: item.cacheRead, cacheCreation: item.cacheCreation },
        perSessionModel.get(key) ?? emptyTotals()
      );
      if (!delta) continue;
      this.statsService.recordToken(
        tool,
        item.sessionId,
        delta.input,
        delta.output,
        delta.cacheRead,
        delta.cacheCreation,
        null,
        item.model,
        item.lastActiveAt
      );
      records += 1;
      tokenSum += delta.input + delta.output + delta.cacheRead + delta.cacheCreation;
    }
    return { records, tokens: tokenSum };
  }

  /** claude 来源在收集前先算所有权集合（已被任何通道入账的会话）。 */
  claudeOwnedSessions() {
    const owned = new Set();
    for (const record of this.statsService.tokens) {
      if (record.tool === "claude" && record.sessionId) owned.add(record.sessionId);
    }
    return owned;
  }

  async scanAll() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const cutoff = this.cutoffMs();
      for (const [tool, collect] of Object.entries(this._collectors)) {
        try {
          const owned = tool === "claude" ? this.claudeOwnedSessions() : null;
          const discovered = await collect(cutoff, owned);
          const { records, tokens } = this.ingest(tool, discovered);
          if (records > 0) {
            log.info("[UsageDiscovery] %s: 入账 %d 条增量记录，共 %d tokens", tool, records, tokens);
          }
        } catch (err) {
          log.warn("[UsageDiscovery] %s 扫描失败:", tool, err?.message ?? err);
        }
        await yieldToEventLoop();
      }
    } finally {
      this.scanning = false;
    }
  }
}

module.exports = {
  UsageDiscoveryService,
  collectZcodeUsage,
  collectOpencodeUsage,
  collectClaudeUsage,
  opencodeTotalsOf,
  diffTotals,
  ZCODE_USAGE_SQL
};
