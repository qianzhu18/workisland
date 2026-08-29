import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseArgs, buildBridgeCommand } = require("../src/island/workisland-cli/index.cjs");

test("parseArgs maps every template subcommand", () => {
  assert.deepEqual(parseArgs(["node", "cli", "template", "list"]), {
    action: "template-list", source: undefined, socketPath: undefined
  });
  assert.deepEqual(parseArgs(["node", "cli", "template", "list", "--source", "builtin"]), {
    action: "template-list", source: "builtin", socketPath: undefined
  });
  assert.equal(parseArgs(["node", "cli", "template", "list", "--source", "nope"]).action, "usage");
  assert.deepEqual(parseArgs(["node", "cli", "template", "inspect", "author.theme@1.2.0"]), {
    action: "template-inspect", target: "author.theme@1.2.0", socketPath: undefined
  });
  assert.deepEqual(parseArgs(["node", "cli", "template", "preview", "/tmp/pkg"]), {
    action: "template-preview", target: "/tmp/pkg", socketPath: undefined
  });
  const apply = parseArgs(["node", "cli", "template", "apply", "author.theme", "--modules", "island,background", "--sync-codex"]);
  assert.deepEqual(apply, {
    action: "template-apply", target: "author.theme", modules: "island,background", syncCodex: true, socketPath: undefined
  });
  assert.deepEqual(parseArgs(["node", "cli", "template", "reset", "--module", "pet"]), {
    action: "template-reset", module: "pet", socketPath: undefined
  });
  assert.deepEqual(parseArgs(["node", "cli", "template", "reset"]), {
    action: "template-reset", module: "all", socketPath: undefined
  });
  assert.equal(parseArgs(["node", "cli", "template", "reset", "--module", "nope"]).action, "usage");
  assert.deepEqual(parseArgs(["node", "cli", "template", "validate", "/tmp/pkg"]), {
    action: "template-validate", target: "/tmp/pkg", socketPath: undefined
  });
  const exportPlan = parseArgs(["node", "cli", "template", "export", "/tmp/pkg", "--out", "/tmp/x.zip"]);
  assert.deepEqual(exportPlan, {
    action: "template-export", dir: "/tmp/pkg", out: "/tmp/x.zip", socketPath: undefined
  });
  // Missing operands are usage errors.
  assert.equal(parseArgs(["node", "cli", "template", "apply"]).action, "usage");
  assert.equal(parseArgs(["node", "cli", "template", "export", "/tmp/pkg"]).action, "usage");
});

test("buildBridgeCommand turns template plans into protocol frames", async () => {
  assert.deepEqual(await buildBridgeCommand({ action: "template-list", source: "local" }), {
    type: "listTemplates", source: "local"
  });
  assert.deepEqual(await buildBridgeCommand({ action: "template-inspect", target: "author.theme" }), {
    type: "inspectTemplate", target: "author.theme"
  });
  assert.deepEqual(await buildBridgeCommand({ action: "template-preview", target: "/tmp/pkg" }), {
    type: "previewTemplate", target: "/tmp/pkg"
  });
  assert.deepEqual(await buildBridgeCommand({
    action: "template-apply", target: "author.theme@1.0.0", modules: "island,pet", syncCodex: true
  }), {
    type: "applyTemplate", target: "author.theme@1.0.0", modules: "island,pet", syncCodex: true
  });
  assert.deepEqual(await buildBridgeCommand({ action: "template-reset", module: "background" }), {
    type: "resetTemplate", module: "background"
  });
  assert.deepEqual(await buildBridgeCommand({ action: "template-validate", target: "/tmp/pkg" }), {
    type: "validateTemplate", target: "/tmp/pkg"
  });
  assert.deepEqual(await buildBridgeCommand({ action: "template-export", dir: "/tmp/pkg", out: "/tmp/x.zip" }), {
    type: "exportTemplate", dir: "/tmp/pkg", out: "/tmp/x.zip"
  });
});
