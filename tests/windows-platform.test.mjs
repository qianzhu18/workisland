import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { getSocketPath } = require("../src/main/bridge-protocol.cjs");
const { createHooksCliCommand } = require("../src/main/hooks-cli-command.cjs");
const { enrichTerminalContext } = require("../src/island/hooks-cli/index.cjs");
const { createWindowsNavigation, resolveWindowsApp } = require("../src/main/windows-navigation.cjs");
const { parseWindowsTasklist } = require("../src/main/process-monitor.cjs");

test("Windows bridge uses a stable per-user named pipe", () => {
  const first = getSocketPath({}, "C:\\Users\\Ada", "win32");
  const second = getSocketPath({}, "c:\\users\\ada", "win32");
  assert.match(first, /^\\\\\.\\pipe\\workisland-[0-9a-f]{12}$/);
  assert.equal(first, second);
  assert.equal(getSocketPath({ FLUX_SOCKET_PATH: "custom-pipe" }, "C:\\Users\\Ada", "win32"), "custom-pipe");
});

test("Windows development hooks use cmd.exe quoting and Electron Node mode", () => {
  const command = createHooksCliCommand({
    appPath: "C:\\Program Files\\WorkIsland",
    source: "codex",
    nodePath: "C:\\Program Files\\WorkIsland\\WorkIsland.exe",
    electronNodePath: "C:\\Program Files\\WorkIsland\\WorkIsland.exe",
    platform: "win32"
  });
  assert.equal(
    command,
    'set "ELECTRON_RUN_AS_NODE=1"&& "C:\\Program Files\\WorkIsland\\WorkIsland.exe" "C:\\Program Files\\WorkIsland\\src\\island\\hooks-cli\\index.cjs" --source "codex"'
  );
});

test("Windows Terminal hook context preserves WT_SESSION", () => {
  const payload = enrichTerminalContext({}, { WT_SESSION: "{pane-guid}" });
  assert.equal(payload.terminal_app, "Windows Terminal");
  assert.equal(payload.terminal_session_id, "{pane-guid}");
});

test("Windows navigation activates an existing app before launching a fallback", async () => {
  const calls = [];
  const navigation = createWindowsNavigation({
    execFile: (command, args, options, callback) => {
      calls.push({ command, args, options });
      callback(null, "", "");
    }
  });
  assert.deepEqual(resolveWindowsApp("Windows Terminal"), { title: "Windows Terminal", executable: "wt.exe" });
  assert.equal(await navigation.jumpToTarget({ app: "Windows Terminal" }), true);
  assert.equal(calls[0].command, "powershell.exe");
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[0].options.env.WORKISLAND_APP_TITLE, "Windows Terminal");
  assert.equal(calls[0].options.env.WORKISLAND_APP_EXECUTABLE, "wt.exe");
});

test("Windows process discovery reads tasklist CSV without localized columns", () => {
  const names = parseWindowsTasklist('"Cursor.exe","1200","Console","1","80,000 K"\r\n"WindowsTerminal.exe","1400","Console","1","90,000 K"');
  assert.deepEqual([...names], ["cursor.exe", "windowsterminal.exe"]);
});
