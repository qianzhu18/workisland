"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { promises } = fs;

const ID_RE = /^[a-z0-9-]{1,32}$/;
const SUPPORTED_EVENTS = new Set(["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "Notification"]);

function assertConfigPath(value, homeDir) {
  if (typeof value !== "string" || !value.trim()) throw new Error("请填写官方 Hook 配置文件路径");
  const resolved = path.resolve(value);
  const home = path.resolve(homeDir);
  const relative = path.relative(home, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !relative.split(path.sep).some((part) => part.startsWith(".")) || path.extname(resolved) !== ".json") {
    throw new Error("配置文件必须是主目录下隐藏配置目录中的 .json 文件");
  }
  return resolved;
}

function normalizeEventMap(eventMap) {
  if (!eventMap || typeof eventMap !== "object" || Array.isArray(eventMap)) throw new Error("事件映射无效");
  const normalized = {};
  const externalNames = new Set();
  for (const [externalName, eventName] of Object.entries(eventMap)) {
    if (typeof externalName !== "string" || !externalName.trim() || typeof eventName !== "string") throw new Error("事件名称无效");
    if (!SUPPORTED_EVENTS.has(eventName)) throw new Error(`不支持的 WorkIsland 事件：${eventName}`);
    if (normalized[eventName] || externalNames.has(externalName.trim())) throw new Error("同一个事件只能映射一次");
    normalized[eventName] = externalName.trim();
    externalNames.add(externalName.trim());
  }
  if (!normalized.UserPromptSubmit || !normalized.Stop) throw new Error("至少需要映射“提交任务”和“任务完成”事件");
  return normalized;
}

function normalizeCustomConnection(input, { homeDir }) {
  if (!input || typeof input !== "object") throw new Error("连接信息无效");
  if (!ID_RE.test(input.id || "")) throw new Error("智能体标识只能包含小写字母、数字和连字符");
  if (typeof input.label !== "string" || !input.label.trim() || input.label.trim().length > 48) throw new Error("请填写 1-48 个字符的智能体名称");
  return {
    id: `custom:${input.id}`,
    source: `custom:${input.id}`,
    label: input.label.trim(),
    configPath: assertConfigPath(input.configPath, homeDir),
    eventMap: normalizeEventMap(input.eventMap)
  };
}

function ownedGroup(connection, event, command) {
  return { matcher: "", hooks: [{ type: "command", command }], workIsland: { connectionId: connection.id, version: 1, event } };
}

class CustomAgentConnectionManager {
  constructor({ homeDir, manifestDir, hookCommandForSource }) {
    this.homeDir = homeDir;
    this.manifestDir = manifestDir;
    this.hookCommandForSource = hookCommandForSource;
  }
  manifestPath(connection) { return path.join(this.manifestDir, `${connection.id.slice("custom:".length)}.json`); }
  async readManifest(connection) {
    try { return JSON.parse(await promises.readFile(this.manifestPath(connection), "utf8")); } catch { return null; }
  }
  async list() {
    let names = [];
    try { names = await promises.readdir(this.manifestDir); } catch {}
    const items = [];
    for (const name of names.filter((entry) => entry.endsWith(".json"))) {
      try { items.push(JSON.parse(await promises.readFile(path.join(this.manifestDir, name), "utf8"))); } catch {}
    }
    return items;
  }
  async preview(connection) {
    return { configPath: connection.configPath, events: Object.entries(connection.eventMap).map(([event, externalEvent]) => ({ event, externalEvent })), command: this.hookCommandForSource(connection.source) };
  }
  async install(connection) {
    let config = { version: 1, hooks: {} };
    try {
      const raw = await promises.readFile(connection.configPath, "utf8");
      config = JSON.parse(raw);
    } catch (error) {
      if (error?.code !== "ENOENT") throw new Error("Hook 配置不是有效 JSON，未作任何修改");
    }
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Hook 配置不是 JSON 对象，未作任何修改");
    if (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks)) config.hooks = {};
    const command = this.hookCommandForSource(connection.source);
    for (const [event, externalEvent] of Object.entries(connection.eventMap)) {
      const groups = Array.isArray(config.hooks[externalEvent]) ? config.hooks[externalEvent] : [];
      config.hooks[externalEvent] = [...groups.filter((group) => group?.workIsland?.connectionId !== connection.id), ownedGroup(connection, event, command)];
    }
    await promises.mkdir(path.dirname(connection.configPath), { recursive: true });
    await promises.writeFile(connection.configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
    const existing = await this.readManifest(connection);
    await promises.mkdir(this.manifestDir, { recursive: true });
    await promises.writeFile(this.manifestPath(connection), JSON.stringify({ ...connection, installedAt: existing?.installedAt ?? new Date().toISOString(), verifiedAt: existing?.verifiedAt }, null, 2) + "\n", "utf8");
  }
  async uninstall(connection) {
    let config;
    try { config = JSON.parse(await promises.readFile(connection.configPath, "utf8")); } catch { config = null; }
    if (config?.hooks && typeof config.hooks === "object") {
      for (const event of Object.keys(config.hooks)) {
        if (Array.isArray(config.hooks[event])) config.hooks[event] = config.hooks[event].filter((group) => group?.workIsland?.connectionId !== connection.id);
      }
      await promises.writeFile(connection.configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
    }
    await promises.unlink(this.manifestPath(connection)).catch(() => {});
  }
  async getStatus(connection) {
    const manifest = await this.readManifest(connection);
    if (!manifest) return { state: "notConfigured" };
    return manifest.verifiedAt ? { state: "verified", verifiedAt: manifest.verifiedAt } : { state: "configured" };
  }
  async recordVerifiedEvent(source, timestamp = new Date()) {
    if (typeof source !== "string" || !source.startsWith("custom:")) return;
    const id = source.slice("custom:".length);
    const manifestPath = path.join(this.manifestDir, `${id}.json`);
    try {
      const manifest = JSON.parse(await promises.readFile(manifestPath, "utf8"));
      manifest.verifiedAt = timestamp.toISOString();
      await promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    } catch {}
  }
}

module.exports = { SUPPORTED_EVENTS, normalizeCustomConnection, CustomAgentConnectionManager };
