import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const dir = mkdtempSync(join(tmpdir(), "wi-token-capture-"));

// stats-service 在模块加载时就调用 electron.app.getPath("userData")，而普通 node
// 下 require("electron") 只会返回二进制路径字符串。先往 require 缓存里塞一个桩，
// 才能在 Electron 之外直接测这些主进程模块。
const electronId = require.resolve("electron");
require.cache[electronId] = {
  id: electronId,
  filename: electronId,
  loaded: true,
  exports: { app: { getPath: () => dir }, ipcMain: { on() {}, handle() {}, removeListener() {}, removeHandler() {} } }
};

const fsPromises = require("node:fs/promises");
const { parseClaudeTokens, parseCodexTokens, runTokenBackfill } = require("../src/main/adapters-extended.cjs");
const write = (name, lines) => {
  const file = join(dir, name);
  writeFileSync(file, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n"));
  return file;
};

// ── Claude transcript ────────────────────────────────────────────────────────
test("claude token parser sums assistant usage across the transcript", async () => {
  const file = write("claude.jsonl", [
    { type: "user", message: { content: "hi" } },
    { type: "assistant", requestId: "r1", message: { model: "claude-x", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 } } },
    { type: "assistant", requestId: "r2", message: { model: "claude-x", usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 50 } } },
    "",
    "{ not json",
    { type: "system", message: { usage: { input_tokens: 999, output_tokens: 999 } } }
  ]);
  const result = await parseClaudeTokens(file);
  assert.deepEqual(result, {
    inputTokens: 17,
    outputTokens: 8,
    cacheReadTokens: 150,
    cacheCreationTokens: 20,
    totalTokens: 25,
    model: "claude-x",
    isEstimated: false
  });
});
test("claude token parser de-duplicates repeated request ids", async () => {
  const usage = { input_tokens: 10, output_tokens: 5 };
  const file = write("claude-dupe.jsonl", [
    { type: "assistant", requestId: "r1", message: { usage } },
    { type: "assistant", requestId: "r1", message: { usage } },
    { type: "assistant", requestId: "r2", message: { usage } }
  ]);
  const result = await parseClaudeTokens(file);
  assert.equal(result.inputTokens, 20, "the repeated r1 record must not be counted twice");
  assert.equal(result.outputTokens, 10);
});

test("claude token parser returns null for an empty or unreadable transcript", async () => {
  assert.equal(await parseClaudeTokens(write("claude-empty.jsonl", [])), null);
  assert.equal(await parseClaudeTokens(join(dir, "does-not-exist.jsonl")), null);
});

test("claude token parser streams JSONL without reading the whole file", async (t) => {
  const file = write("claude-streamed.jsonl", [
    { type: "assistant", requestId: "r1", message: { model: "claude-x", usage: { input_tokens: 12, output_tokens: 4 } } },
    "{ unfinished"
  ]);
  const originalReadFile = fsPromises.readFile;
  fsPromises.readFile = async () => { throw new Error("whole-file reads are forbidden"); };
  t.after(() => { fsPromises.readFile = originalReadFile; });

  const result = await parseClaudeTokens(file);
  assert.equal(result?.totalTokens, 16);
});

// ── Codex rollout ────────────────────────────────────────────────────────────
test("codex token parser takes the last cumulative total and splits cached input out", async () => {
  const file = write("codex.jsonl", [
    { payload: { type: "thread_settings_applied", thread_settings: { model: "gpt-x" } } },
    { payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 20 } } } },
    { payload: { type: "token_count", info: { total_token_usage: { input_tokens: 300, cached_input_tokens: 120, output_tokens: 60, cache_write_input_tokens: 9 } } } }
  ]);
  const result = await parseCodexTokens(file);
  assert.equal(result.inputTokens, 180, "cached tokens are reported separately, not inside input");
  assert.equal(result.cacheReadTokens, 120);
  assert.equal(result.cacheCreationTokens, 9);
  assert.equal(result.outputTokens, 60);
  assert.equal(result.totalTokens, 240);
  assert.equal(result.model, "gpt-x");
});

test("codex token parser returns null when the rollout carries no token_count", async () => {
  const file = write("codex-none.jsonl", [{ payload: { type: "thread_settings_applied", thread_settings: { model: "gpt-x" } } }]);
  assert.equal(await parseCodexTokens(file), null);
});

test("codex token parser streams JSONL without reading the whole file", async (t) => {
  const file = write("codex-streamed.jsonl", [
    { payload: { type: "thread_settings_applied", thread_settings: { model: "gpt-x" } } },
    { payload: { type: "token_count", info: { total_token_usage: { input_tokens: 30, cached_input_tokens: 10, output_tokens: 5 } } } },
    "{ unfinished"
  ]);
  const originalReadFile = fsPromises.readFile;
  fsPromises.readFile = async () => { throw new Error("whole-file reads are forbidden"); };
  t.after(() => { fsPromises.readFile = originalReadFile; });

  const result = await parseCodexTokens(file);
  assert.deepEqual(
    { input: result?.inputTokens, cacheRead: result?.cacheReadTokens, output: result?.outputTokens, model: result?.model },
    { input: 20, cacheRead: 10, output: 5, model: "gpt-x" }
  );
});

test("codex token parser reads only the tail of very large rollouts", async (t) => {
  const filler = "x".repeat(5 * 1024 * 1024) + "\n";
  const file = join(dir, "codex-large.jsonl");
  writeFileSync(file, filler + JSON.stringify({
    payload: {
      type: "token_count",
      info: { total_token_usage: { input_tokens: 500, cached_input_tokens: 200, output_tokens: 80 } }
    }
  }) + "\n");

  const fs = require("node:fs");
  const originalCreateReadStream = fs.createReadStream;
  const starts = [];
  fs.createReadStream = (path, options = {}) => {
    starts.push(options.start ?? 0);
    return originalCreateReadStream(path, options);
  };
  t.after(() => { fs.createReadStream = originalCreateReadStream; });

  const result = await parseCodexTokens(file);
  assert.ok(starts.some((start) => start > 0), "large rollout must be read from a tail offset");
  assert.deepEqual(
    { input: result?.inputTokens, cacheRead: result?.cacheReadTokens, output: result?.outputTokens },
    { input: 300, cacheRead: 200, output: 80 }
  );
});

test("codex token parser walks back when the tail is all tool output", async (t) => {
  const tokenLine = JSON.stringify({
    payload: {
      type: "token_count",
      info: { total_token_usage: { input_tokens: 900, cached_input_tokens: 400, output_tokens: 70 } }
    }
  }) + "\n";
  // token_count 之后还有 6 MB 大输出：最后 4 MB 里没有 token_count，必须回溯上一块。
  const file = join(dir, "codex-tail-output.jsonl");
  writeFileSync(file, tokenLine + ("y".repeat(1024 * 1024) + "\n").repeat(6));

  const fs = require("node:fs");
  const originalCreateReadStream = fs.createReadStream;
  const starts = [];
  fs.createReadStream = (path, options = {}) => {
    starts.push(options.start ?? 0);
    return originalCreateReadStream(path, options);
  };
  t.after(() => { fs.createReadStream = originalCreateReadStream; });

  const result = await parseCodexTokens(file);
  assert.ok(starts.length >= 2, "tail miss must trigger an earlier window");
  assert.deepEqual(
    { input: result?.inputTokens, cacheRead: result?.cacheReadTokens, output: result?.outputTokens },
    { input: 500, cacheRead: 400, output: 70 }
  );
});

test("codex token parser stops walking back after the scan budget", async (t) => {
  const tokenLine = JSON.stringify({
    payload: {
      type: "token_count",
      info: { total_token_usage: { input_tokens: 900, cached_input_tokens: 400, output_tokens: 70 } }
    }
  }) + "\n";
  // 20 MB 输出把 token_count 推到扫描上限之外：允许读不到，但不能整份扫描。
  const file = join(dir, "codex-beyond-budget.jsonl");
  writeFileSync(file, tokenLine + ("y".repeat(1024 * 1024) + "\n").repeat(20));

  const fs = require("node:fs");
  const originalCreateReadStream = fs.createReadStream;
  let bytesRead = 0;
  fs.createReadStream = (path, options = {}) => {
    const stream = originalCreateReadStream(path, options);
    stream.on("data", (chunk) => { bytesRead += chunk.length; });
    return stream;
  };
  t.after(() => { fs.createReadStream = originalCreateReadStream; });

  const result = await parseCodexTokens(file);
  assert.equal(result, null);
  assert.ok(bytesRead <= 18 * 1024 * 1024, `scanned ${bytesRead} bytes, expected a bounded scan`);
});

test("100 concurrent collections of one session open its transcript once", async (t) => {
  const file = write("codex-single-flight.jsonl", [
    { payload: { type: "token_count", info: { total_token_usage: { input_tokens: 30, cached_input_tokens: 10, output_tokens: 5 } } } }
  ]);
  const fs = require("node:fs");
  const originalCreateReadStream = fs.createReadStream;
  let readCount = 0;
  fs.createReadStream = (...args) => {
    readCount += 1;
    return originalCreateReadStream(...args);
  };
  t.after(() => { fs.createReadStream = originalCreateReadStream; });

  const { collectAndReportTokens } = require("../src/main/adapters-extended.cjs");
  await Promise.all(Array.from({ length: 100 }, () =>
    collectAndReportTokens("codex", "single-flight-s1", file)
  ));

  assert.equal(readCount, 1);
});

test("startup token backfill processes one transcript at a time", async () => {
  assert.equal(typeof runTokenBackfill, "function", "runTokenBackfill must be exported");
  let active = 0;
  let maxActive = 0;
  const order = [];
  const files = [
    { sessionId: "s1", path: "/tmp/one" },
    { sessionId: "s2", path: "/tmp/two" },
    { sessionId: "s3", path: "/tmp/three" }
  ];

  await runTokenBackfill(files, async (_tool, sessionId) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setImmediate(resolve));
    order.push(sessionId);
    active -= 1;
  });

  assert.equal(maxActive, 1);
  assert.deepEqual(order, ["s1", "s2", "s3"]);
});

test("startup token backfill continues after one transcript fails", async () => {
  const completed = [];
  const errors = [];
  await assert.doesNotReject(
    runTokenBackfill(
      [{ sessionId: "bad", path: "/tmp/bad" }, { sessionId: "good", path: "/tmp/good" }],
      async (_tool, sessionId) => {
        if (sessionId === "bad") throw new Error("broken transcript");
        completed.push(sessionId);
      },
      (error, file) => errors.push([error.message, file.sessionId])
    )
  );
  assert.deepEqual(completed, ["good"]);
  assert.deepEqual(errors, [["broken transcript", "bad"]]);
});

// ── 重启基线（applyBaselineDiff 回落 getTokenTotals）─────────────────────────
// 进程内 accountedTokens 为空模拟「重启后第一次采集」；已入账累计值必须充当基线，
// 否则 transcript 的整段历史用量会被再记一遍（Usage 看板信任的基础）。
const { getStatsService } = require("../src/main/stats-service.cjs");

test("first collection after restart uses recorded totals as baseline (no double counting)", async (t) => {
  const stats = getStatsService();
  t.after(() => stats.dispose());
  stats.recordToken("claude", "restart-s1", 100, 40, 30, 10);
  const file = write("claude-restart.jsonl", [
    { type: "assistant", requestId: "r1", message: { model: "claude-x", usage: { input_tokens: 150, output_tokens: 60, cache_read_input_tokens: 50, cache_creation_input_tokens: 15 } } }
  ]);
  const { collectAndReportTokens } = require("../src/main/adapters-extended.cjs");
  await collectAndReportTokens("claude", "restart-s1", file);
  const totals = stats.getTokenTotals("claude", "restart-s1");
  assert.deepEqual(
    { input: totals.input, output: totals.output, cacheRead: totals.cacheRead, cacheCreation: totals.cacheCreation },
    { input: 150, output: 60, cacheRead: 50, cacheCreation: 15 },
    "post-restart collection must land on the transcript cumulative, not re-add it"
  );
});

test("cache-only deltas are recorded, not silently dropped", async (t) => {
  const stats = getStatsService();
  t.after(() => stats.dispose());
  stats.recordToken("claude", "cache-only-s1", 100, 40, 30, 10);
  const file = write("claude-cache-only.jsonl", [
    { type: "assistant", requestId: "r1", message: { model: "claude-x", usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 80, cache_creation_input_tokens: 10 } } }
  ]);
  const { collectAndReportTokens } = require("../src/main/adapters-extended.cjs");
  await collectAndReportTokens("claude", "cache-only-s1", file);
  const totals = stats.getTokenTotals("claude", "cache-only-s1");
  assert.equal(totals.cacheRead, 80, "the cache-read delta of 50 must be accounted");
  assert.equal(totals.input, 100, "unchanged input must not be re-counted");
  assert.equal(totals.output, 40, "unchanged output must not be re-counted");
});
