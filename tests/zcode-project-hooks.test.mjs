import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "electron") {
    return { app: { isPackaged: false, getAppPath: () => process.cwd() } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const {
  ZCodeHookManager,
  findZCodeProjectRoot,
  getZCodeConfigPath,
  getZCodeWorkspaceConfigPath,
  isWorkIslandHookGroup
} = require("../src/main/hooks-work-agents.cjs");
Module._load = originalLoad;

function getManifestPath(homeDir) {
  return path.join(homeDir, ".flux", "hooks", "zcode-manifest.json");
}

function makeTempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function workIslandEventNames(config) {
  return Object.entries(config.hooks?.events ?? {})
    .filter(([, groups]) => groups.some((group) => isWorkIslandHookGroup(group, "zcode")))
    .map(([event]) => event)
    .sort();
}

test("findZCodeProjectRoot walks up to the nearest .git and returns null without one", () => {
  const root = makeTempDir("zcode-root-");
  fs.mkdirSync(path.join(root, ".git"));
  const nested = path.join(root, "a", "b");
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(findZCodeProjectRoot(nested), root);
  const plain = makeTempDir("zcode-plain-");
  fs.mkdirSync(path.join(plain, "deep"), { recursive: true });
  assert.equal(findZCodeProjectRoot(path.join(plain, "deep")), null);
});

test("install writes project-level hooks while preserving other project config", async () => {
  const home = makeTempDir("zcode-home-");
  const project = makeTempDir("zcode-proj-");
  fs.mkdirSync(path.join(project, ".git"));
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  const projectConfigPath = getZCodeWorkspaceConfigPath(project);
  fs.mkdirSync(path.dirname(projectConfigPath), { recursive: true });
  fs.writeFileSync(projectConfigPath, JSON.stringify({ mcp: { servers: { demo: {} } } }), "utf-8");

  const manager = new ZCodeHookManager();
  await manager.install({ homeDir: home, workspacePaths: [path.join(project, "src")] });

  const projectConfig = readJson(projectConfigPath);
  assert.deepEqual(Object.keys(projectConfig).sort(), ["hooks", "mcp"]);
  assert.deepEqual(projectConfig.mcp, { servers: { demo: {} } });
  assert.equal(projectConfig.hooks.enabled, true);
  assert.deepEqual(
    workIslandEventNames(projectConfig),
    ["PermissionRequest", "PostToolUse", "PostToolUseFailure", "PreToolUse", "SessionStart", "Stop", "UserPromptSubmit"]
  );

  const manifest = readJson(getManifestPath(home));
  assert.deepEqual(manifest.workspaceConfigs, [{ configPath: projectConfigPath, hadHooksSection: false }]);
  assert.ok(fs.existsSync(getZCodeConfigPath(home)), "user-level config is still written for older ZCode");
});

test("checkHealth reports missing project config and uninstall cleans both scopes", async () => {
  const home = makeTempDir("zcode-home-");
  const project = makeTempDir("zcode-proj-");
  fs.mkdirSync(path.join(project, ".git"));

  const manager = new ZCodeHookManager();
  await manager.install({ homeDir: home, workspacePaths: [project] });

  const projectConfigPath = getZCodeWorkspaceConfigPath(project);
  fs.rmSync(projectConfigPath);
  const health = await manager.checkHealth({ homeDir: home });
  assert.equal(health.installed, false);
  assert.ok(health.issues.some((issue) => issue.includes(projectConfigPath)));
  assert.ok(health.configPaths.includes(projectConfigPath));

  await manager.uninstall({ homeDir: home });
  assert.equal(fs.existsSync(projectConfigPath), false, "deleted project config must not be recreated by uninstall");
  const userConfig = readJson(getZCodeConfigPath(home));
  assert.equal(userConfig.hooks, undefined);
  assert.equal(fs.existsSync(getManifestPath(home)), false);
});

test("install keeps a healthy project config idempotent and deduplicates workspaces", async () => {
  const home = makeTempDir("zcode-home-");
  const project = makeTempDir("zcode-proj-");
  fs.mkdirSync(path.join(project, ".git"));
  fs.mkdirSync(path.join(project, "src"), { recursive: true });

  const manager = new ZCodeHookManager();
  await manager.install({ homeDir: home, workspacePaths: [project, path.join(project, "src")] });
  const first = readJson(getZCodeWorkspaceConfigPath(project));
  await manager.install({ homeDir: home, workspacePaths: [project] });
  const second = readJson(getZCodeWorkspaceConfigPath(project));
  assert.deepEqual(second, first);
  const manifest = readJson(getManifestPath(home));
  assert.equal(manifest.workspaceConfigs.length, 1);
  const health = await manager.checkHealth({ homeDir: home });
  assert.equal(health.installed, true);
});
