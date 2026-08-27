import assert from "node:assert/strict";
import test from "node:test";
import {
  enabledToolboxModules,
  reduceToolboxState,
  resolveToolboxReopenModule,
  selectToolboxModule
} from "../src/renderer/island/components/productivity-toolbox-model.mjs";

test("only enabled utility modules appear after Agent", () => {
  assert.deepEqual(enabledToolboxModules({
    fileShelfEnabled: true,
    clipboardHistoryEnabled: false,
    terminalEnabled: true
  }), ["agent", "shelf", "terminal", "usage"]);
  // PRD-015：用量看板可通过 settings 关闭
  assert.deepEqual(enabledToolboxModules({
    fileShelfEnabled: true,
    clipboardHistoryEnabled: false,
    terminalEnabled: true,
    usageDashboardEnabled: false
  }), ["agent", "shelf", "terminal"]);
});

test("reopen policy changes only the presented toolbox module", () => {
  const enabled = ["agent", "shelf", "terminal"];
  assert.equal(resolveToolboxReopenModule({ mode: "agent", lastModule: "terminal", enabled }), "agent");
  assert.equal(resolveToolboxReopenModule({ mode: "last", lastModule: "terminal", enabled }), "terminal");
  assert.equal(resolveToolboxReopenModule({ mode: "last", lastModule: "clipboard", enabled }), "agent");
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
