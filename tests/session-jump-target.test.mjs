import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const dir = mkdtempSync(join(tmpdir(), "wi-jump-"));

// 这些主进程模块在加载时就会 require("electron")，而普通 node 下它只返回二进制
// 路径字符串。先往 require 缓存里塞一个桩，才能在 Electron 之外直接测。
const electronId = require.resolve("electron");
require.cache[electronId] = {
  id: electronId,
  filename: electronId,
  loaded: true,
  exports: { app: { getPath: () => dir }, ipcMain: { on() {}, handle() {}, removeListener() {}, removeHandler() {} } }
};

const hooksCli = require("../src/island/hooks-cli/index.cjs");
const { ClaudeAdapter } = require("../src/main/adapters-cli.cjs");
const { isCodexDesktopAppCommand } = require("../src/main/process-monitor.cjs");

// ── hook CLI：认出承载会话的宿主 App ─────────────────────────────────────────
const procList = (cmd, pid = 501, ppid = 500) =>
  [`${pid} ${ppid} ${cmd}`, `${ppid} 1 /sbin/launchd`].join("\n");

test("the hook CLI recognizes Claude Desktop as the session host", () => {
  // Claude Code 跑在 Claude Desktop 里时 TERM_PROGRAM 为空。认不出宿主就没有
  // terminal_app，bridge-server 的 updateJumpTarget 会因 !app 直接 return ——
  // jumpTarget 永远不生成，点击会话卡片没有任何反应。
  assert.equal(
    hooksCli.detectDesktopHostFromProcessList(procList("/Applications/Claude.app/Contents/MacOS/Claude"), 501),
    "Claude"
  );
});

test("the hook CLI still recognizes every host it covered before", () => {
  const cases = [
    ["/Applications/CodeBuddy CN.app/Contents/MacOS/CodeBuddy", "CodeBuddy CN"],
    ["/Applications/WorkBuddy.app/Contents/MacOS/WorkBuddy", "WorkBuddy"],
    ["/Applications/Trae Solo.app/Contents/MacOS/Trae", "TraeWork"],
    ["/Applications/Trae.app/Contents/MacOS/Trae", "Trae"]
  ];
  for (const [cmd, expected] of cases) {
    assert.equal(hooksCli.detectDesktopHostFromProcessList(procList(cmd), 501), expected, cmd);
  }
});

test("the hook CLI falls back to the terminal that owns the process tree", () => {
  assert.equal(hooksCli.detectDesktopHostFromProcessList(procList("/Applications/Warp.app/Contents/MacOS/stable"), 501), "Warp");
  assert.equal(hooksCli.detectDesktopHostFromProcessList(procList("/Applications/iTerm.app/Contents/MacOS/iTerm2"), 501), "iTerm");
  assert.equal(hooksCli.detectDesktopHostFromProcessList(procList("/usr/bin/some-random-binary"), 501), undefined);
});

test("an explicit terminal in the payload still wins over process-tree guessing", () => {
  const enriched = hooksCli.enrichTerminalContext({ terminal_app: "iTerm.app" }, { TERM_PROGRAM: "Apple_Terminal" });
  assert.equal(enriched.terminal_app, "iTerm.app");
});

// ── 每个 hook 事件都刷新 jumpTarget ──────────────────────────────────────────
function runHook(payload) {
  const calls = { jump: [], events: [] };
  const ctx = {
    updateJumpTarget: (sessionId, tool, overrides) => calls.jump.push({ sessionId, tool, overrides }),
    emitEvent: (e) => calls.events.push(e),
    sendResponse: () => {},
    clearStalePendingInteraction: () => {},
    playSound: () => {},
    attachClaudeTranscriptWatcher: () => {},
    detachClaudeTranscriptWatcher: () => {},
    resolvePendingInteraction: () => {},
    reportHookProcessed: () => {}
  };
  new ClaudeAdapter().handleHook("client", payload, ctx);
  return calls;
}

test("a mid-turn hook refreshes the jump target, not just SessionStart/UserPromptSubmit/Stop", () => {
  // 会话在中途被重建时（应用重启，或被空闲扫描清掉后由工具事件带回）只会收到
  // 这类事件；没有这次刷新，重建出来的会话就永远没有 jumpTarget。
  const mid = runHook({
    hook_event_name: "PreToolUse",
    session_id: "s-mid",
    cwd: "/tmp/x",
    terminal_app: "Warp",
    tool_name: "Bash"
  });
  assert.ok(mid.jump.length >= 1, "a mid-turn hook must still set the jump target");
  assert.equal(mid.jump[0].sessionId, "s-mid");
  assert.equal(mid.jump[0].tool, "claude");
});

test("a hook without a session id never fabricates a jump target", () => {
  assert.deepEqual(runHook({ hook_event_name: "PreToolUse", cwd: "/tmp/x", terminal_app: "Warp" }).jump, []);
});

// ── Codex Desktop 进程识别 ───────────────────────────────────────────────────
test("codex desktop detection covers the ChatGPT.app bundle as well as the standalone app", () => {
  assert.equal(isCodexDesktopAppCommand("/Applications/Codex.app/Contents/MacOS/Codex"), true);
  assert.equal(isCodexDesktopAppCommand("/Applications/Codex Desktop.app/Contents/MacOS/Codex"), true);
  assert.equal(
    isCodexDesktopAppCommand("/Applications/ChatGPT.app/Contents/Frameworks/Codex Framework.framework/Versions/A/codex"),
    true,
    "newer Codex Desktop builds ship inside ChatGPT.app"
  );
  assert.equal(isCodexDesktopAppCommand("/Applications/ChatGPT.app/Contents/MacOS/ChatGPT"), false, "plain ChatGPT is not a Codex session host");
  assert.equal(isCodexDesktopAppCommand("/Applications/Claude.app/Contents/MacOS/Claude"), false);
});
