import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { ClaudeAdapter, CodexAdapter } = require("../src/main/adapters-cli.cjs");

test("Codex prompt and stop hooks produce visible lifecycle events", () => {
  const events = [];
  const adapter = new CodexAdapter();
  const context = {
    emitEvent: (event) => events.push(event),
    sendResponse: () => {},
    updateJumpTarget: () => {},
    playSoundEvent: () => {},
    getApprovalMode: () => "terminalNative",
    clearStalePendingInteraction: () => {},
    detachClaudeTranscriptWatcher: () => {}
  };
  adapter.handleHook("codex-test", {
    hook_event_name: "UserPromptSubmit",
    session_id: "codex-regression-session",
    cwd: "/tmp/workisland",
    prompt: "检测真实 Codex 对话"
  }, context);
  adapter.handleHook("codex-test", {
    hook_event_name: "Stop",
    session_id: "codex-regression-session",
    cwd: "/tmp/workisland",
    is_interrupt: false
  }, context);
  assert.ok(events.some((event) => event.type === "sessionStarted" && event.latestUserPrompt === "检测真实 Codex 对话"));
  assert.ok(events.some((event) => event.type === "activityUpdated" && event.activity === "Prompt: 检测真实 Codex 对话"));
  assert.ok(events.some((event) => event.type === "sessionCompleted" && event.sessionId === "codex-regression-session"));
});

test("Codex session metadata overrides its generic app fallback for IDE sessions", () => {
  const targets = [];
  const adapter = new CodexAdapter();
  adapter.updateJumpTarget("codex-vscode", "codex", {
    terminal_app: "Codex",
    _session_meta: { source: "vscode" }
  }, {
    updateJumpTarget: (_sessionId, _tool, target) => targets.push(target)
  });

  assert.deepEqual(targets, [{ terminal_app: "VS Code" }]);
});

test("Claude attention notifications trigger one reminder sound per turn", () => {
  const sounds = [];
  const adapter = new ClaudeAdapter();
  const context = {
    emitEvent: () => {},
    sendResponse: () => {},
    playSoundEvent: (eventId) => sounds.push(eventId)
  };
  const base = { session_id: "claude-warp-session", hook_event_name: "Notification" };
  adapter.handleHook("claude-test", { ...base, notification_type: "permission_prompt" }, context);
  adapter.handleHook("claude-test", { ...base, notification_type: "permission_prompt" }, context);
  adapter.handleHook("claude-test", { ...base, notification_type: "idle_prompt" }, context);
  assert.deepEqual(sounds, ["approvalNeeded", "taskComplete"]);
});
