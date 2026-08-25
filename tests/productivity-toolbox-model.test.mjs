import assert from "node:assert/strict";
import test from "node:test";
import {
  enabledToolboxModules,
  reduceToolboxState,
  selectToolboxModule
} from "../src/renderer/island/components/productivity-toolbox-model.mjs";

test("only enabled utility modules appear after Agent", () => {
  assert.deepEqual(enabledToolboxModules({
    fileShelfEnabled: true,
    clipboardHistoryEnabled: false,
    terminalEnabled: true
  }), ["agent", "shelf", "terminal"]);
});

test("attention always returns the toolbox to Agent", () => {
  assert.equal(selectToolboxModule({
    current: "terminal",
    attention: true,
    enabled: ["agent", "terminal"]
  }), "agent");
});

test("Agent preemption remembers the previous utility", () => {
  assert.deepEqual(reduceToolboxState(
    { current: "clipboard", previousUtility: "clipboard" },
    { type: "agent-attention" }
  ), { current: "agent", previousUtility: "clipboard" });
});
