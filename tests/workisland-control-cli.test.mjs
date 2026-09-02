import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
const {
  isControlCommand,
  parseCommand,
  parseValue,
  runControl
} = require("../src/island/workisland-cli/control-commands.cjs");

test("package exposes the combined WorkIsland CLI", () => {
  assert.equal(packageJson.bin?.workisland, "src/island/workisland-cli/index.cjs");
});

test("control command groups are routed separately from appearance and template commands", () => {
  assert.equal(isControlCommand(["settings", "list"]), true);
  assert.equal(isControlCommand(["state"]), true);
  assert.equal(isControlCommand(["appearance", "get"]), false);
  assert.equal(isControlCommand(["template", "list"]), false);
});

test("settings commands map to allowlisted local control requests", () => {
  assert.deepEqual(parseCommand(["settings", "list"]), ["control.describeSettings", {}]);
  assert.deepEqual(parseCommand(["settings", "get", "sound.volume"]), ["control.getSettings", { keys: ["sound.volume"] }]);
  assert.deepEqual(parseCommand(["settings", "set", "sound.volume", "42"]), [
    "control.updateSettings",
    { changes: { "sound.volume": 42 } }
  ]);
  assert.deepEqual(parseCommand(["settings", "undo", "change-123"]), [
    "control.undoSettingsChange",
    { changeId: "change-123" }
  ]);
  assert.equal(parseValue("minimal"), "minimal");
});

test("session, surface, state, and activity commands remain bounded", () => {
  assert.deepEqual(parseCommand(["sessions", "list"]), ["control.listVisibleSessions", {}]);
  assert.deepEqual(parseCommand(["session", "focus", "public-session"]), ["control.focusSession", { id: "public-session" }]);
  assert.deepEqual(parseCommand(["surface", "set", "pet"]), ["control.setDisplaySurface", { surface: "pet" }]);
  assert.deepEqual(parseCommand(["state"]), ["control.getProductState", {}]);
  assert.deepEqual(parseCommand(["activity"]), ["control.getRecentActivity", {}]);
  assert.throws(() => parseCommand(["session", "delete", "secret"]), { code: "USAGE_ERROR" });
});

test("runControl sends the parsed command and writes JSON", async () => {
  const calls = [];
  const output = [];
  const result = await runControl(["settings", "get", "sound.volume"], {
    requestLocalControl: async (command, params, options) => {
      calls.push({ command, params, options });
      return { value: 8 };
    },
    writeOut: (value) => output.push(value)
  });
  assert.deepEqual(result, { value: 8 });
  assert.equal(JSON.parse(output[0]).value, 8);
  assert.deepEqual(calls[0].params, { keys: ["sound.volume"] });
  assert.equal(calls[0].options.client.name, "WorkIsland CLI");
});
