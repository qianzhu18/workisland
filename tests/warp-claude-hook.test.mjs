import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { canonicalTerminalApp, enrichPayload, enrichTerminalContext } = require("../src/island/hooks-cli/index.cjs");

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

test("packaged launcher remains a JavaScript entrypoint for Electron Node mode", () => {
  const source = readFileSync(new URL("../resources/bin/flux-hooks", import.meta.url), "utf8");
  assert.match(source, /require\(hooksCli\)\.run\(\)/);
  assert.doesNotMatch(source, /MacOS\/Orca|#!\/bin\/sh/);
});

