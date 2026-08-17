import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isCodexDesktopAppCommand } = require("../src/main/process-monitor.cjs");

test("process monitor recognizes standalone and ChatGPT-bundled Codex", () => {
  assert.equal(
    isCodexDesktopAppCommand("/Applications/Codex.app/Contents/MacOS/Codex"),
    true
  );
  assert.equal(
    isCodexDesktopAppCommand("/Applications/ChatGPT.app/Contents/Frameworks/Codex Framework.framework/Versions/151/Helpers/Codex (Service).app/Contents/MacOS/Codex (Service)"),
    true
  );
  assert.equal(
    isCodexDesktopAppCommand("/Applications/ChatGPT.app/Contents/MacOS/ChatGPT"),
    false
  );
  assert.equal(
    isCodexDesktopAppCommand("/Applications/Other.app/Contents/Frameworks/Codex Framework.framework/Codex"),
    false
  );
});
