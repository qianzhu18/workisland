"use strict";

const electron = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const promises = require("node:fs/promises");
const log = require("electron-log");
const utils = require("@electron-toolkit/utils");
const yaml__namespace = require("js-yaml");
const {
  shellQuote,
  buildDevHooksCliCommand,
  wrapWithInstallCheck,
  isCursorBitsEntry
} = require("./hook-shared.cjs");

const COCO_EVENTS = [
  { event: "SessionStart" },
  { event: "UserPromptSubmit" },
  { event: "PreToolUse" },
  { event: "PostToolUse" },
  { event: "PostToolUseFailure" },
  { event: "PermissionRequest", timeout: 86400 },
  { event: "Notification" },
  { event: "SubagentStart" },
  { event: "SubagentStop" },
  { event: "Stop" },
  { event: "SessionEnd" }
];

const FLUX_MARKERS$4 = ["flux-hooks", "hooks-cli/index."];
const YAML_DUMP_OPTIONS$1 = {
  indent: 4,
  lineWidth: -1,
  quotingType: "'",
  noRefs: true
};
function containsFluxMarker$5(text) {
  return FLUX_MARKERS$4.some((m) => text.includes(m));
}
function isFluxHookEntry$3(entry) {
  if (!entry || typeof entry !== "object") return false;
  const command = entry.command;
  return typeof command === "string" && containsFluxMarker$5(command);
}
function getCocoConfigCandidates(homeDir) {
  return [
    path.join(homeDir, ".trae", "traecli.yaml"),
    path.join(homeDir, ".trae", "coco.yaml"),
    path.join(homeDir, "Library", "Application Support", "coco", "coco.yaml")
  ];
}
function resolveCocoConfigPath(homeDir) {
  for (const candidate of getCocoConfigCandidates(homeDir)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return getCocoConfigCandidates(homeDir)[0];
}
async function readText$3(filePath, strict = false) {
  try {
    return await promises.readFile(filePath, "utf-8");
  } catch (err) {
    if (err.code !== "ENOENT" && strict) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read TRAE CLI config at ${filePath}: ${reason}`);
    }
    return null;
  }
}
async function loadConfig$2(filePath, strict = false) {
  const raw = await readText$3(filePath, strict);
  if (raw === null) return { doc: null, raw: null, parseError: null };
  if (raw.trim() === "") return { doc: {}, raw, parseError: null };
  try {
    const parsed = yaml__namespace.load(raw, { json: true });
    if (parsed === null || parsed === void 0) return { doc: {}, raw, parseError: null };
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      return { doc: null, raw, parseError: new Error("top-level YAML is not a mapping") };
    }
    return { doc: parsed, raw, parseError: null };
  } catch (err) {
    return { doc: null, raw, parseError: err instanceof Error ? err : new Error(String(err)) };
  }
}
async function backupFile$2(filePath) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const backup = `${filePath}.backup.${timestamp}`;
  await promises.copyFile(filePath, backup);
  return backup;
}
function buildHookEntry$1(command) {
  return {
    type: "command",
    command,
    matchers: COCO_EVENTS.map(({ event, timeout }) => {
      const matcher = { event };
      if (timeout) matcher.timeout = timeout;
      return matcher;
    })
  };
}
async function installCocoHook(ctx) {
  const configPath = resolveCocoConfigPath(ctx.homeDir);
  const { doc, raw, parseError } = await loadConfig$2(configPath);
  let workDoc;
  if (parseError) {
    if (raw !== null) {
      await backupFile$2(configPath);
    }
    workDoc = {};
  } else {
    workDoc = doc ?? {};
  }
  const existing = Array.isArray(workDoc.hooks) ? workDoc.hooks : [];
  const preserved = existing.filter((e) => !isFluxHookEntry$3(e));
  preserved.push(buildHookEntry$1(ctx.hookCommand));
  workDoc.hooks = preserved;
  const newContent = yaml__namespace.dump(workDoc, YAML_DUMP_OPTIONS$1);
  await promises.mkdir(path.dirname(configPath), { recursive: true });
  await promises.writeFile(configPath, newContent, "utf-8");
  return configPath;
}
async function uninstallCocoHook(homeDir, options) {
  const configPaths = /* @__PURE__ */ new Set([
    ...getCocoConfigCandidates(homeDir),
    ...options?.configPaths ?? []
  ]);
  for (const configPath of configPaths) {
    const { doc, raw, parseError } = await loadConfig$2(configPath, options?.strict);
    if (raw === null) continue;
    if (parseError) {
      options?.logger?.warn(
        "[coco-hooks] skipping uninstall cleanup for %s: %s",
        configPath,
        parseError.message
      );
      if (options?.strict) {
        throw new Error(`Failed to parse TRAE CLI config at ${configPath}: ${parseError.message}`);
      }
      continue;
    }
    if (!doc) continue;
    const existing = Array.isArray(doc.hooks) ? doc.hooks : [];
    const filtered = existing.filter((entry) => !isFluxHookEntry$3(entry));
    if (filtered.length === existing.length) continue;
    if (filtered.length === 0) delete doc.hooks;
    else doc.hooks = filtered;
    await promises.writeFile(configPath, yaml__namespace.dump(doc, YAML_DUMP_OPTIONS$1), "utf-8");
  }
}
const FLUX_MARKERS$3 = ["flux-hooks", "hooks-cli/index."];
const CONFIG_CANDIDATES = [
  path.join(os.homedir(), ".trae", "traecli.yaml"),
  path.join(os.homedir(), ".trae", "coco.yaml"),
  path.join(os.homedir(), "Library", "Application Support", "coco", "coco.yaml")
];
function containsFluxMarker$4(text) {
  return FLUX_MARKERS$3.some((m) => text.includes(m));
}
function isFluxHookEntry$2(entry) {
  if (!entry || typeof entry !== "object") return false;
  const command = entry.command;
  return typeof command === "string" && containsFluxMarker$4(command);
}
function getManifestDir$5() {
  return path.join(os.homedir(), ".flux", "hooks");
}
function getManifestPath$9() {
  return path.join(getManifestDir$5(), "coco-manifest.json");
}
function getHookBinaryPath$9() {
  const resourcesPath = process.resourcesPath ?? path.join(electron.app.getAppPath(), "resources");
  return path.resolve(resourcesPath, "bin", "flux-hooks");
}
function buildCommand$7() {
  if (utils.is.dev) {
    return buildDevHooksCliCommand("coco");
  }
  const bin = getHookBinaryPath$9();
  return wrapWithInstallCheck(
    process.execPath,
    `ELECTRON_RUN_AS_NODE=1 ${shellQuote(process.execPath)} ${shellQuote(bin)} --source coco`
  );
}
async function readText$2(filePath) {
  try {
    return await promises.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}
async function loadConfig$1(filePath) {
  const raw = await readText$2(filePath);
  if (raw === null) return { doc: null, raw: null, parseError: null };
  if (raw.trim() === "") return { doc: {}, raw, parseError: null };
  try {
    const parsed = yaml__namespace.load(raw, { json: true });
    if (parsed === null || parsed === void 0) return { doc: {}, raw, parseError: null };
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      return { doc: null, raw, parseError: new Error("top-level YAML is not a mapping") };
    }
    return { doc: parsed, raw, parseError: null };
  } catch (err) {
    return { doc: null, raw, parseError: err instanceof Error ? err : new Error(String(err)) };
  }
}
async function readJson$c(filePath) {
  try {
    return JSON.parse(await promises.readFile(filePath, "utf-8"));
  } catch {
    return null;
  }
}
async function writeJson$f(filePath, data) {
  const dir = path.join(filePath, "..");
  await promises.mkdir(dir, { recursive: true });
  await promises.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
class CocoHookManager {
  agentId = "coco";
  async install() {
    const command = buildCommand$7();
    const configPath = await installCocoHook({ homeDir: os.homedir(), hookCommand: command });
    const manifest = {
      configPath,
      events: COCO_EVENTS.map((e) => e.event),
      hookCommand: command,
      installedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await writeJson$f(getManifestPath$9(), manifest);
  }
  async uninstall(options = {}) {
    const manifestPath = getManifestPath$9();
    const manifest = await readJson$c(manifestPath);
    await uninstallCocoHook(os.homedir(), {
      logger: log,
      configPaths: manifest?.configPath ? [manifest.configPath] : void 0
    });
    try {
      await promises.unlink(manifestPath);
    } catch {
    }
  }
  async checkHealth() {
    const issues = [];
    const manifestPath = getManifestPath$9();
    const binaryPath = getHookBinaryPath$9();
    if (!utils.is.dev && !fs.existsSync(binaryPath)) {
      issues.push(`Hook binary not found: ${binaryPath}`);
    }
    let configPath = null;
    let loaded = null;
    for (const candidate of CONFIG_CANDIDATES) {
      const result = await loadConfig$1(candidate);
      if (result.raw !== null) {
        configPath = candidate;
        loaded = result;
        break;
      }
    }
    if (!loaded) {
      issues.push("TRAE CLI config file not found in any candidate path");
      return { agentId: "coco", installed: false, issues, manifestPath };
    }
    if (loaded.parseError) {
      issues.push(`Failed to parse ${configPath}: ${loaded.parseError.message}`);
      return { agentId: "coco", installed: false, issues, manifestPath };
    }
    const hooks = Array.isArray(loaded.doc?.hooks) ? loaded.doc.hooks : [];
    const fluxEntries = hooks.filter(isFluxHookEntry$2);
    if (fluxEntries.length === 0) {
      issues.push(`Hooks not installed in TRAE CLI config (${configPath})`);
      return { agentId: "coco", installed: false, issues, manifestPath };
    }
    const expectedCommand = buildCommand$7();
    const matching = fluxEntries.find((e) => e.command === expectedCommand);
    if (!matching) {
      issues.push(`Stale hook command: expected ${expectedCommand}`);
      return { agentId: "coco", installed: false, issues, manifestPath };
    }
    const events2 = new Set(
      (matching.matchers ?? []).map((m) => m?.event).filter((e) => typeof e === "string")
    );
    for (const { event } of COCO_EVENTS) {
      if (!events2.has(event)) {
        issues.push(`Missing event: ${event}`);
      }
    }
    return { agentId: "coco", installed: issues.length === 0, issues, manifestPath };
  }
}
const CURSOR_EVENTS = [
  "sessionStart",
  "sessionEnd",
  "afterAgentResponse",
  "afterAgentThought",
  "afterFileEdit",
  "beforeMCPExecution",
  "afterMCPExecution",
  "beforeShellExecution",
  "afterShellExecution",
  "beforeReadFile",
  "beforeSubmitPrompt",
  "stop"
];
function containsFluxMarker$3(command) {
  return typeof command === "string" && (command.includes("flux-hooks") || command.includes("hooks-cli/index."));
}
function isFluxCursorHookEntry(entry) {
  return containsFluxMarker$3(entry?.command);
}
function getCursorConfigPath(homeDir) {
  return path.join(homeDir, ".cursor", "hooks.json");
}
async function readJson$b(filePath, logger, strict = false) {
  try {
    const raw = await promises.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    const e = err;
    if (e.code !== "ENOENT") {
      logger?.warn("[cursor-hooks] existing config unreadable, recreating config: %s (code=%s)", filePath, e.code ?? "n/a");
      if (strict) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to read Cursor config at ${filePath}: ${reason}`);
      }
    }
    return null;
  }
}
async function writeJson$e(filePath, data) {
  await promises.mkdir(path.dirname(filePath), { recursive: true });
  await promises.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
function buildHooksConfig$1(command) {
  const hooks = {};
  for (const event of CURSOR_EVENTS) {
    hooks[event] = [{ command }];
  }
  return hooks;
}
function countEntries(hooks) {
  let total = 0;
  for (const entries of Object.values(hooks)) total += entries.length;
  return total;
}
function summarizeHooks(hooks, isExtraHook) {
  const keys = Array.from(/* @__PURE__ */ new Set([...Object.keys(hooks), ...CURSOR_EVENTS])).sort();
  return keys.map((event) => {
    const entries = hooks[event] ?? [];
    let flux = 0;
    let bits = 0;
    let other = 0;
    for (const entry of entries) {
      if (isFluxCursorHookEntry(entry)) {
        flux++;
      } else if (isExtraHook?.(entry)) {
        bits++;
      } else {
        other++;
      }
    }
    return `${event}=${entries.length}(flux=${flux},bits=${bits},other=${other})`;
  }).join(", ");
}
function countMatching(entries, predicate) {
  let count = 0;
  for (const entry of entries) {
    if (predicate(entry)) count++;
  }
  return count;
}
function stripExtraHooks(hooks, isExtraHook, events2) {
  if (!isExtraHook) return;
  const targets = events2 ?? Object.keys(hooks);
  for (const event of targets) {
    const entries = hooks[event];
    if (!entries) continue;
    const filtered = entries.filter((entry) => !isExtraHook(entry));
    if (filtered.length === 0) {
      delete hooks[event];
    } else {
      hooks[event] = filtered;
    }
  }
}
async function installCursorHook(ctx, options) {
  const configPath = getCursorConfigPath(ctx.homeDir);
  const logger = options?.logger;
  logger?.info("[cursor-hooks] install cursor: events=%d", CURSOR_EVENTS.length);
  const config = await readJson$b(configPath, logger) ?? {};
  config.version = config.version ?? 1;
  const existingHooks = config.hooks ?? {};
  const fluxHooks = buildHooksConfig$1(ctx.hookCommand);
  logger?.info("[cursor-hooks] before merge: %s", summarizeHooks(existingHooks, options?.isExtraHook));
  let removedFluxEntries = 0;
  for (const [event, entries] of Object.entries(fluxHooks)) {
    const current = existingHooks[event] ?? [];
    removedFluxEntries += countMatching(current, isFluxCursorHookEntry);
    const filtered = current.filter((entry) => !isFluxCursorHookEntry(entry));
    existingHooks[event] = [...filtered, ...entries];
  }
  logger?.info(
    "[cursor-hooks] removed stale flux entries: %d; appended flux entries: %d",
    removedFluxEntries,
    countEntries(fluxHooks)
  );
  if (options?.isExtraHook) {
    if (options.extraEnabled && options.extraHooks) {
      let removedExtraEntries = 0;
      for (const [event, entries] of Object.entries(options.extraHooks)) {
        const current = existingHooks[event] ?? [];
        removedExtraEntries += countMatching(current, options.isExtraHook);
        const filtered = current.filter((entry) => !options.isExtraHook(entry));
        existingHooks[event] = [...filtered, ...entries];
      }
      logger?.info(
        "[cursor-hooks] removed stale bits entries: %d; appended bits entries: %d",
        removedExtraEntries,
        countEntries(options.extraHooks)
      );
    } else {
      let removedExtraEntries = 0;
      const targets = options.extraHooks ? Object.keys(options.extraHooks) : Object.keys(existingHooks);
      for (const event of targets) {
        const entries = existingHooks[event] ?? [];
        removedExtraEntries += countMatching(entries, options.isExtraHook);
      }
      stripExtraHooks(
        existingHooks,
        options.isExtraHook,
        options.extraHooks ? Object.keys(options.extraHooks) : void 0
      );
      logger?.info("[cursor-hooks] removed stale bits entries: %d; appended bits entries: 0", removedExtraEntries);
    }
  }
  config.hooks = existingHooks;
  logger?.info("[cursor-hooks] after merge: %s", summarizeHooks(existingHooks, options?.isExtraHook));
  await writeJson$e(configPath, config);
  logger?.info("[cursor-hooks] written: %s", configPath);
  return {
    configPath,
    installedEvents: [...CURSOR_EVENTS]
  };
}
async function uninstallCursorHook(homeDir, options) {
  const configPath = getCursorConfigPath(homeDir);
  const config = await readJson$b(configPath, void 0, options?.strict);
  if (!config?.hooks) {
    return { configPath, removed: false };
  }
  for (const event of CURSOR_EVENTS) {
    const entries = config.hooks[event];
    if (!entries) continue;
    const filtered = entries.filter((entry) => !isFluxCursorHookEntry(entry));
    if (filtered.length === 0) {
      delete config.hooks[event];
    } else {
      config.hooks[event] = filtered;
    }
  }
  stripExtraHooks(config.hooks, options?.isExtraHook, options?.extraEvents);
  if (Object.keys(config.hooks).length === 0) {
    delete config.hooks;
  }
  await writeJson$e(configPath, config);
  return { configPath, removed: true };
}
async function checkCursorHook(ctx, options) {
  const configPath = getCursorConfigPath(ctx.homeDir);
  const config = await readJson$b(configPath);
  const issues = [];
  if (!config?.hooks) {
    issues.push("No hooks section found in Cursor config");
    return { configPath, issues };
  }
  for (const event of CURSOR_EVENTS) {
    const entries = config.hooks[event];
    if (!entries || !entries.some(isFluxCursorHookEntry)) {
      issues.push(`Missing hook for event: ${event}`);
      continue;
    }
    const fluxEntry = entries.find(isFluxCursorHookEntry);
    if (fluxEntry && fluxEntry.command !== ctx.hookCommand) {
      issues.push(`Stale command for ${event}: expected ${ctx.hookCommand}`);
    }
  }
  if (options?.isExtraHook) {
    const scanEvents = options.extraEvents ?? Object.keys(config.hooks);
    const hasExtraHook = scanEvents.some(
      (event) => (config.hooks[event] ?? []).some((entry) => options.isExtraHook(entry))
    );
    if (options.extraEnabled && !hasExtraHook) {
      issues.push("Missing extra Cursor hook entries");
    }
    if (!options.extraEnabled && hasExtraHook) {
      issues.push("Unexpected extra Cursor hook entries");
    }
  }
  return { configPath, issues };
}
function getHookBinaryPath$8() {
  const resourcesPath = process.resourcesPath ?? path.join(electron.app.getAppPath(), "resources");
  return path.resolve(resourcesPath, "bin", "flux-hooks");
}
function getManifestDir$4() {
  return path.join(os.homedir(), ".flux", "hooks");
}
function getManifestPath$8() {
  return path.join(getManifestDir$4(), "cursor-manifest.json");
}
function buildCommand$6() {
  if (utils.is.dev) {
    return buildDevHooksCliCommand("cursor");
  }
  return `ELECTRON_RUN_AS_NODE=1 ${shellQuote(process.execPath)} ${shellQuote(getHookBinaryPath$8())} --source cursor`;
}
function fingerprintCursorHookCommand(command) {
  if (command.includes("hooks-cli/index.")) return "dev:node-hooks-cli";
  if (command.includes("flux-hooks") && command.includes("ELECTRON_RUN_AS_NODE=1")) return "prod:electron+flux-hooks";
  return "unknown";
}
async function writeJson$d(filePath, data) {
  await promises.mkdir(path.dirname(filePath), { recursive: true });
  await promises.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
class CursorHookManager {
  agentId = "cursor";
  async install(options) {
    const homeDir = os.homedir();
    const hookCommand = buildCommand$6();
    const commandFingerprint = fingerprintCursorHookCommand(hookCommand);
    const configPath = getCursorConfigPath(homeDir);
    const manifestPath = getManifestPath$8();
    log.info(
      "[CursorHookManager] writing hooks to %s (events=%d command=%s)",
      configPath,
      CURSOR_EVENTS.length,
      commandFingerprint
    );
    const result = await installCursorHook(
      { homeDir, hookCommand },
      {
        isExtraHook: isCursorBitsEntry,
        extraEnabled: false,
        logger: log
      }
    );
    const verification = await checkCursorHook(
      { homeDir, hookCommand },
      {
        isExtraHook: isCursorBitsEntry,
        extraEnabled: false
      }
    );
    const verified = verification.issues.length === 0;
    const verifiedAt = (/* @__PURE__ */ new Date()).toISOString();
    const manifest = {
      configPath: result.configPath,
      events: result.installedEvents,
      installedAt: (/* @__PURE__ */ new Date()).toISOString(),
      hookCommandFingerprint: commandFingerprint,
      verified,
      verifiedAt,
      verificationIssues: verification.issues
    };
    log.info("[CursorHookManager] writing manifest to %s", manifestPath);
    await writeJson$d(manifestPath, manifest);
    log.info("[CursorHookManager] manifest written for cursor");
    if (!verified) {
      const message = verification.issues.join("; ");
      log.error("[CursorHookManager] post-install verification failed: %s", message);
      throw new Error(`Cursor post-install verification failed: ${message}`);
    }
    log.info("[CursorHookManager] post-install verification passed");
    log.info("[CursorHookManager] install completed (%d events registered)", result.installedEvents.length);
  }
  async uninstall() {
    const manifestPath = getManifestPath$8();
    await uninstallCursorHook(os.homedir(), {
      isExtraHook: isCursorBitsEntry
    });
    try {
      await promises.unlink(manifestPath);
    } catch {
    }
  }
  async checkHealth() {
    const issues = [];
    const binaryPath = getHookBinaryPath$8();
    if (!utils.is.dev && !fs.existsSync(binaryPath)) {
      issues.push(`Hook binary not found: ${binaryPath}`);
    }
    const command = buildCommand$6();
    const checkResult = await checkCursorHook({ homeDir: os.homedir(), hookCommand: command });
    issues.push(...checkResult.issues);
    return {
      agentId: "cursor",
      installed: issues.length === 0,
      issues,
      manifestPath: getManifestPath$8()
    };
  }
}
const TRAE_HOOKS_SCHEMA_VERSION = 1;
const TRAE_HOOK_DIR = ".trae";
const TRAE_CN_HOOK_DIR = ".trae-cn";
function getTraeHookDir(ideType) {
  return ideType === "trae" ? TRAE_HOOK_DIR : TRAE_CN_HOOK_DIR;
}
function getTraeConfigPath(homeDir, ideType) {
  return path.join(homeDir, getTraeHookDir(ideType), "hooks.json");
}
const TRAE_EVENTS = [
  { event: "SessionStart" },
  { event: "UserPromptSubmit" },
  { event: "PreToolUse", matcher: "*" },
  { event: "PostToolUse", matcher: "*" },
  { event: "Stop" },
  { event: "Notification" }
];
function isFluxHookEntry$1(entry) {
  return entry.type === "command" && (entry.command.includes("flux-hooks") || entry.command.includes("hooks-cli/index."));
}
function isFluxHookGroup(group) {
  return group.hooks.some(isFluxHookEntry$1);
}
function buildHookGroups(events2, command) {
  const map = {};
  for (const { event, matcher, timeout } of events2) {
    const entry = { type: "command", command };
    if (timeout !== void 0) entry.timeout = timeout;
    const group = { hooks: [entry] };
    if (matcher !== void 0) group.matcher = matcher;
    map[event] = [group];
  }
  return map;
}
function extractEventsMap(file) {
  if (!file) return {};
  if (file.hooks && typeof file.hooks === "object") return file.hooks;
  return {};
}
function isUpToDate(existing, desired, file) {
  if (!file?.hooks || file.version !== TRAE_HOOKS_SCHEMA_VERSION) return false;
  for (const [event, desiredGroups] of Object.entries(desired)) {
    const groups = existing[event];
    if (!groups) return false;
    const desiredCmd = desiredGroups[0]?.hooks[0]?.command;
    if (!desiredCmd) return false;
    const fluxGroup = groups.find(isFluxHookGroup);
    const fluxEntry = fluxGroup?.hooks.find(isFluxHookEntry$1);
    if (!fluxEntry || fluxEntry.command !== desiredCmd) return false;
  }
  return true;
}
async function readJson$a(filePath) {
  try {
    const raw = await promises.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    return "corrupt";
  }
}
async function writeJson$c(filePath, data) {
  await promises.mkdir(path.dirname(filePath), { recursive: true });
  await promises.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
async function installTraeHook(ctx, ideType, options) {
  const log2 = options?.logger;
  const desired = buildHookGroups(TRAE_EVENTS, ctx.hookCommand);
  const configPath = getTraeConfigPath(ctx.homeDir, ideType);
  const written = [];
  const file = await readJson$a(configPath);
  if (file === "corrupt") {
    log2?.warn("[trae] hooks.json corrupt, skip to avoid data loss: %s", configPath);
    return written;
  }
  const existing = extractEventsMap(file);
  if (isUpToDate(existing, desired, file)) {
    log2?.info("[trae] up-to-date, skip: %s", configPath);
    return written;
  }
  const merged = { ...existing };
  for (const [event, groups] of Object.entries(desired)) {
    const userGroups = (merged[event] ?? []).filter((g) => !isFluxHookGroup(g));
    merged[event] = [...userGroups, ...groups];
  }
  await writeJson$c(configPath, { version: TRAE_HOOKS_SCHEMA_VERSION, hooks: merged });
  log2?.info("[trae] written: %s", configPath);
  written.push(configPath);
  return written;
}
async function uninstallTraeHook(homeDir, ideType, options) {
  const log2 = options?.logger;
  const configPath = getTraeConfigPath(homeDir, ideType);
  const file = await readJson$a(configPath);
  if (file === "corrupt") {
    if (options?.strict) {
      throw new Error(`Failed to parse Trae hooks config at ${configPath}`);
    }
    return;
  }
  if (!file) return;
  const eventsMap = extractEventsMap(file);
  if (Object.keys(eventsMap).length === 0) return;
  let mutated = false;
  for (const event of TRAE_EVENTS.map((e) => e.event)) {
    const groups = eventsMap[event];
    if (!groups) continue;
    const filtered = groups.filter((g) => !isFluxHookGroup(g));
    if (filtered.length === groups.length) continue;
    mutated = true;
    if (filtered.length === 0) delete eventsMap[event];
    else eventsMap[event] = filtered;
  }
  if (mutated) {
    await writeJson$c(configPath, { version: TRAE_HOOKS_SCHEMA_VERSION, hooks: eventsMap });
    log2?.info("[trae] removed flux group: %s", configPath);
  }
}
async function checkTraeHook(homeDir, hookCommand, ideType) {
  const issues = [];
  const configPath = getTraeConfigPath(homeDir, ideType);
  const file = await readJson$a(configPath);
  if (!file) {
    issues.push(`No hooks.json: ${configPath}`);
    return issues;
  }
  if (file === "corrupt") {
    issues.push(`Corrupt hooks.json (unparseable): ${configPath}`);
    return issues;
  }
  if (file.version !== TRAE_HOOKS_SCHEMA_VERSION) {
    issues.push(`Wrong version in ${configPath}: got ${String(file.version)}`);
  }
  if (!file.hooks) {
    issues.push(`Missing 'hooks' key: ${configPath}`);
    return issues;
  }
  for (const { event } of TRAE_EVENTS) {
    const groups = file.hooks[event];
    if (!groups?.some(isFluxHookGroup)) {
      issues.push(`Missing ${event} in ${configPath}`);
    } else {
      const entry = groups.find(isFluxHookGroup)?.hooks.find(isFluxHookEntry$1);
      if (entry && entry.command !== hookCommand) {
        issues.push(`Stale command for ${event} in ${configPath}`);
      }
    }
  }
  return issues;
}
function getHookBinaryPath$7() {
  const resourcesPath = process.resourcesPath ?? path.join(electron.app.getAppPath(), "resources");
  return path.resolve(resourcesPath, "bin", "flux-hooks");
}
function getManifestPath$7(ideType) {
  return path.join(os.homedir(), ".flux", "hooks", `${ideType}-manifest.json`);
}
function buildCommand$5(ideType) {
  if (utils.is.dev) {
    return buildDevHooksCliCommand(ideType);
  }
  const bin = getHookBinaryPath$7();
  return wrapWithInstallCheck(
    process.execPath,
    `ELECTRON_RUN_AS_NODE=1 ${shellQuote(process.execPath)} ${shellQuote(bin)} --source ${ideType}`
  );
}
async function readJson$9(filePath) {
  try {
    const raw = await promises.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function writeJson$b(filePath, data) {
  const dir = path.join(filePath, "..");
  await promises.mkdir(dir, { recursive: true });
  await promises.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
class BaseTraeHookManager {
  agentId;
  configType;
  commandSource;
  requiresManifest;
  queue = Promise.resolve();
  constructor(agentId, configType = agentId, commandSource = agentId, requiresManifest = false) {
    this.agentId = agentId;
    this.configType = configType;
    this.commandSource = commandSource;
    this.requiresManifest = requiresManifest;
  }
  async install() {
    log.info("[TraeHookManager] install %s: events=%d", this.agentId, TRAE_EVENTS.length);
    const hookCommand = buildCommand$5(this.commandSource);
    await this.enqueue(async () => {
      await installTraeHook({ homeDir: os.homedir(), hookCommand }, this.configType, { logger: log });
    });
    await this.enqueue(() => this.persistManifest());
  }
  async uninstall(options = {}) {
    log.info("[TraeHookManager] uninstall %s", this.agentId);
    if (!options.preserveSharedConfig) {
      await this.enqueue(async () => {
        await uninstallTraeHook(os.homedir(), this.configType, { logger: log });
      });
    }
    if (!options.preserveVerification) {
      try {
        await promises.unlink(getManifestPath$7(this.agentId));
      } catch {
      }
    }
  }
  async checkHealth() {
    const issues = [];
    const binaryPath = getHookBinaryPath$7();
    if (!utils.is.dev && !fs.existsSync(binaryPath)) {
      issues.push(`Hook binary not found: ${binaryPath}`);
    }
    const hookCommand = buildCommand$5(this.commandSource);
    const sharedIssues = await checkTraeHook(os.homedir(), hookCommand, this.configType);
    issues.push(...sharedIssues);
    const manifest = await readJson$9(getManifestPath$7(this.agentId));
    if (this.requiresManifest && !manifest) {
      issues.push(`${this.agentId} 尚未在 WorkIsland 中连接`);
    }
    return {
      agentId: this.agentId,
      installed: issues.length === 0,
      connectionState: issues.length > 0 ? "disconnected" : manifest?.lastVerifiedAt ? "verified" : "configured",
      lastVerifiedAt: manifest?.lastVerifiedAt,
      issues,
      manifestPath: getManifestPath$7(this.agentId)
    };
  }
  async recordEvent(event) {
    await this.enqueue(async () => {
      const manifestPath = getManifestPath$7(this.agentId);
      const manifest = await readJson$9(manifestPath);
      if (!manifest) return;
      const now = new Date().toISOString();
      await writeJson$b(manifestPath, {
        ...manifest,
        lastVerifiedAt: now,
        lastVerifiedEvent: event.type,
        updatedAt: now
      });
      log.info("[TraeHookManager] verified %s from %s", this.agentId, event.type);
    });
  }
  async persistManifest() {
    const existing = await readJson$9(getManifestPath$7(this.agentId));
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const manifest = {
      configPath: getTraeConfigPath(os.homedir(), this.configType),
      events: TRAE_EVENTS.map((e) => e.event),
      installedAt: existing?.installedAt ?? now,
      ...(existing?.lastVerifiedAt ? {
        lastVerifiedAt: existing.lastVerifiedAt,
        lastVerifiedEvent: existing.lastVerifiedEvent
      } : {}),
      updatedAt: now
    };
    log.info("[TraeHookManager] manifest written for %s", this.agentId);
    await writeJson$b(getManifestPath$7(this.agentId), manifest);
  }
  enqueue(fn) {
    const next = this.queue.then(fn, fn);
    this.queue = next.then(
      () => void 0,
      () => void 0
    );
    return next;
  }
}
class TraeHookManager extends BaseTraeHookManager {
  constructor() {
    super("trae");
  }
}
class TraeWorkHookManager extends BaseTraeHookManager {
  constructor() {
    // TraeWork reads the same ~/.trae/hooks.json as TraeCode. The hook CLI
    // identifies TraeWork from its parent desktop process and relabels events.
    super("traework", "trae", "trae", true);
  }
  async checkHealth() {
    const health = await super.checkHealth();
    const homeApplications = path.join(os.homedir(), "Applications", "TRAE SOLO.app");
    return {
      ...health,
      available: fs.existsSync("/Applications/TRAE SOLO.app") || fs.existsSync(homeApplications)
    };
  }
}
class TraeCnHookManager extends BaseTraeHookManager {
  constructor() {
    super("trae-cn");
  }
}
module.exports = { CocoHookManager, CursorHookManager, TraeHookManager, TraeWorkHookManager, TraeCnHookManager };
