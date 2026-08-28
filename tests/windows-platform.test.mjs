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

test("Windows navigation activates existing windows and never spawns a bare terminal", async () => {
  const calls = [];
  const navigation = createWindowsNavigation({
    execFile: (command, args, options, callback) => {
      calls.push({ command, args, options });
      callback(null, "RESULT:activated", "");
    }
  });
  assert.deepEqual(resolveWindowsApp("Windows Terminal"), { title: "Windows Terminal", executable: null });
  assert.equal(await navigation.jumpToTarget({ app: "Windows Terminal" }), true);
  assert.equal(calls[0].command, "powershell.exe");
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[0].options.env.WORKISLAND_APP_TITLE, "Windows Terminal");
  assert.equal(calls[0].options.env.WORKISLAND_APP_EXECUTABLE, "");
  assert.equal(calls[0].options.env.WORKISLAND_APP_LAUNCHABLE, "0");
  assert.equal(calls[0].options.env.WORKISLAND_APP_PID, "0");

  // codex 在 Windows 上是 CLI：跳转只允许聚焦（按 pid/标题），绝不 Start-Process。
  const codexApp = resolveWindowsApp("codex");
  assert.deepEqual(codexApp, { title: "Codex", executable: null });
  assert.equal(await navigation.jumpToTarget({ app: "codex", pid: 4242 }), true);
  assert.equal(calls[1].options.env.WORKISLAND_APP_TITLE, "Codex");
  assert.equal(calls[1].options.env.WORKISLAND_APP_EXECUTABLE, "");
  assert.equal(calls[1].options.env.WORKISLAND_APP_LAUNCHABLE, "0");
  assert.equal(calls[1].options.env.WORKISLAND_APP_PID, "4242");
  assert.ok(!calls[1].args.join(" ").includes("Start-Process wt"), "must not blindly launch Windows Terminal");
  const codexScript = calls[1].args[calls[1].args.length - 1];
  assert.match(codexScript, /AppActivate\(\$targetPid\)/);
  assert.match(codexScript, /windowsterminal\.exe/);

  // GUI 客户端保留启动兜底（窗口全关时）。
  assert.deepEqual(resolveWindowsApp("cursor"), { title: "Cursor", executable: "Cursor.exe", launchable: true });
  assert.equal(await navigation.jumpToTarget({ app: "cursor" }), true);
  assert.equal(calls[2].options.env.WORKISLAND_APP_LAUNCHABLE, "1");

  const failedNavigation = createWindowsNavigation({
    execFile: (command, args, options, callback) => callback(null, "RESULT:failed", "")
  });
  assert.equal(await failedNavigation.jumpToTarget({ app: "NoSuchApp" }), false);
});

test("Windows process discovery reads tasklist CSV without localized columns", () => {
  const names = parseWindowsTasklist('"Cursor.exe","1200","Console","1","80,000 K"\r\n"WindowsTerminal.exe","1400","Console","1","90,000 K"');
  assert.deepEqual([...names], ["cursor.exe", "windowsterminal.exe"]);
});
