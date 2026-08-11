"use strict";

const electron = require("electron");
const fs = require("fs");
const path = require("path");
const log = require("electron-log");

const STATS_DIR = path.join(electron.app.getPath("userData"), "stats");
const SESSIONS_FILE = path.join(STATS_DIR, "session_records.json");
const TOKENS_FILE = path.join(STATS_DIR, "token_records.json");
const MAX_RECORDS = 1e4;
const SAVE_DEBOUNCE_MS = 3e5;
const RETENTION_DAYS = 8;
const ALL_TOOLS = ["claude", "codex", "coco", "trae", "opencode", "cursor", "kimi", "hermes", "gemini", "copilot-cli", "sara", "aiden", "traex"];
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
  constructor() {
    this.loadFromDisk();
  }
  /** 订阅 token 变更事件，返回取消订阅函数 */
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  recordSession(tool, startedAt, completedAt) {
    this.sessions.push({ tool, startedAt, completedAt });
    this.dirty = true;
    this.scheduleSave();
  }
  recordToken(tool, sessionId, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, remote) {
    const record = { tool, sessionId, timestamp: Date.now(), inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens };
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
      if (fs.existsSync(SESSIONS_FILE)) {
        const raw = fs.readFileSync(SESSIONS_FILE, "utf-8");
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
      if (fs.existsSync(TOKENS_FILE)) {
        const raw = fs.readFileSync(TOKENS_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.tokens = parsed;
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
    const retentionCutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1e3;
    this.sessions = this.sessions.filter((r) => r.completedAt >= retentionCutoff);
    this.tokens = this.tokens.filter((r) => r.timestamp >= retentionCutoff);
    if (this.sessions.length > MAX_RECORDS) {
      this.sessions = this.sessions.slice(-MAX_RECORDS);
    }
    if (this.tokens.length > MAX_RECORDS) {
      this.tokens = this.tokens.slice(-MAX_RECORDS);
    }
    try {
      fs.mkdirSync(STATS_DIR, { recursive: true });
    } catch {
    }
    try {
      const tmp = SESSIONS_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(this.sessions), "utf-8");
      fs.renameSync(tmp, SESSIONS_FILE);
    } catch (err) {
      log.warn("[StatsService] failed to save session records:", err);
    }
    try {
      const tmp = TOKENS_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(this.tokens), "utf-8");
      fs.renameSync(tmp, TOKENS_FILE);
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

module.exports = { StatsService, getStatsService };
