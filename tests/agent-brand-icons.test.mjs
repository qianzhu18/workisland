import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { listCoreAgentDescriptors } = require("../src/shared/agent-catalog.cjs");
const settingsSource = readFileSync(new URL("../src/renderer/settings-app.js", import.meta.url), "utf8");

const EXPECTED_AGENT_ICONS = Object.freeze({
  claude: "claude.svg",
  codex: "codex.png",
  coco: "trae.svg",
  cursor: "cursor.svg",
  trae: "trae.svg",
  "trae-cn": "trae.svg",
  zcode: "zcode.svg",
  workbuddy: "codebuddy.svg",
  opencode: "opencode.svg",
  sara: "sara.svg",
  kimi: "kimi.svg",
  gemini: "gemini.svg",
  "copilot-cli": "copilot.svg",
  hermes: "hermes.svg",
  aiden: "agent.svg",
  traex: "trae.svg",
  "plugin:omp": "pi.svg",
  "plugin:pi": "pi.svg"
});

test("every Settings Agent maps to a local brand asset", () => {
  const coreIds = listCoreAgentDescriptors().map(({ agentId }) => agentId);
  assert.deepEqual(Object.keys(EXPECTED_AGENT_ICONS).slice(0, coreIds.length), coreIds);

  for (const [agentId, filename] of Object.entries(EXPECTED_AGENT_ICONS)) {
    assert.match(settingsSource, new RegExp(`"${agentId}": "\\.\\.\\/assets\\/brands\\/${filename.replace(".", "\\.")}"`));
    const assetUrl = new URL(`../src/renderer/island/assets/brands/${filename}`, import.meta.url);
    assert.equal(existsSync(assetUrl), true, `${agentId} icon must exist at ${assetUrl.pathname}`);
    const asset = readFileSync(assetUrl);
    if (filename.endsWith(".svg")) {
      assert.match(asset.toString("utf8"), /^<svg\b/);
      assert.match(asset.toString("utf8"), /<title>[^<]+<\/title>/);
    } else {
      assert.deepEqual([...asset.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    }
  }
});

test("Agent cards render image assets without letter placeholders", () => {
  assert.match(settingsSource, /AGENT_ICON_URLS\[agentId\]/);
  assert.doesNotMatch(settingsSource, /label\.slice\(0, 1\)\.toUpperCase\(\)/);
  assert.match(settingsSource, /icon\.draggable = false/);
});
