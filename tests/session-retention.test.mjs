import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isVisibleInIsland } = require("../src/main/session-policy.cjs");
const { createSessionState } = require("../src/main/session-state.cjs");

function event(type, extra = {}) {
  return { type, sessionId: "completed-session", tool: "claude", timestamp: Date.now(), ...extra };
}

test("unread completed sessions survive reconciliation and stale cleanup", () => {
  const model = createSessionState({ isVisibleInIsland });
  let state = model.createInitialState();
  state = model.apply(state, event("sessionStarted", { latestUserPrompt: "finish the task" }));
  state = model.apply(state, event("sessionCompleted", { isSessionEnd: true, summary: "done" }));
  const unread = state.sessions.get("completed-session");
  assert.equal(unread.phase, "completed");
  assert.equal(unread.completionDismissed, false);
  assert.equal(model.getVisibleSessions(state).length, 1);
  assert.equal(model.removeInvisibleSessions(state).state.sessions.size, 1);
  assert.equal(model.removeStaleSessions(state, 1).state.sessions.size, 1);
});

test("viewing a completed session is the explicit removal action", () => {
  const model = createSessionState({ isVisibleInIsland });
  let state = model.createInitialState();
  state = model.apply(state, event("sessionStarted", { latestUserPrompt: "finish the task" }));
  state = model.apply(state, event("sessionCompleted", { isSessionEnd: true }));
  state.sessions.set("completed-session", { ...state.sessions.get("completed-session"), completionDismissed: true });
  assert.equal(model.getVisibleSessions(state).length, 0);
  assert.equal(model.removeInvisibleSessions(state).state.sessions.size, 0);
});
