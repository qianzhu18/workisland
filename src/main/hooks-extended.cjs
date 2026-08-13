"use strict";

const electron = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const child_process = require("node:child_process");
const promises = require("node:fs/promises");
const log = require("electron-log");
const utils = require("@electron-toolkit/utils");
const toml__namespace = require("@iarna/toml");
const yaml__namespace = require("js-yaml");
const { shellQuote, buildDevHooksCliCommand, wrapWithInstallCheck } = require("./hook-shared.cjs");

const HERMES_EVENTS = [
  { event: "on_session_start" },
  { event: "on_session_reset" },
  { event: "pre_llm_call" },
  { event: "post_llm_call" },
  { event: "pre_tool_call", timeout: 300 },
  { event: "post_tool_call" },
  { event: "pre_approval_request" },
  { event: "post_approval_response" },
  { event: "on_session_finalize" },
  { event: "on_session_end" },
  { event: "subagent_stop" }
];
const FLUX_MARKERS$2 = ["flux-hooks", "hooks-cli/index."];
const YAML_DUMP_OPTIONS = {
  indent: 2,
  lineWidth: -1,
  quotingType: "'",
  noRefs: true
};
function containsFluxMarker$2(text) {
  return FLUX_MARKERS$2.some((marker) => text.includes(marker));
}
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function isFluxHookEntry(entry) {
  if (!isPlainObject(entry)) return false;
  return typeof entry.command === "string" && containsFluxMarker$2(entry.command);
}
function buildHookEntry(command, timeout) {
  const entry = { command };
  if (timeout !== void 0) entry.timeout = timeout;
  return entry;
}
async function readText$1(filePath, strict = false) {
  try {
    return await promises.readFile(filePath, "utf-8");
  } catch (err) {
    if (err.code !== "ENOENT" && strict) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read Hermes config at ${filePath}: ${reason}`);
    }
    return null;
  }
}
async function loadConfig(filePath, strict = false) {
  const raw = await readText$1(filePath, strict);
  if (raw === null) return { doc: null, raw: null, parseError: null };
  if (raw.trim() === "") return { doc: {}, raw, parseError: null };
  try {
    const parsed = yaml__namespace.load(raw, { json: true });
    if (parsed === null || parsed === void 0) return { doc: {}, raw, parseError: null };
    if (!isPlainObject(parsed)) {
      return { doc: null, raw, parseError: new Error("top-level YAML is not a mapping") };
    }
    return { doc: parsed, raw, parseError: null };
  } catch (err) {
    return { doc: null, raw, parseError: err instanceof Error ? err : new Error(String(err)) };
  }
}
async function backupFile$1(filePath) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const backup = `${filePath}.backup.${timestamp}`;
  await promises.copyFile(filePath, backup);
  return backup;
}
async function writeYamlAtomically(filePath, doc) {
  const parentDir = path.dirname(filePath);
  const tempPath = path.join(
    parentDir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );
  await promises.mkdir(parentDir, { recursive: true });
  try {
    await promises.writeFile(tempPath, yaml__namespace.dump(doc, YAML_DUMP_OPTIONS), "utf-8");
    await promises.rename(tempPath, filePath);
  } catch (error) {
    try {
      await promises.unlink(tempPath);
    } catch {
    }
    throw error;
  }
}
function getHookEntries(value) {
  return Array.isArray(value) ? value.filter((entry) => isPlainObject(entry)) : [];
}
function getHermesConfigCandidates(homeDir) {
  return [
    path.join(homeDir, ".hermes", "config.yaml"),
    path.join(homeDir, ".hermes", "cli-config.yaml")
  ];
}
function getHermesConfigPath(homeDir) {
  return path.join(homeDir, ".hermes", "config.yaml");
}
function getHermesLegacyConfigPath(homeDir) {
  return path.join(homeDir, ".hermes", "cli-config.yaml");
}
function removeFluxHookEntries(doc) {
  const hooks = isPlainObject(doc.hooks) ? { ...doc.hooks } : null;
  if (!hooks) return false;
  let changed = false;
  for (const event of Object.keys(hooks)) {
    const existing = getHookEntries(hooks[event]);
    const filtered = existing.filter((entry) => !isFluxHookEntry(entry));
    if (filtered.length !== existing.length) {
      changed = true;
    }
    if (filtered.length > 0) {
      hooks[event] = filtered;
    } else if (Array.isArray(hooks[event])) {
      delete hooks[event];
    }
  }
  if (!changed) return false;
  if (Object.keys(hooks).length === 0) {
    delete doc.hooks;
  } else {
    doc.hooks = hooks;
  }
  return true;
}
async function installHermesHook(ctx) {
  const configPath = getHermesConfigPath(ctx.homeDir);
  const legacyConfigPath = getHermesLegacyConfigPath(ctx.homeDir);
  const { doc, raw, parseError } = await loadConfig(configPath);
  let workDoc;
  if (parseError) {
    if (raw !== null) {
      await backupFile$1(configPath);
    }
    workDoc = {};
  } else {
    workDoc = doc ?? {};
  }
  if (workDoc.hooks_auto_accept === void 0) {
    workDoc.hooks_auto_accept = true;
  }
  const hooks = isPlainObject(workDoc.hooks) ? { ...workDoc.hooks } : {};
  for (const { event, timeout } of HERMES_EVENTS) {
    const existing = getHookEntries(hooks[event]).filter((entry) => !isFluxHookEntry(entry));
    existing.push(buildHookEntry(ctx.hookCommand, timeout));
    hooks[event] = existing;
  }
  workDoc.hooks = hooks;
  await writeYamlAtomically(configPath, workDoc);
  if (legacyConfigPath !== configPath) {
    const legacy = await loadConfig(legacyConfigPath);
    if (!legacy.parseError && legacy.doc && removeFluxHookEntries(legacy.doc)) {
      await writeYamlAtomically(legacyConfigPath, legacy.doc);
    }
  }
  return configPath;
}
async function uninstallHermesHook(homeDir, options) {
  const cleanedPaths = [];
  for (const configPath of getHermesConfigCandidates(homeDir)) {
    const { doc, raw, parseError } = await loadConfig(configPath, options?.strict);
    if (raw === null) continue;
    if (parseError) {
      continue;
    }
    if (!doc) continue;
    if (!removeFluxHookEntries(doc)) continue;
    await writeYamlAtomically(configPath, doc);
    cleanedPaths.push(configPath);
  }
  return cleanedPaths;
}
async function checkHermesHook(homeDir, expectedCommand) {
  const configPath = getHermesConfigPath(homeDir);
  const loaded = await loadConfig(configPath);
  if (loaded.raw === null) {
    return {
      configPath,
      installed: false,
      issues: [`Hermes config not found: ${configPath}`]
    };
  }
  const issues = [];
  if (loaded.parseError) {
    return {
      configPath,
      installed: false,
      issues: [`Failed to parse Hermes config: ${loaded.parseError.message}`]
    };
  }
  if (!isPlainObject(loaded.doc?.hooks)) {
    return {
      configPath,
      installed: false,
      issues: ["No hooks section found in Hermes config"]
    };
  }
  const hooks = loaded.doc.hooks;
  for (const { event } of HERMES_EVENTS) {
    const entries = getHookEntries(hooks[event]);
    if (entries.length === 0) {
      issues.push(`Missing hook for event: ${event}`);
      continue;
    }
    const matched = entries.find((entry) => isFluxHookEntry(entry));
    if (!matched) {
      issues.push(`Missing Flux hook entry for event: ${event}`);
      continue;
    }
    if (matched.command !== expectedCommand) {
      issues.push(`Stale command for ${event}: expected ${expectedCommand}`);
    }
  }
  return {
    configPath,
    installed: issues.length === 0,
    issues
  };
}
function getManifestDir$1() {
  return path.join(os.homedir(), ".flux", "hooks");
}
function getManifestPath$2() {
  return path.join(getManifestDir$1(), "hermes-manifest.json");
}
function getHookBinaryPath$3() {
  const resourcesPath = process.resourcesPath ?? path.join(electron.app.getAppPath(), "resources");
  return path.resolve(resourcesPath, "bin", "flux-hooks");
}
function buildCommand$2() {
  if (utils.is.dev) {
    return buildDevHooksCliCommand("hermes");
  }
  const bin = getHookBinaryPath$3();
  return `/bin/sh -c '[ -e "$1" ] || exit 0; ELECTRON_RUN_AS_NODE=1 exec "$1" "$2" --source hermes' sh ${shellQuote(process.execPath)} ${shellQuote(bin)}`;
}
async function readJson(filePath) {
  try {
    const raw = await promises.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function writeJson$2(filePath, data) {
  await promises.mkdir(getManifestDir$1(), { recursive: true });
  await promises.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
class HermesHookManager {
  agentId = "hermes";
  async install() {
    const command = buildCommand$2();
    const configPath = await installHermesHook({
      homeDir: os.homedir(),
      hookCommand: command
    });
    const manifest = {
      configPath,
      events: HERMES_EVENTS.map((item) => item.event),
      hookCommand: command,
      installedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await writeJson$2(getManifestPath$2(), manifest);
  }
  async uninstall() {
    await uninstallHermesHook(os.homedir());
    try {
      await promises.unlink(getManifestPath$2());
    } catch {
    }
  }
  async checkHealth() {
    const issues = [];
    const manifestPath = getManifestPath$2();
    const binaryPath = getHookBinaryPath$3();
    if (!utils.is.dev && !fs.existsSync(binaryPath)) {
      issues.push(`Hook binary not found: ${binaryPath}`);
    }
    const command = buildCommand$2();
    const health = await checkHermesHook(os.homedir(), command);
    issues.push(...health.issues);
    const manifest = await readJson(manifestPath);
    if (manifest && manifest.hookCommand !== command) {
      issues.push(`Stale manifest command: expected ${command}`);
    }
    return {
      agentId: "hermes",
      installed: issues.length === 0 && health.installed,
      issues,
      manifestPath
    };
  }
}
const AIDEN_EVENTS = [
  { event: "SessionStart" },
  { event: "SessionEnd" },
  { event: "PreToolUse" },
  { event: "PostToolUse" },
  { event: "UserPromptSubmit" },
  { event: "Notification" },
  { event: "Stop" },
  { event: "SubagentStart" },
  { event: "SubagentStop" },
  { event: "PreCompact" },
  { event: "PermissionRequest" }
];
function isFluxHookCommand(command) {
  return command.includes("flux-hooks") || command.includes("hooks-cli/index.");
}
function getAidenConfigPath(homeDir) {
  return path.join(homeDir, ".aiden", "settings.json");
}
function isFluxEntry$1(entry) {
  if (!Array.isArray(entry.hooks)) return false;
  return entry.hooks.some((h) => h.command && isFluxHookCommand(h.command));
}
async function installAidenHook(ctx) {
  const configPath = getAidenConfigPath(ctx.homeDir);
  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      const raw = await promises.readFile(configPath, "utf-8");
      config = JSON.parse(raw);
    } catch {
      config = {};
    }
  }
  if (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks)) {
    config.hooks = {};
  }
  const hooks = config.hooks;
  for (const { event, matcher } of AIDEN_EVENTS) {
    let entries = Array.isArray(hooks[event]) ? hooks[event] : [];
    entries = entries.filter((entry) => !isFluxEntry$1(entry));
    entries.push({
      matcher: matcher || "",
      hooks: [
        {
          type: "command",
          command: ctx.hookCommand
        }
      ]
    });
    hooks[event] = entries;
  }
  config.hooks = hooks;
  await promises.mkdir(path.dirname(configPath), { recursive: true });
  await promises.writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return configPath;
}
async function uninstallAidenHook(homeDir, options) {
  const configPath = getAidenConfigPath(homeDir);
  if (!fs.existsSync(configPath)) return;
  let raw;
  try {
    raw = await promises.readFile(configPath, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") return;
    return;
  }
  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    return;
  }
  if (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks)) return;
  const hooks = config.hooks;
  let changed = false;
  for (const event of Object.keys(hooks)) {
    if (!Array.isArray(hooks[event])) continue;
    const before = hooks[event].length;
    hooks[event] = hooks[event].filter((entry) => !isFluxEntry$1(entry));
    if (hooks[event].length !== before) changed = true;
    if (hooks[event].length === 0) {
      delete hooks[event];
    }
  }
  if (!changed) return;
  if (Object.keys(hooks).length === 0) {
    delete config.hooks;
  } else {
    config.hooks = hooks;
  }
  await promises.writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
async function writeJson$1(filePath, data) {
  await promises.mkdir(path.dirname(filePath), { recursive: true });
  await promises.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
function getHookBinaryPath$2() {
  const resourcesPath = process.resourcesPath ?? path.join(electron.app.getAppPath(), "resources");
  return path.resolve(resourcesPath, "bin", "flux-hooks");
}
function getConfigPath() {
  return getAidenConfigPath(os.homedir());
}
function getManifestPath$1() {
  return path.join(os.homedir(), ".flux", "hooks", "aiden-manifest.json");
}
function buildCommand$1() {
  if (utils.is.dev) {
    return buildDevHooksCliCommand("aiden");
  }
  const bin = getHookBinaryPath$2();
  return wrapWithInstallCheck(
    process.execPath,
    `ELECTRON_RUN_AS_NODE=1 ${shellQuote(process.execPath)} ${shellQuote(bin)} --source aiden`
  );
}
function isFluxHook(cmd) {
  return cmd.includes("flux-hooks") || cmd.includes("hooks-cli/index.");
}
class AidenHookManager {
  agentId = "aiden";
  async install(_options) {
    const command = buildCommand$1();
    const configPath = await installAidenHook({
      homeDir: os.homedir(),
      hookCommand: command
    });
    let aidenVersion;
    try {
      const raw = child_process.execSync("pnpm list -g @aiden-cli/core --json 2>/dev/null", { encoding: "utf-8" });
      const parsed = JSON.parse(raw);
      aidenVersion = parsed?.[0]?.dependencies?.["@aiden-cli/core"]?.version || parsed?.[0]?.devDependencies?.["@aiden-cli/core"]?.version;
    } catch {
    }
    const manifest = {
      configPath,
      events: AIDEN_EVENTS.map((e) => e.event),
      installedAt: (/* @__PURE__ */ new Date()).toISOString(),
      aidenVersion
    };
    await writeJson$1(getManifestPath$1(), manifest);
    log.info("[AidenHookManager] Installed hooks to %s (aiden %s)", configPath, aidenVersion || "unknown");
  }
  async uninstall() {
    await uninstallAidenHook(os.homedir());
    const manifestPath = getManifestPath$1();
    try {
      await promises.unlink(manifestPath);
    } catch {
    }
    log.info("[AidenHookManager] Uninstalled hooks from %s", getConfigPath());
  }
  async checkHealth() {
    const issues = [];
    const configPath = getConfigPath();
    const binaryPath = getHookBinaryPath$2();
    if (!utils.is.dev && !fs.existsSync(binaryPath)) {
      issues.push(`Hook binary not found: ${binaryPath}`);
    }
    if (!fs.existsSync(configPath)) {
      issues.push(`Aiden config not found: ${configPath}`);
      return { agentId: "aiden", installed: false, issues, manifestPath: configPath };
    }
    let config;
    try {
      const raw = await promises.readFile(configPath, "utf-8");
      config = JSON.parse(raw);
    } catch {
      issues.push(`Failed to parse Aiden config: ${configPath}`);
      return { agentId: "aiden", installed: false, issues, manifestPath: configPath };
    }
    if (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks)) {
      issues.push("No hooks section found in Aiden config");
      return { agentId: "aiden", installed: false, issues, manifestPath: configPath };
    }
    const hooks = config.hooks;
    const command = buildCommand$1();
    for (const { event } of AIDEN_EVENTS) {
      const entries = hooks[event];
      if (!Array.isArray(entries)) {
        issues.push(`Missing hook for event: ${event}`);
        continue;
      }
      const matched = entries.find(
        (entry) => Array.isArray(entry.hooks) && entry.hooks.some((h) => h.command && isFluxHook(h.command))
      );
      if (!matched) {
        issues.push(`Missing hook for event: ${event}`);
      } else {
        const fluxHook = matched.hooks.find((h) => h.command && isFluxHook(h.command));
        if (fluxHook && fluxHook.command !== command) {
          issues.push(`Stale command for ${event}: expected ${command}`);
        }
      }
    }
    const installed = issues.length === 0;
    return {
      agentId: "aiden",
      installed,
      issues,
      manifestPath: getManifestPath$1()
    };
  }
}
const TRAEX_EVENTS = [
  { event: "SessionStart" },
  { event: "UserPromptSubmit" },
  { event: "PreToolUse" },
  { event: "PostToolUse" },
  // PermissionRequest 需要用户在 Island 审批，timeout 必须足够长
  { event: "PermissionRequest", timeout: 86400 },
  { event: "Notification" },
  { event: "SessionEnd" },
  { event: "Stop" },
  { event: "PreCompact" },
  { event: "PostCompact" },
  { event: "SubagentStart" },
  { event: "SubagentStop" }
];
const FLUX_MARKERS$1 = ["flux-hooks", "hooks-cli/index."];
function containsFluxMarker$1(text) {
  return FLUX_MARKERS$1.some((m) => text.includes(m));
}
function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function normalizeEventSections(value) {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value)) return [value];
  return [];
}
function parseTraexToml(content) {
  const parsed = toml__namespace.parse(content);
  if (!isRecord(parsed)) {
    throw new Error("top-level TOML is not a table");
  }
  return parsed;
}
function serializeTraexToml(doc) {
  const ordered = {};
  if (doc.features) ordered.features = doc.features;
  for (const [key, value] of Object.entries(doc)) {
    if (key !== "features" && key !== "hooks") ordered[key] = value;
  }
  if (doc.hooks) ordered.hooks = doc.hooks;
  return toml__namespace.stringify(ordered);
}
function normalizeHooksState(value, logger) {
  if (isRecord(value)) return value;
  if (!Array.isArray(value)) return void 0;
  const merged = {};
  for (const section of value) {
    if (!isRecord(section)) continue;
    for (const [key, entry] of Object.entries(section)) {
      if (key in merged) {
        logger?.warn(`[traexCli] normalizeHooksState: state key "${key}" 出现重复，将覆盖为最新值`);
      }
      merged[key] = entry;
    }
  }
  return Object.keys(merged).length > 0 ? merged : void 0;
}
function isFluxEntry(entry) {
  return typeof entry.command === "string" && containsFluxMarker$1(entry.command);
}
function getTraexCliConfigPath(homeDir) {
  return path.join(homeDir, ".trae", "traecli.toml");
}
async function readText(filePath) {
  try {
    return await promises.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}
async function backupFile(filePath) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const backup = `${filePath}.backup.${timestamp}`;
  await promises.copyFile(filePath, backup);
  return backup;
}
async function installTraexCliHook(ctx, options) {
  const logger = options?.logger;
  const configPath = getTraexCliConfigPath(ctx.homeDir);
  const raw = await readText(configPath);
  let doc;
  if (raw === null || raw.trim() === "") {
    doc = {};
  } else {
    try {
      doc = parseTraexToml(raw);
    } catch {
      if (fs.existsSync(configPath)) {
        await backupFile(configPath);
      }
      doc = {};
    }
  }
  if (!isRecord(doc.features)) {
    doc.features = {};
  }
  doc.features.hooks = true;
  if (!isRecord(doc.hooks)) {
    doc.hooks = {};
  }
  const normalizedState = normalizeHooksState(doc.hooks.state, logger);
  if (normalizedState) {
    doc.hooks.state = normalizedState;
  } else if (doc.hooks.state !== void 0) {
    logger?.warn(`[traexCli] hooks.state 无法修复（原值类型：${typeof doc.hooks.state}），已清除`);
    delete doc.hooks.state;
  }
  for (const { event, timeout } of TRAEX_EVENTS) {
    const existingSections = normalizeEventSections(doc.hooks[event]);
    const sections = existingSections.length > 0 ? existingSections : [{}];
    let targetSection;
    for (const section of sections) {
      const hooks = Array.isArray(section.hooks) ? section.hooks : [];
      const hadFluxEntry = hooks.some(isFluxEntry);
      section.hooks = hooks.filter((e) => !isFluxEntry(e));
      if (hadFluxEntry && !targetSection) {
        targetSection = section;
      }
    }
    const newEntry = { type: "command", command: ctx.hookCommand };
    if (timeout) newEntry.timeout = timeout;
    targetSection ??= sections[0];
    targetSection.hooks = [...targetSection.hooks ?? [], newEntry];
    doc.hooks[event] = sections;
  }
  const newContent = serializeTraexToml(doc);
  await promises.mkdir(path.dirname(configPath), { recursive: true });
  await promises.writeFile(configPath, newContent, "utf-8");
  return configPath;
}
async function uninstallTraexCliHook(homeDir) {
  const configPath = getTraexCliConfigPath(homeDir);
  const raw = await readText(configPath);
  if (raw === null) return;
  let doc;
  try {
    doc = parseTraexToml(raw);
  } catch {
    return;
  }
  if (!isRecord(doc.hooks)) return;
  let changed = false;
  for (const [event, rawSections] of Object.entries(doc.hooks)) {
    if (event === "state") continue;
    const sections = normalizeEventSections(rawSections);
    if (sections.length === 0) continue;
    const sectionsToRemove = /* @__PURE__ */ new Set();
    for (const section of sections) {
      const hooks = Array.isArray(section.hooks) ? section.hooks : [];
      const filtered = hooks.filter((e) => !isFluxEntry(e));
      if (filtered.length !== hooks.length) {
        changed = true;
        if (filtered.length === 0) {
          sectionsToRemove.add(section);
        } else {
          section.hooks = filtered;
        }
      }
    }
    const preserved = sections.filter((section) => !sectionsToRemove.has(section) && Object.keys(section).length > 0);
    if (preserved.length === 0) {
      delete doc.hooks[event];
    } else {
      doc.hooks[event] = preserved;
    }
  }
  if (changed) {
    const newContent = serializeTraexToml(doc);
    await promises.writeFile(configPath, newContent, "utf-8");
  }
}
const FLUX_MARKERS = ["flux-hooks", "hooks-cli/index."];
const TRAEX_SOURCE_MARKER = /--source\s+(?:'traex'|"traex"|traex)(?:\s|$)/;
function hasTraexSourceMarker(text) {
  return typeof text === "string" && TRAEX_SOURCE_MARKER.test(text);
}
function containsFluxMarker(text) {
  return FLUX_MARKERS.some((m) => text.includes(m));
}
function getManifestDir() {
  return path.join(os.homedir(), ".flux", "hooks");
}
function getManifestPath() {
  return path.join(getManifestDir(), "traex-manifest.json");
}
function getHookBinaryPath$1() {
  const resourcesPath = process.resourcesPath ?? path.join(electron.app.getAppPath(), "resources");
  return path.resolve(resourcesPath, "bin", "flux-hooks");
}
function buildCommand() {
  if (utils.is.dev) {
    return buildDevHooksCliCommand("traex");
  }
  const bin = getHookBinaryPath$1();
  return wrapWithInstallCheck(
    process.execPath,
    `ELECTRON_RUN_AS_NODE=1 ${shellQuote(process.execPath)} ${shellQuote(bin)} --source traex`
  );
}
async function writeJson(filePath, data) {
  const dir = path.join(filePath, "..");
  await promises.mkdir(dir, { recursive: true });
  await promises.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
class TraexCliHookManager {
  agentId = "traex";
  async install() {
    const command = buildCommand();
    const configPath = await installTraexCliHook(
      { homeDir: os.homedir(), hookCommand: command },
      { logger: log }
    );
    const manifest = {
      configPath,
      events: TRAEX_EVENTS.map((e) => e.event),
      hookCommand: command,
      installedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await writeJson(getManifestPath(), manifest);
  }
  async uninstall() {
    await uninstallTraexCliHook(os.homedir());
    try {
      await promises.unlink(getManifestPath());
    } catch {
    }
  }
  async checkHealth() {
    const issues = [];
    const manifestPath = getManifestPath();
    const binaryPath = getHookBinaryPath$1();
    if (!utils.is.dev && !fs.existsSync(binaryPath)) {
      issues.push(`Hook binary not found: ${binaryPath}`);
    }
    const configPath = getTraexCliConfigPath(os.homedir());
    let raw = null;
    try {
      raw = await promises.readFile(configPath, "utf-8");
    } catch {
    }
    if (raw === null) {
      issues.push("Traex CLI config file not found: ~/.trae/traecli.toml");
      return { agentId: "traex", installed: false, issues, manifestPath };
    }
    if (!containsFluxMarker(raw)) {
      issues.push("Hooks not installed in Traex CLI config (~/.trae/traecli.toml)");
      return { agentId: "traex", installed: false, issues, manifestPath };
    }
    if (!hasTraexSourceMarker(raw)) {
      issues.push("Stale hook command: expected --source traex");
      return { agentId: "traex", installed: false, issues, manifestPath };
    }
    for (const { event } of TRAEX_EVENTS) {
      if (!raw.includes(`[[hooks.${event}.hooks]]`)) {
        issues.push(`Missing event: ${event}`);
      }
    }
    return { agentId: "traex", installed: issues.length === 0, issues, manifestPath };
  }
}
module.exports = { HermesHookManager, AidenHookManager, TraexCliHookManager, hasTraexSourceMarker };
