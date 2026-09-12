import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

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
  DuMateHookManager,
  getDuMateUserConfigDirs,
  getDuMatePluginInstallPath,
  isDuMateInstalled
} = require("../src/main/hooks-dumate.cjs");
Module._load = originalLoad;

const PLUGIN_FILENAME = "flux-opencode-plugin.js";

async function makeFakeDuMateHome() {
  const homeDir = await mkdtemp(path.join(tmpdir(), "dumate-test-"));
  const xdgRoot = path.join(
    homeDir, "Library", "Application Support", "qianfan-desktop-app", "qianfan_desk_xdg"
  );
  // 模拟 DuMate 已启动：两个账号目录 + global，各自带 config/opencode
  for (const user of ["global", "abc123", "def456"]) {
    await mkdir(path.join(xdgRoot, user, "config", "opencode"), { recursive: true });
    await writeFile(
      path.join(xdgRoot, user, "config", "opencode", "opencode.json"),
      "{\"$schema\":\"https://opencode.ai/config.json\"}\n",
      "utf-8"
    );
  }
  return { homeDir, xdgRoot };
}

test("user config dir discovery covers every account and sorts for stability", async () => {
  const { homeDir } = await makeFakeDuMateHome();
  try {
    const dirs = getDuMateUserConfigDirs(homeDir);
    assert.deepEqual(dirs.map((dir) => path.basename(path.dirname(path.dirname(dir)))).sort(),
      ["abc123", "def456", "global"]);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("install writes the dumate-source plugin into every account dir; uninstall cleans up", async () => {
  const { homeDir, xdgRoot } = await makeFakeDuMateHome();
  const manager = new DuMateHookManager();
  try {
    await manager.install({ homeDir });
    const dirs = getDuMateUserConfigDirs(homeDir);
    assert.equal(dirs.length, 3);
    for (const configDir of dirs) {
      const content = await readFile(getDuMatePluginInstallPath(configDir), "utf-8");
      // source 参数化必须落到 dumate，而不是默认的 opencode
      assert.match(content, /source: "dumate"/);
      assert.match(content, /session_id: "dumate-"/);
      // 不依赖 opencode.json 注册（DuMate 每次启动会整体重写该文件）
      const config = JSON.parse(await readFile(path.join(configDir, "opencode.json"), "utf-8"));
      assert.equal(config.plugin, undefined);
    }
    const health = await manager.checkHealth({ homeDir });
    assert.equal(health.agentId, "dumate");
    assert.equal(health.installed, true);
    assert.deepEqual(health.issues, []);
    assert.equal(health.configPaths.length, 3);

    await manager.uninstall({ homeDir });
    for (const configDir of dirs) {
      await assert.rejects(readFile(getDuMatePluginInstallPath(configDir)));
    }
    const afterUninstall = await manager.checkHealth({ homeDir });
    assert.equal(afterUninstall.installed, false);
    assert.equal(afterUninstall.issues.length, 3);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("install with no DuMate data falls back to the global dir so first run works", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "dumate-empty-"));
  const manager = new DuMateHookManager();
  try {
    // isDuMateInstalled 检查 /Applications/DuMate.app，与 homeDir 无关，
    // 在装了 DuMate 的机器上恒为 true，不适合在此断言。
    await manager.install({ homeDir });
    const fallbackPlugin = path.join(
      homeDir, "Library", "Application Support", "qianfan-desktop-app",
      "qianfan_desk_xdg", "global", "config", "opencode", "plugin", PLUGIN_FILENAME
    );
    const content = await readFile(fallbackPlugin, "utf-8");
    assert.match(content, /source: "dumate"/);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("new account dirs created after install surface as health issues until reinstall", async () => {
  const { homeDir, xdgRoot } = await makeFakeDuMateHome();
  const manager = new DuMateHookManager();
  try {
    await manager.install({ homeDir });
    // 模拟登录新账号后 DuMate 创建了新目录
    await mkdir(path.join(xdgRoot, "new789", "config", "opencode"), { recursive: true });
    const health = await manager.checkHealth({ homeDir });
    assert.equal(health.installed, false);
    assert.equal(health.issues.length, 1);
    assert.match(health.issues[0], /new789|插件缺失/);
    // 重连后补齐
    await manager.install({ homeDir });
    const healed = await manager.checkHealth({ homeDir });
    assert.equal(healed.installed, true);
    const pluginDirs = await readdir(path.join(xdgRoot, "new789", "config", "opencode", "plugin"));
    assert.deepEqual(pluginDirs, [PLUGIN_FILENAME]);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
