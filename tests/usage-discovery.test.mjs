import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const dir = mkdtempSync(join(tmpdir(), "wi-usage-discovery-"));

// stats-service 在模块加载时就调用 electron.app.getPath("userData")，普通 node
// 下先往 require 缓存塞桩（同 tests/token-capture.test.mjs 的做法）。
const electronId = require.resolve("electron");
require.cache[electronId] = {
  id: electronId,
  filename: electronId,
  loaded: true,
  exports: { app: { getPath: () => dir }, ipcMain: { on() {}, handle() {}, removeListener() {}, removeHandler() {} } }
};

const { UsageDiscoveryService, collectZcodeUsage, collectOpencodeUsage, collectClaudeUsage, opencodeTotalsOf, diffTotals } = require("../src/main/usage-discovery.cjs");
const { StatsService } = require("../src/main/stats-service.cjs");
const { UsageService } = require("../src/main/usage-service.cjs");

const DAY = 24 * 60 * 60 * 1e3;

// ── 工具函数 ─────────────────────────────────────────────────────────────────

function fakeStats({ tokens = [] } = {}) {
  return {
    tokens,
    sessions: [],
    retentionDays: 90,
    recordSession(tool, startedAt, completedAt, sessionId) {
      this.sessions.push(sessionId ? { tool, startedAt, completedAt, sessionId } : { tool, startedAt, completedAt });
    },
    recordToken(tool, sessionId, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, remote, model, timestamp) {
      this.tokens.push({
        tool,
        sessionId,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        model: model || "unknown",
        timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now()
      });
    }
  };
}

function hasSqlite3() {
  try {
    execFileSync("sqlite3", ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

// ── recordToken 可选时间戳（历史用量归档的前提）────────────────────────────

test("recordToken honors an explicit historical timestamp", () => {
  const stats = new StatsService({ statsDir: join(dir, "stats-ts"), retentionDays: 90 });
  const fixed = new Date(2026, 7, 1, 9, 0, 0).getTime();
  stats.recordToken("opencode", "ses_x", 10, 5, 0, 0, null, "m1", fixed);
  stats.recordToken("opencode", "ses_x", 1, 1, 0, 0, null, "m1");
  assert.equal(stats.tokens[0].timestamp, fixed, "explicit timestamp must be preserved");
  assert.ok(stats.tokens[1].timestamp > fixed, "missing timestamp falls back to now");
  stats.dispose();
});

// ── 纯函数 ──────────────────────────────────────────────────────────────────

test("opencodeTotalsOf maps assistant tokens and skips others", () => {
  assert.deepEqual(
    opencodeTotalsOf({ role: "assistant", tokens: { input: 10, output: 5, cache: { read: 100, write: 20 } } }),
    { input: 10, output: 5, cacheRead: 100, cacheCreation: 20 }
  );
  assert.equal(opencodeTotalsOf({ role: "user", tokens: { input: 10, output: 5 } }), null);
  assert.equal(opencodeTotalsOf({ role: "assistant", tokens: { input: 0, output: 0 } }), null);
});

test("diffTotals clamps at zero and returns null when nothing new", () => {
  assert.deepEqual(diffTotals({ input: 10, output: 5, cacheRead: 3, cacheCreation: 1 }, { input: 4, output: 5, cacheRead: 0, cacheCreation: 0 }),
    { input: 6, output: 0, cacheRead: 3, cacheCreation: 1 });
  assert.equal(diffTotals({ input: 1, output: 0, cacheRead: 0, cacheCreation: 0 }, { input: 2, output: 0, cacheRead: 0, cacheCreation: 0 }), null);
});

// ── opencode 收集器 ─────────────────────────────────────────────────────────

test("opencode collector aggregates per session+model", async () => {
  const home = join(dir, "oc-home");
  const sesDir = join(home, ".local/share/opencode/storage/message/ses_a");
  mkdirSync(sesDir, { recursive: true });
  writeFileSync(join(sesDir, "msg_1.json"), JSON.stringify({
    role: "user",
    time: { created: 1700000000000 }
  }));
  writeFileSync(join(sesDir, "msg_2.json"), JSON.stringify({
    role: "assistant",
    model: { providerID: "google", modelID: "gemini-3-pro" },
    tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 100, write: 20 } },
    time: { created: 1700000001000, completed: 1700000002000 }
  }));
  writeFileSync(join(sesDir, "msg_3.json"), JSON.stringify({
    role: "assistant",
    model: { providerID: "anthropic", modelID: "claude-x" },
    tokens: { input: 7, output: 3, cache: { read: 0, write: 0 } },
    time: { created: 1700000003000, completed: 1700000004000 }
  }));
  const results = await collectOpencodeUsage({ storageRoot: join(home, ".local/share/opencode"), cutoffMs: 0, seenDirMtime: new Map() });
  const gemini = results.find((r) => r.model === "gemini-3-pro");
  const claude = results.find((r) => r.model === "claude-x");
  assert.deepEqual({ ...gemini, sessionId: gemini.sessionId }, {
    sessionId: "ses_a",
    model: "gemini-3-pro",
    input: 10, output: 5, cacheRead: 100, cacheCreation: 20,
    lastActiveAt: 1700000004000 // 会话级最后活跃时间（跨模型取最大）
  });
  assert.equal(claude.input, 7);
  assert.equal(claude.lastActiveAt, 1700000004000);
});

test("opencode collector skips unchanged session dirs via mtime memo", async () => {
  const home = join(dir, "oc-home2");
  const sesDir = join(home, ".local/share/opencode/storage/message/ses_b");
  mkdirSync(sesDir, { recursive: true });
  writeFileSync(join(sesDir, "msg_1.json"), JSON.stringify({
    role: "assistant",
    model: { modelID: "m1" },
    tokens: { input: 1, output: 1 },
    time: { created: 1700000000000, completed: 1700000000000 }
  }));
  const seen = new Map();
  const root = join(home, ".local/share/opencode");
  const first = await collectOpencodeUsage({ storageRoot: root, cutoffMs: 0, seenDirMtime: seen });
  assert.equal(first.length, 1);
  const second = await collectOpencodeUsage({ storageRoot: root, cutoffMs: 0, seenDirMtime: seen });
  assert.equal(second.length, 0, "unchanged dirs must be skipped on rescan");
  // 目录有新文件（mtime 变化）→ 重新扫描并累计全量（基线差分在 ingest 层做）
  writeFileSync(join(sesDir, "msg_2.json"), JSON.stringify({
    role: "assistant",
    model: { modelID: "m1" },
    tokens: { input: 2, output: 2 },
    time: { created: 1700000005000, completed: 1700000006000 }
  }));
  const third = await collectOpencodeUsage({ storageRoot: root, cutoffMs: 0, seenDirMtime: seen });
  assert.equal(third.length, 1);
  assert.equal(third[0].input, 3, "cumulative includes all messages of the session");
});

// ── claude 收集器 ───────────────────────────────────────────────────────────

test("claude collector parses transcripts and skips owned sessions", async () => {
  const home = join(dir, "cl-home");
  const projDir = join(home, ".claude/projects/proj-a");
  mkdirSync(projDir, { recursive: true });
  writeFileSync(join(projDir, "sess-free.jsonl"), [
    JSON.stringify({ type: "user", message: { content: "hi" } }),
    JSON.stringify({ type: "assistant", requestId: "r1", message: { model: "claude-x", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 50, cache_creation_input_tokens: 8 } } }),
    ""
  ].join("\n"));
  writeFileSync(join(projDir, "sess-owned.jsonl"), [
    JSON.stringify({ type: "assistant", requestId: "r2", message: { model: "claude-x", usage: { input_tokens: 99, output_tokens: 99 } } }),
    ""
  ].join("\n"));
  const results = await collectClaudeUsage({
    projectsRoot: join(home, ".claude/projects"),
    cutoffMs: 0,
    ownedSessions: new Set(["sess-owned"])
  });
  assert.equal(results.length, 1, "owned sessions must be skipped");
  assert.equal(results[0].sessionId, "sess-free");
  assert.equal(results[0].input, 10);
  assert.equal(results[0].cacheRead, 50);
  assert.ok(results[0].lastActiveAt > 0);
});

// ── zcode 收集器（需要 sqlite3 CLI）────────────────────────────────────────

test("zcode collector reads model_usage aggregates", { skip: hasSqlite3() ? false : "sqlite3 CLI not available" }, () => {
  const dbPath = join(dir, "zcode.db");
  const cutoff = new Date(2026, 7, 1).getTime();
  execFileSync("sqlite3", [dbPath, [
    "CREATE TABLE model_usage (session_id text, model_id text, status text, started_at integer, input_tokens integer, output_tokens integer, cache_read_input_tokens integer, cache_creation_input_tokens integer);",
    `INSERT INTO model_usage VALUES ('sess_z', 'glm-5', 'completed', ${cutoff + DAY}, 100, 50, 200, 10);`,
    `INSERT INTO model_usage VALUES ('sess_z', 'glm-5', 'cancelled', ${cutoff + DAY + 1}, 30, 0, 0, 0);`,
    `INSERT INTO model_usage VALUES ('sess_z', 'glm-5.5', 'completed', ${cutoff + DAY + 2}, 5, 5, 0, 0);`,
    `INSERT INTO model_usage VALUES ('sess_old', 'glm-5', 'completed', ${cutoff - DAY}, 999, 999, 0, 0);`,
    `INSERT INTO model_usage VALUES ('sess_zero', 'glm-5', 'completed', ${cutoff + DAY}, 0, 0, 0, 0);`
  ].join(" ")]);
  const results = collectZcodeUsage({ dbPath, cutoffMs: cutoff });
  const glm5 = results.find((r) => r.model === "glm-5");
  const glm55 = results.find((r) => r.model === "glm-5.5");
  assert.deepEqual(glm5, {
    sessionId: "sess_z", model: "glm-5",
    input: 130, output: 50, cacheRead: 200, cacheCreation: 10,
    lastActiveAt: cutoff + DAY + 1
  });
  assert.deepEqual(glm55, {
    sessionId: "sess_z", model: "glm-5.5",
    input: 5, output: 5, cacheRead: 0, cacheCreation: 0,
    lastActiveAt: cutoff + DAY + 2
  });
  assert.equal(results.find((r) => r.sessionId === "sess_old"), undefined, "rows older than cutoff are excluded");
  assert.equal(results.find((r) => r.sessionId === "sess_zero"), undefined, "all-zero rows are excluded");
});

// ── 服务编排：基线差分 + 所有权 ─────────────────────────────────────────────

test("scanAll ingests once and stays idempotent across rescans", async () => {
  const stats = fakeStats();
  const svc = new UsageDiscoveryService({ statsService: stats, scanIntervalMs: 1e9, startDelayMs: 1e9 });
  const zcodeRows = [
    { sessionId: "s1", model: "glm-5", input: 100, output: 50, cacheRead: 0, cacheCreation: 0, lastActiveAt: 1700000000000 }
  ];
  svc._collectors = {
    zcode: async () => zcodeRows,
    opencode: async () => [{ sessionId: "s2", model: "m1", input: 10, output: 5, cacheRead: 0, cacheCreation: 0, lastActiveAt: 1700000000000 }],
    claude: async () => []
  };
  await svc.scanAll();
  assert.equal(stats.tokens.length, 2);
  assert.ok(stats.tokens.every((r) => r.timestamp === 1700000000000), "historical timestamps preserved");
  // 第二轮：同样的累计值 → 基线差分后无增量
  await svc.scanAll();
  assert.equal(stats.tokens.length, 2, "rescan with unchanged cumulative must not double count");
  // 数据增长 → 只入账增量
  zcodeRows[0].input = 150;
  zcodeRows[0].output = 60;
  await svc.scanAll();
  assert.equal(stats.tokens.length, 3);
  const delta = stats.tokens[2];
  assert.equal(delta.inputTokens, 50);
  assert.equal(delta.outputTokens, 10);
  svc.stop();
});

test("scanAll passes the owned-session set to the claude collector", async () => {
  const stats = fakeStats({
    tokens: [{ tool: "claude", sessionId: "owned", inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, model: "claude-x" }]
  });
  const svc = new UsageDiscoveryService({ statsService: stats, scanIntervalMs: 1e9, startDelayMs: 1e9 });
  let seenOwned;
  svc._collectors = {
    zcode: async () => [],
    opencode: async () => [],
    claude: async (cutoffMs, ownedSessions) => {
      seenOwned = ownedSessions;
      // 所有权过滤本身在真实 collectClaudeUsage 内部（已有单测覆盖），
      // 这里验证 scanAll 把已入账集合正确传进来，且自由会话正常入账
      return [{ sessionId: "sess-free", model: "claude-x", input: 100, output: 0, cacheRead: 0, cacheCreation: 0, lastActiveAt: 1 }];
    }
  };
  await svc.scanAll();
  assert.ok(seenOwned.has("owned"), "claude collector must receive the owned-session set");
  assert.equal(stats.tokens.length, 2);
  assert.equal(stats.tokens[1].sessionId, "sess-free");
  svc.stop();
});

test("scanAll survives a failing source without blocking others", async () => {
  const stats = fakeStats();
  const svc = new UsageDiscoveryService({ statsService: stats, scanIntervalMs: 1e9, startDelayMs: 1e9 });
  svc._collectors = {
    zcode: async () => { throw new Error("boom"); },
    opencode: async () => [{ sessionId: "s2", model: "m1", input: 1, output: 1, cacheRead: 0, cacheCreation: 0, lastActiveAt: 1 }],
    claude: async () => []
  };
  await svc.scanAll();
  assert.equal(stats.tokens.length, 1, "other sources still ingest after one fails");
  svc.stop();
});

// ── usage-service：按 Agent 会话数 ──────────────────────────────────────────

test("usage summary counts sessions per agent", () => {
  const stats = fakeStats();
  const usage = new UsageService({ statsService: stats, now: () => new Date(2026, 7, 28, 12).getTime() });
  const day = new Date(2026, 7, 28, 9).getTime();
  stats.recordSession("opencode", day, day + 1000, "ses_a");
  stats.recordSession("opencode", day, day + 2000, "ses_b");
  stats.recordSession("codex", day, day + 3000, "ses_c");
  stats.recordToken("opencode", "ses_a", 10, 5, 0, 0, null, "m1", day);
  const summary = usage.getUsageSummary({ days: 7 });
  const byAgent = Object.fromEntries(summary.byAgent.map((r) => [r.tool, r]));
  assert.equal(byAgent.opencode.sessionCount, 2);
  assert.equal(byAgent.codex.sessionCount, 1);
  assert.equal(byAgent.opencode.inputTokens, 10);
});
