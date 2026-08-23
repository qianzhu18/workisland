import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { DeepSeekHarnessAdapter } = require("../src/main/adapters-dsh.cjs");

function context() {
  const events = [];
  const jumpTargets = [];
  const pending = [];
  const responses = [];
  const sounds = [];
  return {
    events, jumpTargets, pending, responses, sounds,
    emitEvent: (event) => events.push(event),
    updateJumpTarget: (sessionId, tool, target) => jumpTargets.push({ sessionId, tool, target }),
    setPendingPermission: (...args) => pending.push(args),
    sendResponse: (_clientId, response) => responses.push(response),
    playSoundEvent: (sound) => sounds.push(sound)
  };
}

test("DSH lifecycle events retain the deployment URL as a jump target", () => {
  const adapter = new DeepSeekHarnessAdapter();
  const ctx = context();
  adapter.handleHook("client", {
    session_id: "dsh-session",
    hook_event_name: "UserPromptSubmit",
    prompt: "test",
    dsh_url: "http://127.0.0.1:3080/"
  }, ctx);
  assert.deepEqual(ctx.jumpTargets, [{
    sessionId: "dsh-session",
    tool: "dsh",
    target: { terminal_app: "dsh", url: "http://127.0.0.1:3080/" }
  }]);
});

test("DSH approval requests open an actionable Island approval", () => {
  const adapter = new DeepSeekHarnessAdapter();
  const ctx = context();
  adapter.handleHook("client", {
    session_id: "dsh-session",
    hook_event_name: "PermissionRequest",
    tool_name: "bash",
    reason: "Needs access outside the workspace"
  }, ctx);
  assert.equal(ctx.events.at(-1)?.type, "permissionRequested");
  assert.equal(ctx.events.at(-1)?.permissionRequest.toolName, "bash");
  assert.equal(ctx.pending.length, 1);
  assert.deepEqual(ctx.sounds, ["approvalNeeded"]);
  assert.equal(ctx.responses.length, 0, "blocking approval must wait for the user's decision");
  assert.equal(adapter.isBlockingEvent({ hook_event_name: "PermissionRequest" }), true);
});
