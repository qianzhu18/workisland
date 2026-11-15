"use strict";

const fs = require("node:fs");
const path = require("node:path");
const promises = require("node:fs/promises");

const ALMA_EVENTS = Object.freeze([
  "thread.created",
  "thread.deleted",
  "chat.message.willSend",
  "chat.message.didReceive",
  "tool.willExecute",
  "tool.didExecute",
  "tool.onError"
]);

function getAlmaHooksPath(homeDir) {
  return path.join(homeDir, ".config", "alma", "hooks.json");
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isAlmaHookCommand(command) {
  return typeof command === "string"
    && (command.includes("flux-hooks") || command.includes("hooks-cli/index."))
    && /--source\s+['"]?alma['"]?(?:\s|$)/.test(command);
}

function isAlmaHookEntry(entry) {
  return isPlainObject(entry) && isAlmaHookCommand(entry.command);
}

function isAlmaHookGroup(group) {
  return isPlainObject(group) && Array.isArray(group.hooks) && group.hooks.some(isAlmaHookEntry);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await promises.readFile(filePath, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read Alma hooks at ${filePath}: ${reason}`);
  }
}

async function writeJson(filePath, data) {
  await promises.mkdir(path.dirname(filePath), { recursive: true });
  await promises.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function stripAlmaCommands(groups) {
  if (!Array.isArray(groups)) return { groups: [], removed: false };
  let removed = false;
  const next = [];
  for (const group of groups) {
    if (!isPlainObject(group) || !Array.isArray(group.hooks)) {
      next.push(group);
      continue;
    }
    let groupRemoved = false;
    const hooks = group.hooks.filter((entry) => {
      if (!isAlmaHookEntry(entry)) return true;
      groupRemoved = true;
      removed = true;
      return false;
    });
    if (hooks.length === 0) {
      if (groupRemoved) continue;
      next.push(group);
      continue;
    }
    next.push(hooks.length === group.hooks.length ? group : { ...group, hooks });
  }
  return { groups: next, removed };
}

function almaHookGroup(command) {
  return {
    matcher: ".*",
    hooks: [{ type: "command", command, timeout: 10000, enabled: true }]
  };
}

async function installAlmaHooks({ homeDir, hookCommand }) {
  if (!homeDir || typeof hookCommand !== "string" || !hookCommand.trim()) {
    throw new Error("homeDir and hookCommand are required");
  }
  const configPath = getAlmaHooksPath(homeDir);
  const settings = await readJson(configPath) ?? {};
  if (!isPlainObject(settings)) {
    throw new Error(`Alma hooks config at ${configPath} is not an object`);
  }
  if (settings.hooks != null && !isPlainObject(settings.hooks)) {
    throw new Error(`Alma hooks section at ${configPath} is not an object`);
  }
  const hooks = { ...(settings.hooks ?? {}) };
  for (const event of ALMA_EVENTS) {
    const { groups } = stripAlmaCommands(hooks[event]);
    hooks[event] = [...groups, almaHookGroup(hookCommand)];
  }
  settings.hooks = hooks;
  await writeJson(configPath, settings);
  return { configPath, installedEvents: [...ALMA_EVENTS] };
}

async function uninstallAlmaHooks(homeDir) {
  const configPath = getAlmaHooksPath(homeDir);
  const settings = await readJson(configPath);
  if (!settings || !isPlainObject(settings.hooks)) return { configPath, removed: false };
  let removed = false;
  for (const event of Object.keys(settings.hooks)) {
    const stripped = stripAlmaCommands(settings.hooks[event]);
    if (stripped.removed) removed = true;
    if (stripped.groups.length === 0) delete settings.hooks[event];
    else settings.hooks[event] = stripped.groups;
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  if (Object.keys(settings).length === 0) {
    await promises.unlink(configPath).catch(() => {});
  } else {
    await writeJson(configPath, settings);
  }
  return { configPath, removed };
}

async function checkAlmaHooks({ homeDir, hookCommand }) {
  const configPath = getAlmaHooksPath(homeDir);
  const issues = [];
  let settings;
  try {
    settings = await readJson(configPath);
  } catch (err) {
    issues.push(err instanceof Error ? err.message : String(err));
    return { configPath, issues };
  }
  if (!settings?.hooks || !isPlainObject(settings.hooks)) {
    issues.push("No hooks section found in Alma settings");
    return { configPath, issues };
  }
  for (const event of ALMA_EVENTS) {
    const groups = settings.hooks[event];
    if (!Array.isArray(groups) || !groups.some(isAlmaHookGroup)) {
      issues.push(`Missing hook for event: ${event}`);
      continue;
    }
    const entry = groups.find(isAlmaHookGroup)?.hooks?.find(isAlmaHookEntry);
    if (entry && hookCommand && entry.command !== hookCommand) {
      issues.push(`Stale command for ${event}: expected ${hookCommand}`);
    }
  }
  return { configPath, issues };
}

function isAlmaAvailable(homeDir, platform = process.platform) {
  const candidates = [];
  if (platform === "darwin") {
    candidates.push("/Applications/Alma.app", path.join(homeDir, "Applications", "Alma.app"));
  }
  if (candidates.some((candidate) => fs.existsSync(candidate))) return true;
  const configDir = path.join(homeDir, ".config", "alma");
  return ["USER.md", "SOUL.md", "api-spec.md"].some((name) => fs.existsSync(path.join(configDir, name)));
}

module.exports = {
  ALMA_EVENTS,
  getAlmaHooksPath,
  isAlmaHookCommand,
  installAlmaHooks,
  uninstallAlmaHooks,
  checkAlmaHooks,
  isAlmaAvailable
};
