import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const {
  canonicalTerminalApp,
  detectDesktopHostFromProcessList,
  enrichPayload,
  enrichTerminalContext
} = require("../src/island/hooks-cli/index.cjs");
const { createTerminalNavigation } = require("../src/main/terminal-navigation.cjs");

test("Warp TERM_PROGRAM is normalized for Claude Code hook payloads", () => {
  const payload = enrichTerminalContext({ cwd: "/tmp/workisland" }, {
    TERM_PROGRAM: "WarpTerminal",
    WARP_SESSION_ID: "warp-session-42",
    WARP_PANE_UUID: "warp-pane-9"
  });
  assert.equal(payload.terminal_app, "Warp");
  assert.equal(payload.terminal_session_id, "warp-session-42");
  assert.equal(payload.warp_pane_uuid, "warp-pane-9");
  assert.equal(canonicalTerminalApp("warp"), "Warp");
});

test("explicit hook metadata wins over inherited terminal environment", () => {
  const payload = enrichTerminalContext({ terminal_app: "Ghostty", terminal_session_id: "explicit" }, {
    TERM_PROGRAM: "WarpTerminal",
    WARP_SESSION_ID: "inherited"
  });
  assert.equal(payload.terminal_app, "Ghostty");
  assert.equal(payload.terminal_session_id, "explicit");
});

test("desktop hook process trees distinguish CodeBuddy from WorkBuddy", () => {
  const processList = [
    "600 1 /Applications/CodeBuddy CN.app/Contents/MacOS/Electron",
    "610 600 /Applications/CodeBuddy CN.app/Contents/Frameworks/CodeBuddy CN Helper.app/Contents/MacOS/CodeBuddy CN Helper --type=utility",
    "620 610 /Applications/WorkIsland.app/Contents/MacOS/WorkIsland /Applications/WorkIsland.app/Contents/Resources/bin/flux-hooks --source workbuddy"
  ].join("\n");
  assert.equal(detectDesktopHostFromProcessList(processList, 620), "CodeBuddy CN");
});

test("enrichPayload keeps the agent PID fallback and Warp context", () => {
  const originalTermProgram = process.env.TERM_PROGRAM;
  const originalWarpSession = process.env.WARP_SESSION_ID;
  process.env.TERM_PROGRAM = "WarpTerminal";
  process.env.WARP_SESSION_ID = "warp-session-process";
  try {
    const payload = enrichPayload({ hook_event_name: "UserPromptSubmit" }, "UserPromptSubmit");
    assert.equal(payload.hook_event_name, "UserPromptSubmit");
    assert.equal(payload.terminal_app, "Warp");
    assert.equal(payload.terminal_session_id, "warp-session-process");
    assert.ok(payload.pid > 1);
  } finally {
    if (originalTermProgram === undefined) delete process.env.TERM_PROGRAM;
    else process.env.TERM_PROGRAM = originalTermProgram;
    if (originalWarpSession === undefined) delete process.env.WARP_SESSION_ID;
    else process.env.WARP_SESSION_ID = originalWarpSession;
  }
});

test("Claude Code and Codex resolve Warp and Terminal bundle IDs for source jump", () => {
  const navigation = createTerminalNavigation({
    isPluginAgentTool: () => false,
    PLUGIN_BY_TOOL: new Map()
  });
  assert.ok(navigation.getSessionBundleIds({
    tool: "claude",
    jumpTarget: { app: "Warp" }
  }).includes("dev.warp.Warp-Stable"));
  assert.ok(navigation.getSessionBundleIds({
    tool: "codex",
    jumpTarget: { app: "Terminal" }
  }).includes("com.apple.Terminal"));
  assert.ok(navigation.getSessionBundleIds({
    tool: "claude",
    jumpTarget: { app: "iTerm2" }
  }).includes("com.googlecode.iterm2"));
  assert.ok(navigation.getSessionBundleIds({
    tool: "workbuddy",
    jumpTarget: { app: "CodeBuddy CN" }
  }).includes("com.tencent.codebuddycn"));
});

test("packaged launcher remains a JavaScript entrypoint for Electron Node mode", () => {
  const source = readFileSync(new URL("../resources/bin/flux-hooks", import.meta.url), "utf8");
  assert.match(source, /require\(hooksCli\)\.run\(\)/);
  assert.doesNotMatch(source, /MacOS\/Orca|#!\/bin\/sh/);
});
