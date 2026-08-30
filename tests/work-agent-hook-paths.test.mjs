import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import path from "node:path";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "electron") {
    return { app: { isPackaged: false, getAppPath: () => process.cwd() } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const {
  getWorkBuddyConfigPath,
  getCodeBuddyConfigPath,
  WorkBuddyHookManager,
  CodeBuddyHookManager
} = require("../src/main/hooks-work-agents.cjs");
Module._load = originalLoad;

test("WorkBuddy and CodeBuddy use separate config files and hook sources", () => {
  assert.equal(getWorkBuddyConfigPath("/tmp/home"), path.join("/tmp/home", ".workbuddy", "settings.json"));
  assert.equal(getCodeBuddyConfigPath("/tmp/home"), path.join("/tmp/home", ".codebuddy", "settings.json"));
  assert.equal(new WorkBuddyHookManager().agentId, "workbuddy");
  assert.equal(new CodeBuddyHookManager().agentId, "codebuddy");
});
