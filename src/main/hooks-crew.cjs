"use strict";

// CrewAI（Crew CLI）接入管理器。
//
// CrewAI 没有本地 hooks 事件协议，接入点是代码层：用户在自己的 crew 代码中
// 接入 integrations/crewai/workisland_crew.py，该模块把事件 append 到
//   ~/.flux/hooks/crew/events.jsonl
// 本管理器只负责确保事件目录就绪 + 记录 manifest；事件消费由 crew-watcher.cjs 负责。
// 因为集成模块是否接入无法从本机探测（它在用户的 crew 项目里），
// available 恒为 true，installed 以事件目录 + manifest 为准。

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const promises = require("node:fs/promises");
const log = require("electron-log");
const { getCrewEventsRoot } = require("./crew-watcher.cjs");

function getManifestPath(agentId = "crew", homeDir = os.homedir()) {
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

class CrewHookManager {
  agentId = "crew";

  async install({ homeDir = os.homedir() } = {}) {
    const eventsRoot = getCrewEventsRoot(homeDir);
    await promises.mkdir(eventsRoot, { recursive: true });
    const previous = await readJson(getManifestPath(this.agentId, homeDir));
    await writeJson(getManifestPath(this.agentId, homeDir), {
      eventsFile: path.join(eventsRoot, "events.jsonl"),
      installedAt: previous?.installedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    log.info("[CrewHookManager] events root ready:", eventsRoot);
  }

  async uninstall({ homeDir = os.homedir() } = {}) {
    await promises.rm(getManifestPath(this.agentId, homeDir), { force: true });
    // 事件文件属于用户自己的记录，卸载连接时保留（避免误删历史）。
  }

  async checkHealth({ homeDir = os.homedir() } = {}) {
    const eventsRoot = getCrewEventsRoot(homeDir);
    const issues = [];
    const hasRoot = fs.existsSync(eventsRoot);
    const hasManifest = fs.existsSync(getManifestPath(this.agentId, homeDir));
    if (!hasRoot) {
      issues.push("事件目录缺失，请点击「连接」创建，并在 crew 代码中接入集成模块（docs/CREWAI_INTEGRATION.md）");
    }
    if (!hasManifest) {
      issues.push("未记录安装状态（点击「连接」可补写）");
    }
    return {
      agentId: this.agentId,
      available: true,
      installed: hasRoot && hasManifest,
      issues,
      manifestPath: getManifestPath(this.agentId, homeDir),
      configPaths: [eventsRoot]
    };
  }
}

module.exports = {
  CrewHookManager,
  getManifestPath
};
