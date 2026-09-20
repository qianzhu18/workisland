import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildResumeCommand, buildFallbackCopyText, searchResultAction } from "../src/renderer/island/components/search-jump.mjs";

const searchPaneSource = readFileSync(
  new URL("../src/renderer/island/components/SessionSearchPane.js", import.meta.url),
  "utf8"
);

test("search results import the resume-command helper they call while rendering", () => {
  assert.match(
    searchPaneSource,
    /import\s*\{[^}]*\bbuildResumeCommand\b[^}]*\}\s*from\s*["']\.\/search-jump\.mjs["']/
  );
});

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
  assert.equal(searchResultAction(zcode, true).type, "client");
});

test("searchResultAction routes client tools to client activation; opencode resumes in terminal", () => {
  assert.deepEqual(searchResultAction({ tool: "zcode", id: "z1", projectPath: "/z" }, true), { type: "client" });
  assert.deepEqual(searchResultAction({ tool: "qoder", id: "q1", projectPath: "/q" }, true), { type: "client" });
  assert.deepEqual(searchResultAction({ tool: "dumate", id: "d1", projectPath: "/d" }, true), { type: "client" });
  const action = searchResultAction({ tool: "opencode", id: "oc1", projectPath: "/o" }, true);
  assert.equal(action.type, "terminal");
  assert.equal(action.command, 'cd "/o" && opencode -s oc1');
});
