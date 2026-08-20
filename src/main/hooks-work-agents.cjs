"use strict";

const electron = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const promises = require("node:fs/promises");
const log = require("electron-log");
const {
  shellQuote,
  buildDevHooksCliCommand,
  wrapWithInstallCheck
} = require("./hook-shared.cjs");

const ZCODE_EVENTS = Object.freeze([
  { event: "SessionStart" },
  { event: "UserPromptSubmit" },
  { event: "PreToolUse", matcher: ".*" },
  { event: "PermissionRequest", matcher: ".*", timeout: 86400 },
  { event: "PostToolUse", matcher: ".*" },
  { event: "PostToolUseFailure", matcher: ".*" },
  { event: "Stop" }
]);

const WORKBUDDY_EVENTS = Object.freeze([
  { event: "SessionStart" },
  { event: "UserPromptSubmit" },
  { event: "PreToolUse", matcher: ".*" },
  { event: "PermissionRequest", matcher: ".*", timeout: 86400 },
  { event: "PostToolUse", matcher: ".*" },
  { event: "PostToolUseFailure", matcher: ".*" },
  { event: "Notification", matcher: ".*" },
  { event: "SubagentStart" },
  { event: "SubagentStop" },
  { event: "PreCompact" },
  { event: "Stop" },
  { event: "StopFailure" },
  { event: "SessionEnd" }
]);

function getHookBinaryPath() {
  const resourcesPath = process.resourcesPath ?? path.join(electron.app.getAppPath(), "resources");
  return path.resolve(resourcesPath, "bin", "flux-hooks");
}

function buildHookCommand(source) {
  if (electron.app && !electron.app.isPackaged) return buildDevHooksCliCommand(source);
  const binaryPath = getHookBinaryPath();
  return wrapWithInstallCheck(
    process.execPath,
    `ELECTRON_RUN_AS_NODE=1 ${shellQuote(process.execPath)} ${shellQuote(binaryPath)} --source ${shellQuote(source)}`
  );
}

async function readJson(filePath, { strict = false } = {}) {
  try {
    return JSON.parse(await promises.readFile(filePath, "utf-8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (strict) {
      const wrapped = new Error(`Cannot parse JSON config: ${filePath}`);
      wrapped.code = "INVALID_CONFIG";
      wrapped.path = filePath;
      wrapped.cause = error;
      throw wrapped;
    }
    return null;
  }
}

async function writeJsonAtomic(filePath, value) {
  await promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.workisland.tmp`;
  const backupPath = `${filePath}.workisland.backup`;
  if (fs.existsSync(filePath)) await promises.copyFile(filePath, backupPath);
  await promises.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  JSON.parse(await promises.readFile(temporaryPath, "utf-8"));
  await promises.rename(temporaryPath, filePath);
}

function isWorkIslandCommand(command, source) {
  if (typeof command !== "string") return false;
  const hasWorkIslandBinary = command.includes("flux-hooks") || command.includes("hooks-cli/index.");
  const hasSource = command.includes(`--source '${source}'`) || command.includes(`--source ${source}`);
  return hasWorkIslandBinary && hasSource;
}

function isWorkIslandHookGroup(group, source) {
  return Array.isArray(group?.hooks)
    && group.hooks.some((hook) => isWorkIslandCommand(hook?.command, source));
}

function buildHookGroups(events, command) {
  return Object.fromEntries(events.map(({ event, matcher, timeout }) => {
    const hook = { type: "command", command };
    if (timeout !== undefined) hook.timeout = timeout;
    const group = { hooks: [hook] };
    if (matcher !== undefined) group.matcher = matcher;
    return [event, [group]];
  }));
}

function mergeHookGroups(existingHooks, events, command, source) {
  const next = { ...(existingHooks ?? {}) };
  const additions = buildHookGroups(events, command);
  const supportedEvents = new Set(events.map(({ event }) => event));
  for (const event of new Set([...Object.keys(next), ...supportedEvents])) {
    if (!additions[event] && !Array.isArray(next[event])) continue;
    const existing = Array.isArray(next[event]) ? next[event] : [];
    const filtered = existing.filter((group) => !isWorkIslandHookGroup(group, source));
    if (additions[event]) next[event] = [...filtered, ...additions[event]];
    else if (filtered.length) next[event] = filtered;
    else delete next[event];
  }
  return next;
}

function removeHookGroups(existingHooks, source) {
  const next = {};
  for (const [event, groups] of Object.entries(existingHooks ?? {})) {
    if (!Array.isArray(groups)) {
      next[event] = groups;
      continue;
    }
    const filtered = groups.filter((group) => !isWorkIslandHookGroup(group, source));
    if (filtered.length) next[event] = filtered;
  }
  return next;
}

function verifyHookGroups(hooks, events, command, source) {
  const issues = [];
  for (const { event } of events) {
    const groups = Array.isArray(hooks?.[event]) ? hooks[event] : [];
    const group = groups.find((entry) => isWorkIslandHookGroup(entry, source));
    if (!group) {
      issues.push(`Missing event: ${event}`);
      continue;
    }
    const installedCommand = group.hooks.find((hook) => isWorkIslandCommand(hook?.command, source))?.command;
    if (installedCommand !== command) issues.push(`Stale command for event: ${event}`);
  }
  return issues;
}

function getZCodeConfigPath(homeDir = os.homedir()) {
  return path.join(homeDir, ".zcode", "cli", "config.json");
}

function getManifestPath(agentId, homeDir = os.homedir()) {
  return path.join(homeDir, ".flux", "hooks", `${agentId}-manifest.json`);
}

function getWorkBuddyConfigPath(homeDir = os.homedir()) {
  return path.join(homeDir, ".workbuddy", "settings.json");
}

function getCodeBuddyConfigPath(homeDir = os.homedir()) {
  return path.join(homeDir, ".codebuddy", "settings.json");
}

function isZCodeInstalled(homeDir = os.homedir()) {
  return fs.existsSync("/Applications/ZCode.app")
    || fs.existsSync(path.join(homeDir, "Applications", "ZCode.app"))
    || fs.existsSync(path.join(homeDir, ".zcode"));
}

function isWorkBuddyInstalled(homeDir = os.homedir()) {
  return fs.existsSync("/Applications/WorkBuddy.app")
    || fs.existsSync(path.join(homeDir, "Applications", "WorkBuddy.app"))
    || fs.existsSync(path.join(homeDir, ".workbuddy"));
}

function isCodeBuddyInstalled(homeDir = os.homedir()) {
  return fs.existsSync("/Applications/CodeBuddy CN.app")
    || fs.existsSync(path.join(homeDir, "Applications", "CodeBuddy CN.app"))
    || fs.existsSync(path.join(homeDir, ".codebuddy"));
}

class ZCodeHookManager {
  agentId = "zcode";

  async install() {
    const configPath = getZCodeConfigPath();
    const manifestPath = getManifestPath(this.agentId);
    const current = await readJson(configPath, { strict: true }) ?? {};
    const previousManifest = await readJson(manifestPath);
    const hadHooksSection = previousManifest?.hadHooksSection ?? Object.hasOwn(current, "hooks");
    const previousEnabled = previousManifest?.previousEnabled ?? current.hooks?.enabled;
    const command = buildHookCommand(this.agentId);
    const hookConfig = current.hooks && typeof current.hooks === "object" ? { ...current.hooks } : {};
    hookConfig.enabled = true;
    hookConfig.events = mergeHookGroups(hookConfig.events, ZCODE_EVENTS, command, this.agentId);
    current.hooks = hookConfig;
    await writeJsonAtomic(configPath, current);
    await writeJsonAtomic(manifestPath, {
      configPath,
      events: ZCODE_EVENTS.map(({ event }) => event),
      hadHooksSection,
      previousEnabled,
      installedAt: previousManifest?.installedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    log.info("[ZCodeHookManager] installed hooks to %s", configPath);
  }

  async uninstall() {
    const manifestPath = getManifestPath(this.agentId);
    const manifest = await readJson(manifestPath);
    const configPath = manifest?.configPath ?? getZCodeConfigPath();
    const current = await readJson(configPath, { strict: true });
    if (current?.hooks && typeof current.hooks === "object") {
      const events = removeHookGroups(current.hooks.events, this.agentId);
      if (Object.keys(events).length) current.hooks.events = events;
      else delete current.hooks.events;
      if (manifest) {
        if (manifest.previousEnabled === undefined) delete current.hooks.enabled;
        else current.hooks.enabled = manifest.previousEnabled;
        if (!manifest.hadHooksSection && Object.keys(current.hooks).length === 0) delete current.hooks;
      }
      await writeJsonAtomic(configPath, current);
    }
    await promises.rm(manifestPath, { force: true });
  }

  async checkHealth() {
    const issues = [];
    const configPath = getZCodeConfigPath();
    const available = isZCodeInstalled();
    const current = await readJson(configPath);
    if (!current) issues.push("ZCode Hook 尚未连接");
    else {
      if (current.hooks?.enabled !== true) issues.push("ZCode hooks.enabled 未启用");
      issues.push(...verifyHookGroups(current.hooks?.events, ZCODE_EVENTS, buildHookCommand(this.agentId), this.agentId));
    }
    return {
      agentId: this.agentId,
      available,
      installed: issues.length === 0,
      issues,
      manifestPath: getManifestPath(this.agentId),
      configPaths: [configPath]
    };
  }
}

class ClaudeCompatibleWorkAgentHookManager {
  constructor({ agentId, label, getConfigPath, isInstalled, legacySources = [] }) {
    this.agentId = agentId;
    this.label = label;
    this.getConfigPath = getConfigPath;
    this.isInstalled = isInstalled;
    this.legacySources = legacySources;
  }

  async install() {
    const manifestPath = getManifestPath(this.agentId);
    const previousManifest = await readJson(manifestPath);
    const command = buildHookCommand(this.agentId);
    const configPath = this.getConfigPath();
    const current = await readJson(configPath, { strict: true }) ?? {};
    const previous = previousManifest?.configs?.find((entry) => entry.configPath === configPath);
    const hadHooksSection = previous?.hadHooksSection ?? Object.hasOwn(current, "hooks");
    let hooks = current.hooks;
    for (const legacySource of this.legacySources) hooks = removeHookGroups(hooks, legacySource);
    current.hooks = mergeHookGroups(hooks, WORKBUDDY_EVENTS, command, this.agentId);
    await writeJsonAtomic(configPath, current);
    const configs = [{ configPath, hadHooksSection }];
    await writeJsonAtomic(manifestPath, {
      configs,
      events: WORKBUDDY_EVENTS.map(({ event }) => event),
      installedAt: previousManifest?.installedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    log.info("[%sHookManager] installed hooks to %s", this.label, configPath);
  }

  async uninstall() {
    const manifestPath = getManifestPath(this.agentId);
    const manifest = await readJson(manifestPath);
    const configs = manifest?.configs ?? [{ configPath: this.getConfigPath() }];
    for (const config of configs) {
      const current = await readJson(config.configPath, { strict: true });
      if (!current?.hooks || typeof current.hooks !== "object") continue;
      const hooks = removeHookGroups(current.hooks, this.agentId);
      if (Object.keys(hooks).length) current.hooks = hooks;
      else if (!config.hadHooksSection) delete current.hooks;
      else current.hooks = {};
      await writeJsonAtomic(config.configPath, current);
    }
    await promises.rm(manifestPath, { force: true });
  }

  async checkHealth() {
    const issues = [];
    const manifest = await readJson(getManifestPath(this.agentId));
    const manifestPaths = manifest?.configs?.map(({ configPath }) => configPath).filter(Boolean) ?? [];
    const configPaths = manifestPaths.length ? manifestPaths : [this.getConfigPath()];
    const command = buildHookCommand(this.agentId);
    for (const configPath of configPaths) {
      const current = await readJson(configPath);
      if (!current) {
        issues.push(`${this.label} Hook 尚未连接：${configPath}`);
        continue;
      }
      issues.push(...verifyHookGroups(current.hooks, WORKBUDDY_EVENTS, command, this.agentId));
    }
    return {
      agentId: this.agentId,
      available: this.isInstalled(),
      installed: issues.length === 0,
      issues,
      manifestPath: getManifestPath(this.agentId),
      configPaths
    };
  }
}

class WorkBuddyHookManager extends ClaudeCompatibleWorkAgentHookManager {
  constructor() {
    super({
      agentId: "workbuddy",
      label: "WorkBuddy",
      getConfigPath: getWorkBuddyConfigPath,
      isInstalled: isWorkBuddyInstalled
    });
  }
}

class CodeBuddyHookManager extends ClaudeCompatibleWorkAgentHookManager {
  constructor() {
    super({
      agentId: "codebuddy",
      label: "CodeBuddy",
      getConfigPath: getCodeBuddyConfigPath,
      isInstalled: isCodeBuddyInstalled,
      legacySources: ["workbuddy"]
    });
  }
}

module.exports = {
  ZCODE_EVENTS,
  WORKBUDDY_EVENTS,
  ZCodeHookManager,
  WorkBuddyHookManager,
  CodeBuddyHookManager,
  getZCodeConfigPath,
  getWorkBuddyConfigPath,
  getCodeBuddyConfigPath,
  mergeHookGroups,
  removeHookGroups,
  verifyHookGroups,
  isWorkIslandHookGroup
};
