import assert from "node:assert/strict";
import { test } from "node:test";
import { buildResumeCommand, buildFallbackCopyText, searchResultAction } from "../src/renderer/island/components/search-jump.mjs";

test("claude/codex results build resume commands; others fall back to project path", () => {
  assert.equal(
    buildResumeCommand({ tool: "claude", id: "aaa-1", projectPath: "/Users/mac/proj" }),
    'cd "/Users/mac/proj" && claude --resume aaa-1'
  );
  assert.equal(
    buildResumeCommand({ tool: "codex", id: "019e4143", projectPath: "/Users/mac/xhs" }),
    'cd "/Users/mac/xhs" && codex resume 019e4143'
  );
  assert.equal(buildResumeCommand({ tool: "zcode", id: "z1", projectPath: "/p" }), null);
  assert.equal(buildResumeCommand({ tool: "claude", id: "a", projectPath: "" }), null);
  assert.equal(buildFallbackCopyText({ projectPath: "/p" }), "/p");
});

test("quotes inside project paths are escaped", () => {
  assert.equal(
    buildResumeCommand({ tool: "claude", id: "a", projectPath: '/Users/mac/my "proj"' }),
    'cd "/Users/mac/my \\"proj\\"" && claude --resume a'
  );
});

test("searchResultAction routes claude/codex to terminal when enabled, others to copy", () => {
  const claude = { tool: "claude", id: "a1", projectPath: "/p" };
  const zcode = { tool: "zcode", id: "z1", projectPath: "/z" };
  assert.deepEqual(
    searchResultAction(claude, true),
    { type: "terminal", command: 'cd "/p" && claude --resume a1' }
  );
  assert.equal(searchResultAction(claude, false).type, "copy");
  assert.equal(searchResultAction(zcode, true).type, "copy");
  assert.equal(searchResultAction(zcode, true).text, "/z");
});
