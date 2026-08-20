import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { normalizeCustomConnection, CustomAgentConnectionManager } = require("../src/main/custom-agent-connections.cjs");

test("normalizes an approved Hook connection without retaining discovery text", () => {
  assert.deepEqual(normalizeCustomConnection({
    id: "mimo", label: "MIMO", configPath: "/tmp/home/.mimo/hooks.json",
    eventMap: { prompt: "UserPromptSubmit", stop: "Stop" }
  }, { homeDir: "/tmp/home" }), {
    id: "custom:mimo", source: "custom:mimo", label: "MIMO", configPath: "/tmp/home/.mimo/hooks.json",
    eventMap: { UserPromptSubmit: "prompt", Stop: "stop" }
  });
});

test("rejects unsafe paths and incomplete lifecycle maps", () => {
  const base = { id: "mimo", label: "MIMO", eventMap: { prompt: "UserPromptSubmit", stop: "Stop" } };
  assert.throws(() => normalizeCustomConnection({ ...base, configPath: "/tmp/other/hooks.json" }, { homeDir: "/tmp/home" }), /配置文件/);
  assert.throws(() => normalizeCustomConnection({ ...base, configPath: "/tmp/home/.mimo/hooks.json", eventMap: { prompt: "Unknown", stop: "Stop" } }, { homeDir: "/tmp/home" }), /不支持/);
  assert.throws(() => normalizeCustomConnection({ ...base, configPath: "/tmp/home/.mimo/hooks.json", eventMap: { start: "SessionStart" } }, { homeDir: "/tmp/home" }), /提交任务/);
});

test("installs and uninstalls only its own marked Hook groups and records verification", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "workisland-custom-"));
  const configPath = join(homeDir, ".mimo", "hooks.json");
  const connection = normalizeCustomConnection({ id: "mimo", label: "MIMO", configPath, eventMap: { prompt: "UserPromptSubmit", stop: "Stop" } }, { homeDir });
  const manager = new CustomAgentConnectionManager({ homeDir, manifestDir: join(homeDir, ".flux", "hooks"), hookCommandForSource: source => `node flux-hooks --source ${source}` });
  await manager.install(connection);
  const installed = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(installed.hooks.Stop.length, 1);
  assert.match(installed.hooks.Stop[0].hooks[0].command, /--source custom:mimo/);
  assert.equal((await manager.getStatus(connection)).state, "configured");
  await manager.recordVerifiedEvent(connection.source, new Date("2026-08-20T08:00:00.000Z"));
  assert.deepEqual(await manager.getStatus(connection), { state: "verified", verifiedAt: "2026-08-20T08:00:00.000Z" });
  await writeFile(configPath, JSON.stringify({ ...installed, hooks: { ...installed.hooks, Stop: [{ hooks: [{ type: "command", command: "user-command" }] }, ...installed.hooks.Stop] } }));
  await manager.uninstall(connection);
  const removed = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(removed.hooks.Stop, [{ hooks: [{ type: "command", command: "user-command" }] }]);
});
