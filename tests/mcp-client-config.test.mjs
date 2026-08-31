import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const toml = require("@iarna/toml");
const { CodexMcpConfigManager } = require("../src/main/mcp-client-config.cjs");

function harness(initialConfig = "") {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "workisland-codex-mcp-"));
  const configDir = path.join(homeDir, ".codex");
  const configPath = path.join(configDir, "config.toml");
  fs.mkdirSync(configDir, { recursive: true });
  if (initialConfig !== null) fs.writeFileSync(configPath, initialConfig, "utf8");
  const manager = new CodexMcpConfigManager({
    homeDir,
    command: "/Applications/WorkIsland.app/Contents/MacOS/WorkIsland",
    serverPath: "/Applications/WorkIsland.app/Contents/Resources/app.asar/src/island/workisland-mcp/index.mjs",
    now: () => 1_800_000_000_000,
    detectClient: () => ({ installed: true, label: "Codex" })
  });
  return { homeDir, configPath, manager };
}

test("connect preserves unrelated Codex settings and creates a recoverable backup", () => {
  const original = `model = "gpt-5.6-sol"\n\n[mcp_servers.other]\ncommand = "other-server"\nargs = ["--safe"]\n`;
  const { configPath, manager } = harness(original);

  const result = manager.connect();
  const parsed = toml.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(parsed.model, "gpt-5.6-sol");
  assert.deepEqual(parsed.mcp_servers.other, { command: "other-server", args: ["--safe"] });
  assert.deepEqual(parsed.mcp_servers.workisland, {
    command: "/Applications/WorkIsland.app/Contents/MacOS/WorkIsland",
    args: ["/Applications/WorkIsland.app/Contents/Resources/app.asar/src/island/workisland-mcp/index.mjs"],
    env: { ELECTRON_RUN_AS_NODE: "1", WORKISLAND_MCP_CLIENT: "Codex" }
  });
  assert.equal(fs.readFileSync(result.backupPath, "utf8"), original);
  assert.equal(result.configured, true);
  assert.equal(manager.status([]).connectionState, "configured");
});

test("reconnecting updates one WorkIsland entry without duplicates", () => {
  const { configPath, manager } = harness("[mcp_servers.workisland]\ncommand = \"old\"\n");
  manager.connect();
  manager.connect();
  const text = fs.readFileSync(configPath, "utf8");
  assert.equal((text.match(/\[mcp_servers\.workisland\]/g) || []).length, 1);
  assert.equal(toml.parse(text).mcp_servers.workisland.command.includes("WorkIsland.app"), true);
});

test("disconnect removes only WorkIsland and keeps other MCP clients", () => {
  const { configPath, manager } = harness("[mcp_servers.other]\ncommand = \"other\"\n\n[mcp_servers.workisland]\ncommand = \"old\"\n");
  const result = manager.disconnect();
  const parsed = toml.parse(fs.readFileSync(configPath, "utf8"));
  assert.deepEqual(parsed.mcp_servers.other, { command: "other" });
  assert.equal(parsed.mcp_servers.workisland, undefined);
  assert.equal(result.configured, false);
});

test("invalid Codex TOML is never overwritten", () => {
  const invalid = "[mcp_servers.workisland\ncommand = broken";
  const { configPath, manager } = harness(invalid);
  assert.throws(
    () => manager.connect(),
    (error) => error.code === "CLIENT_CONFIG_INVALID"
  );
  assert.equal(fs.readFileSync(configPath, "utf8"), invalid);
});

test("status distinguishes configured from a real recent client call", () => {
  const { manager } = harness("");
  manager.connect();
  assert.equal(manager.status([]).connectionState, "configured");
  const connected = manager.status([{ timestamp: 1_800_000_000_000, client: "Codex", tool: "getSettings", result: "success" }]);
  assert.equal(connected.connectionState, "connected");
  assert.equal(connected.lastConnectedAt, 1_800_000_000_000);
});

test("manual configuration contains the same bounded stdio entry", () => {
  const { manager } = harness(null);
  const manual = manager.manualConfiguration();
  assert.match(manual.toml, /\[mcp_servers\.workisland\]/);
  assert.equal(manual.entry.command.includes("WorkIsland.app"), true);
  assert.deepEqual(toml.parse(manual.toml).mcp_servers.workisland, manual.entry);
});

