import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(fs.readFileSync(new URL("package.json", root), "utf8"));

test("the packaged app contains executable CLI and MCP entrypoints", () => {
  assert.equal(pkg.build.asar, true);
  assert.ok(pkg.build.files.includes("src/**/*"));
  assert.equal(pkg.bin.workisland, "src/island/workisland-cli/index.cjs");
  assert.equal(pkg.bin["workisland-mcp"], "src/island/workisland-mcp/index.mjs");
  for (const entry of Object.values(pkg.bin)) {
    const file = new URL(entry, root);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(file).mode & 0o111, 0o111);
    }
    assert.match(fs.readFileSync(file, "utf8"), /^#!\/usr\/bin\/env node/);
  }
  assert.match(pkg.dependencies["@modelcontextprotocol/server"], /^\^2/);
  assert.match(pkg.dependencies.zod, /^\^4/);
});

test("the MCP adapter cannot bypass the local main-process policy boundary", () => {
  const directory = new URL("src/island/workisland-mcp/", root);
  const source = fs.readdirSync(directory)
    .filter((name) => /\.[cm]?js$/.test(name))
    .map((name) => fs.readFileSync(new URL(name, directory), "utf8"))
    .join("\n");
  for (const forbidden of [
    /from ["']electron["']|require\(["']electron["']\)/,
    /node:child_process/,
    /createServer\s*\(|\.listen\s*\(/,
    /settings\.json|config\.json/,
    /resolvePermission|answerQuestion|deleteSession|runSavedTerminalCommand/
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
  assert.match(source, /requestLocalControl/);
});

test("Agent Control documentation covers setup privacy and removal", () => {
  const docs = fs.readFileSync(new URL("docs/local-agent-control.md", root), "utf8");
  for (const phrase of ["默认关闭", "Codex", "手动配置", "隐私边界", "移除", "LOCAL_CONTROL_DISABLED", "workisland-mcp", "workisland settings"]) {
    assert.match(docs, new RegExp(phrase));
  }
});
