import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { AlmaAdapter } = require("../src/main/adapters-alma.cjs");
const { createTerminalNavigation } = require("../src/main/terminal-navigation.cjs");

function context() {
  const events = [];
  const responses = [];
  const sounds = [];
  const jumps = [];
  return {
    events,
    responses,
    sounds,
    jumps,
    ctx: {
      emitEvent: (event) => events.push(event),
      sendResponse: (_id, response) => responses.push(response),
      updateJumpTarget: (...args) => jumps.push(args),
      playSoundEvent: (sound) => sounds.push(sound),
      clearStalePendingInteraction: () => {}
    }
  };
}

test("Alma prompt, tool, and completion hooks map onto one session", () => {
  const adapter = new AlmaAdapter();
  const bag = context();
  const payload = (hook, input) => ({ hook, input, terminal_app: "Alma", session_id: "should-not-win" });
  adapter.handleHook("c", payload("chat.message.willSend", { threadId: "thread-1", content: "fix the hook" }), bag.ctx);
  adapter.handleHook("c", payload("tool.willExecute", { tool: "Bash", args: { command: "npm test" }, context: { threadId: "thread-1" } }), bag.ctx);
  adapter.handleHook("c", payload("chat.message.didReceive", {
    threadId: "thread-1",
    model: "alma-test",
    response: { content: "done" }
  }), bag.ctx);
  adapter.handleHook("c", payload("thread.deleted", { threadId: "thread-1" }), bag.ctx);

  assert.equal(bag.events.filter((event) => event.type === "sessionStarted").length, 1);
  assert.equal(bag.events.find((event) => event.type === "toolUseStarted").activity, "Bash: npm test");
  const completions = bag.events.filter((event) => event.type === "sessionCompleted");
  assert.equal(completions[0].isSessionEnd, false);
  assert.equal(completions[0].lastAssistantMessage, "done");
  assert.equal(completions[1].isSessionEnd, true);
  assert.ok(bag.events.every((event) => event.sessionId === "thread-1" && event.tool === "alma"));
  assert.deepEqual(bag.responses.map((response) => response.type), ["acknowledged", "acknowledged", "acknowledged", "acknowledged"]);
  assert.equal(bag.jumps[0][2].terminal_app, "Alma");
  assert.equal(bag.jumps[0][2].pid, undefined);
});

test("Alma jump targets the Alma app bundle", () => {
  const navigation = createTerminalNavigation({ isPluginAgentTool: () => false, PLUGIN_BY_TOOL: new Map() });
  assert.deepEqual(navigation.getSessionBundleIds({ tool: "alma", jumpTarget: { app: "Alma" } }), ["com.yetone.alma"]);
});

test("Alma display text drops sent-at metadata and earlier context", () => {
  const adapter = new AlmaAdapter();
  const bag = context();
  const sentAt = "[Message sent-at: 2026-11-15 17:09:01 Sun (Asia/Shanghai, UTC+08:00) sender local time (= 2026-11-15T09:09:01.770Z); message time is not event/due/completion time.]";
  const content = `${sentAt}\n<context_from_earlier_conversation>\nBash. drwxr-xr-x old context\n</context_from_earlier_conversation>\n图标不对，换成应用自己的。`;
  adapter.handleHook("c", {
    hook: "chat.message.willSend",
    input: {
      threadId: "thread-2",
      content,
      parts: [
        { type: "text", text: sentAt },
        { type: "text", text: "<managed_agent_profile>You are operating as a bot</managed_agent_profile>" },
        { type: "text", text: "图标不对，换成应用自己的。" },
        { type: "file", url: "image.png" }
      ]
    }
  }, bag.ctx);
  const started = bag.events.find((event) => event.type === "sessionStarted");
  assert.equal(started.latestUserPrompt, "图标不对，换成应用自己的。");
  assert.equal(started.title, "图标不对，换成应用自己的。");
});
