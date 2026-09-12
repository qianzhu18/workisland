"use strict";

// DuMate（百度搭子）接入。DuMate 内嵌 dumate-opencode（OpenCode master 构建），
// 启动时把 XDG_CONFIG_HOME 重定向到
//   ~/Library/Application Support/qianfan-desktop-app/qianfan_desk_xdg/<userId>/
// （userId = global / 百度账号 hash，多账号多目录），且每次启动整体重写
// <userId>/config/opencode/opencode.json——配置里注册的插件会被冲掉。
// 突破口（issue #158 实测验证）：OpenCode 会免注册自动加载
// <userId>/config/opencode/plugin/（单数）目录下的插件文件，不受重写影响。
// 因此本管理器只写插件文件、不动 opencode.json。

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const promises = require("node:fs/promises");
const log = require("electron-log");
const {
  buildOpenCodePluginContent,
  OPENCODE_PLUGIN_VERSION,
  OPENCODE_PLUGIN_VERSION_MARKER
} = require("./hooks-plugins.cjs");

const DUMATE_PLUGIN_FILENAME = "flux-opencode-plugin.js";

function getDuMateDataRoot(homeDir = os.homedir()) {
  return path.join(homeDir, "Library", "Application Support", "qianfan-desktop-app");
}

function getDuMateXdgRoot(homeDir = os.homedir()) {
  return path.join(getDuMateDataRoot(homeDir), "qianfan_desk_xdg");
}

function getDuMateUserConfigDirs(homeDir = os.homedir()) {
  const xdgRoot = getDuMateXdgRoot(homeDir);
  let entries;
  try {
    entries = fs.readdirSync(xdgRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const configDir = path.join(xdgRoot, entry.name, "config", "opencode");
    if (fs.existsSync(configDir)) dirs.push(configDir);
  }
  return dirs.sort();
}

function getDuMatePluginInstallPath(configDir) {
  return path.join(configDir, "plugin", DUMATE_PLUGIN_FILENAME);
}

function isDuMateInstalled(homeDir = os.homedir()) {
  return fs.existsSync("/Applications/DuMate.app")
    || fs.existsSync(path.join(homeDir, "Applications", "DuMate.app"))
    || fs.existsSync(getDuMateDataRoot(homeDir));
}

function getManifestPath(agentId = "dumate", homeDir = os.homedir()) {
  return path.join(homeDir, ".flux", "hooks", `${agentId}-manifest.json`);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await promises.readFile(filePath, "utf-8"));
  } catch {
    return null;
  }
}

async function writeJson(filePath, data) {
  await promises.mkdir(path.dirname(filePath), { recursive: true });
  await promises.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

class DuMateHookManager {
  agentId = "dumate";

  async install({ homeDir = os.homedir() } = {}) {
    const socketPath = path.join(homeDir, ".flux", "run", "bridge.sock");
    const pluginContent = buildOpenCodePluginContent(socketPath, {
      source: this.agentId,
      fallbackTerminalApp: "DuMate"
    });
    // DuMate 启动前没有任何用户目录时，预写 global 目录（DuMate 用 mkdirSync
    // 创建、不会清理既有内容），保证装完即用；后续新账号目录由 checkHealth
    // 提示重连补写。
    let configDirs = getDuMateUserConfigDirs(homeDir);
    if (configDirs.length === 0) {
      const fallbackDir = path.join(getDuMateXdgRoot(homeDir), "global", "config", "opencode");
      await promises.mkdir(path.dirname(getDuMatePluginInstallPath(fallbackDir)), { recursive: true });
      configDirs = [fallbackDir];
    }
    const pluginPaths = [];
    for (const configDir of configDirs) {
      const pluginPath = getDuMatePluginInstallPath(configDir);
      await promises.mkdir(path.dirname(pluginPath), { recursive: true });
      await promises.writeFile(pluginPath, pluginContent, "utf-8");
      pluginPaths.push(pluginPath);
    }
    const previous = await readJson(getManifestPath(this.agentId, homeDir));
    await writeJson(getManifestPath(this.agentId, homeDir), {
      pluginPaths,
      pluginVersion: OPENCODE_PLUGIN_VERSION,
      installedAt: previous?.installedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    log.info("[DuMateHookManager] installed plugin to %d user config dir(s)", pluginPaths.length);
  }

  async uninstall({ homeDir = os.homedir() } = {}) {
    const manifest = await readJson(getManifestPath(this.agentId, homeDir));
    const pluginPaths = new Set([
      ...(manifest?.pluginPaths ?? []),
      ...getDuMateUserConfigDirs(homeDir).map((configDir) => getDuMatePluginInstallPath(configDir))
    ]);
    for (const pluginPath of pluginPaths) {
      try {
        await promises.unlink(pluginPath);
      } catch {
        // 未创建的目录直接跳过
      }
    }
    await promises.rm(getManifestPath(this.agentId, homeDir), { force: true });
  }

  async checkHealth({ homeDir = os.homedir() } = {}) {
    const issues = [];
    const available = isDuMateInstalled(homeDir);
    const configDirs = getDuMateUserConfigDirs(homeDir);
    if (configDirs.length === 0) {
      issues.push("DuMate 尚未创建用户配置目录，请先启动一次 DuMate 再连接");
    }
    for (const configDir of configDirs) {
      const pluginPath = getDuMatePluginInstallPath(configDir);
      let content = null;
      try {
        content = await promises.readFile(pluginPath, "utf-8");
      } catch {
        issues.push(`插件缺失：${configDir}（重新连接可补写）`);
        continue;
      }
      if (!content.includes(OPENCODE_PLUGIN_VERSION_MARKER)) {
        issues.push(`插件过期（期望 ${OPENCODE_PLUGIN_VERSION}）：${configDir}`);
      }
    }
    return {
      agentId: this.agentId,
      available,
      installed: issues.length === 0,
      issues,
      manifestPath: getManifestPath(this.agentId, homeDir),
      configPaths: configDirs
    };
  }
}

module.exports = {
  DuMateHookManager,
  getDuMateDataRoot,
  getDuMateXdgRoot,
  getDuMateUserConfigDirs,
  getDuMatePluginInstallPath,
  isDuMateInstalled
};
