import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createSessionState } = require("../src/main/session-state.cjs");
const { isVisibleInIsland } = require("../src/main/session-policy.cjs");

function event(type, timestamp, extra = {}) {
  return { type, sessionId: "session-1", tool: "claude", timestamp, ...extra };
}

test("same-session follow-ups preserve the original elapsed-time start", () => {
  const model = createSessionState({ isVisibleInIsland });
  let state = model.createInitialState();
  state = model.apply(state, event("sessionStarted", 1_000, { latestUserPrompt: "first" }));
  state = model.apply(state, event("sessionCompleted", 5_000, { isSessionEnd: false }));
  state = model.apply(state, event("sessionStarted", 20_000, { latestUserPrompt: "follow-up" }));
  assert.equal(state.sessions.get("session-1").createdAt, 1_000);
});

test("a turn start does not reset the session elapsed-time start", () => {
  const model = createSessionState({ isVisibleInIsland });
  let state = model.createInitialState();
  state = model.apply(state, event("sessionStarted", 1_000, { latestUserPrompt: "first" }));
  state = model.apply(state, event("turnStarted", 30_000, { latestUserPrompt: "follow-up" }));
  assert.equal(state.sessions.get("session-1").createdAt, 1_000);
});
