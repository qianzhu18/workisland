import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const dir = mkdtempSync(join(tmpdir(), "wi-turn-timer-"));

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

const { createSessionState } = require("../src/main/session-state.cjs");
const write = (name, lines) => {
  const file = join(dir, name);
  writeFileSync(file, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n"));
  return file;
};

// ── 每轮计时 ─────────────────────────────────────────────────────────────────
function reduceAll(events) {
  const api = createSessionState({ isVisibleInIsland: () => true });
  let state = api.createInitialState();
  for (const event of events) state = api.apply(state, event);
  return state;
}

test("a new turn refreshes turnStartedAt but keeps createdAt for the whole conversation", () => {
  const state = reduceAll([
    { type: "sessionStarted", sessionId: "s1", tool: "claude", timestamp: 1000 },
    { type: "sessionCompleted", sessionId: "s1", tool: "claude", timestamp: 2000 },
    { type: "sessionStarted", sessionId: "s1", tool: "claude", timestamp: 5000 }
  ]);
  const session = state.sessions.get("s1");
  assert.equal(session.createdAt, 1000, "createdAt keeps whole-conversation semantics (stats depend on it)");
  assert.equal(session.turnStartedAt, 5000, "the card timer counts the current turn only");
});

test("turnStarted also advances only the per-turn clock", () => {
  const state = reduceAll([
    { type: "sessionStarted", sessionId: "s2", tool: "claude", timestamp: 1000 },
    { type: "turnStarted", sessionId: "s2", tool: "claude", timestamp: 4000 }
  ]);
  const session = state.sessions.get("s2");
  assert.equal(session.createdAt, 1000);
  assert.equal(session.turnStartedAt, 4000);
});

test("a session that genuinely ended restarts its whole-conversation clock", () => {
  const state = reduceAll([
    { type: "sessionStarted", sessionId: "s3", tool: "claude", timestamp: 1000 },
    { type: "sessionCompleted", sessionId: "s3", tool: "claude", timestamp: 2000, isSessionEnd: true },
    { type: "sessionStarted", sessionId: "s3", tool: "claude", timestamp: 9000 }
  ]);
  const session = state.sessions.get("s3");
  assert.equal(session.createdAt, 9000);
  assert.equal(session.turnStartedAt, 9000);
});

test("sessions recovered from a transcript stay flagged so the idle sweep spares them", () => {
  const state = reduceAll([
    { type: "sessionStarted", sessionId: "s4", tool: "claude", timestamp: 1000, recoveredFromTranscript: true, recoveryTranscriptPath: "/tmp/a.jsonl" }
  ]);
  const session = state.sessions.get("s4");
  assert.equal(session.recoveredFromTranscript, true);
  assert.equal(session.recoveryTranscriptPath, "/tmp/a.jsonl");
  const live = reduceAll([{ type: "sessionStarted", sessionId: "s5", tool: "claude", timestamp: 1000 }]);
  assert.equal(live.sessions.get("s5").recoveredFromTranscript, false, "hook-driven sessions must not be flagged");
});
