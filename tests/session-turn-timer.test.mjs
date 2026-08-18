import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createSessionState } = require("../src/main/session-state.cjs");
const { isVisibleInIsland } = require("../src/main/session-policy.cjs");

function event(type, timestamp, extra = {}) {
  return { type, sessionId: "session-1", tool: "claude", timestamp, ...extra };
}

// 卡片计时的每轮语义：turnStartedAt 每轮刷新，createdAt 保持整段对话起点
// （统计服务依赖后者）。此前显示直接用 createdAt，会话结束过/应用重启后
// 又会重置，表现成「时而整段时而单轮」的迷惑计时。
test("turnStartedAt resets on every turn while createdAt stays", () => {
  const model = createSessionState({ isVisibleInIsland });
  let state = model.createInitialState();
  state = model.apply(state, event("sessionStarted", 1_000, { latestUserPrompt: "first" }));
  state = model.apply(state, event("sessionCompleted", 5_000, { isSessionEnd: false }));
  state = model.apply(state, event("sessionStarted", 60_000, { latestUserPrompt: "follow-up" }));
  const s = state.sessions.get("session-1");
  assert.equal(s.createdAt, 1_000, "createdAt 应保持整段起点");
  assert.equal(s.turnStartedAt, 60_000, "turnStartedAt 应为本轮起点");
});

test("a genuinely ended session restarts both clocks", () => {
  const model = createSessionState({ isVisibleInIsland });
  let state = model.createInitialState();
  state = model.apply(state, event("sessionStarted", 1_000, { latestUserPrompt: "first" }));
  state = model.apply(state, event("sessionCompleted", 5_000, { isSessionEnd: true }));
  state = model.apply(state, event("sessionStarted", 90_000, { latestUserPrompt: "reborn" }));
  const s = state.sessions.get("session-1");
  assert.equal(s.createdAt, 90_000);
  assert.equal(s.turnStartedAt, 90_000);
});
