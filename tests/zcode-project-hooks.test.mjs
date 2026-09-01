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
  ZCODE_EVENTS,
  ZCodeHookManager,
  findZCodeProjectRoot,
  getZCodeConfigPath,
  getZCodeWorkspaceConfigPath,
  isWorkIslandHookGroup,
  mergeHookGroups
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

test("hook detection accepts Windows backslash paths and double-quoted --source", () => {
  // win32 dev 命令（buildDevHooksCliCommand + win32 shellQuote）
  const windowsDevCommand = 'set "ELECTRON_RUN_AS_NODE=1"&& "C:\\Program Files\\nodejs\\node.exe" "D:\\work\\island\\src\\island\\hooks-cli\\index.cjs" --source "zcode"';
  // win32 打包态命令（wrapWithInstallCheck + flux-hooks 二进制）
  const windowsPackagedCommand = 'if not exist "C:\\Apps\\WorkIsland.exe" exit /b 0 & set "ELECTRON_RUN_AS_NODE=1"&& "C:\\Apps\\WorkIsland.exe" "C:\\Apps\\resources\\bin\\flux-hooks" --source "zcode"';
  assert.equal(isWorkIslandHookGroup({ hooks: [{ type: "command", command: windowsDevCommand }] }, "zcode"), true);
  assert.equal(isWorkIslandHookGroup({ hooks: [{ type: "command", command: windowsPackagedCommand }] }, "zcode"), true);
  assert.equal(isWorkIslandHookGroup({ hooks: [{ type: "command", command: "node hooks-cli/index.cjs --source 'zcode'" }] }, "zcode"), true);
  assert.equal(isWorkIslandHookGroup({ hooks: [{ type: "command", command: 'node hooks-cli/index.cjs --source "other"' }] }, "zcode"), false);

  // 若不识别 Windows 形状的既有组，merge 会重复堆积而不是替换 —— 在任何平台钉住幂等契约。
  const merged = mergeHookGroups(
    { Stop: [{ hooks: [{ type: "command", command: windowsDevCommand }] }] },
    ZCODE_EVENTS.filter(({ event }) => event === "Stop"),
    windowsDevCommand,
    "zcode"
  );
  assert.equal(merged.Stop.length, 1);
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
