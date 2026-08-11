"use strict";

const electron = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const child_process = require("node:child_process");
const promises = require("node:fs/promises");
const util = require("node:util");
const log = require("electron-log");
const utils = require("@electron-toolkit/utils");
const toml__namespace = require("@iarna/toml");
const execFileAsync$a = util.promisify(child_process.execFile);
const {
  shellQuote,
  buildDevHooksCliCommand,
  wrapWithInstallCheck,
  isClaudeBitsHookGroup,
  isCodexBitsHookGroup
} = require("./hook-shared.cjs");

const VERSION_RE = /(\d+\.\d+\.\d+)/;
function extractVersion(stdout) {
  const m = String(stdout).trim().match(VERSION_RE);
  return m ? m[1] : null;
}
function parseVersion(v) {
  return v.replace(/^v/, "").split(".").map(Number);
}
function versionGte$1(current, required) {
  const c = parseVersion(current);
  const r = parseVersion(required);
  for (let i = 0; i < r.length; i++) {
    const cv = c[i] ?? 0;
    const rv = r[i] ?? 0;
    if (cv > rv) return true;
    if (cv < rv) return false;
  }
  return true;
}
async function nvmCandidates(homeDir) {
  const root = path.join(homeDir, ".nvm/versions/node");
  if (!fs.existsSync(root)) return [];
  try {
    const versions = await promises.readdir(root);
    return versions.map((v) => path.join(root, v, "bin/claude"));
  } catch {
    return [];
  }
}
async function fnmCandidates(homeDir) {
  const roots = [
    path.join(homeDir, "Library/Application Support/fnm/node-versions"),
    path.join(homeDir, ".local/share/fnm/node-versions")
  ];
  const out = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    try {
      const versions = await promises.readdir(root);
      for (const v of versions) out.push(path.join(root, v, "installation/bin/claude"));
    } catch {
    }
  }
  return out;
}
async function tryBin(bin) {
  if (!fs.existsSync(bin)) return null;
  try {
    const { stdout } = await execFileAsync$a(bin, ["--version"], { timeout: 8e3 });
    return extractVersion(stdout);
  } catch {
    return null;
  }
}
const ALLOWED_SHELLS = /* @__PURE__ */ new Set([
  "/bin/zsh",
  "/bin/bash",
  "/bin/sh",
  "/usr/bin/zsh",
  "/usr/bin/bash",
  "/usr/bin/sh",
  "/usr/local/bin/zsh",
  "/usr/local/bin/bash",
  "/usr/local/bin/fish",
  "/opt/homebrew/bin/zsh",
  "/opt/homebrew/bin/bash",
  "/opt/homebrew/bin/fish"
]);
function resolveSafeShell() {
  const raw = process.env.SHELL;
  if (raw && raw.startsWith("/") && ALLOWED_SHELLS.has(raw) && fs.existsSync(raw)) {
    return raw;
  }
  return "/bin/zsh";
}
async function runShellLookup(shell, flag) {
  const timeout = flag === "-ilc" ? 6e3 : 4e3;
  const args = flag === "-ilc" ? ["-i", "-l", "-c"] : ["-l", "-c"];
  const { stdout } = await execFileAsync$a(shell, [...args, "command -v claude"], {
    timeout,
    killSignal: "SIGKILL"
  });
  const lines = String(stdout).trim().split("\n").map((l) => l.trim()).filter(Boolean);
  const claudeBin = lines[lines.length - 1];
  if (claudeBin && claudeBin.startsWith("/")) return claudeBin;
  return null;
}
async function detectClaudeVersion(homeDir) {
  const staticPaths = [
    path.join(homeDir, ".local/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "/opt/local/bin/claude",
    path.join(homeDir, "Library/pnpm/claude"),
    path.join(homeDir, ".npm-global/bin/claude"),
    path.join(homeDir, ".bun/bin/claude"),
    path.join(homeDir, ".volta/bin/claude"),
    path.join(homeDir, ".asdf/shims/claude"),
    path.join(homeDir, ".yarn/bin/claude")
  ];
  const dynamicPaths = [...await nvmCandidates(homeDir), ...await fnmCandidates(homeDir)];
  for (const bin of [...staticPaths, ...dynamicPaths]) {
    const v = await tryBin(bin);
    if (v) return v;
  }
  const shell = resolveSafeShell();
  const isInteractiveShell = /\/(zsh|bash)$/.test(shell);
  const attempts = isInteractiveShell ? ["-ilc", "-lc"] : ["-lc"];
  for (const flag of attempts) {
    try {
      const claudeBin = await runShellLookup(shell, flag);
      if (claudeBin) {
        const v = await tryBin(claudeBin);
        if (v) return v;
      }
    } catch {
    }
  }
  return null;
}
const CLAUDE_EVENTS$1 = [
  { event: "UserPromptSubmit" },
  { event: "SessionStart" },
  { event: "SessionEnd" },
  { event: "Stop" },
  {
    event: "StopFailure"
    // minVersion: '2.1.78'
  },
  { event: "SubagentStart" },
  { event: "SubagentStop" },
  { event: "Notification", matcher: "*" },
  { event: "PreToolUse", matcher: "*" },
  { event: "PermissionRequest", matcher: "*", timeout: 86400 },
  { event: "PostToolUse", matcher: "*" },
  { event: "PostToolUseFailure", matcher: "*" },
  { event: "PreCompact" }
];
function filterEventsByVersion(version) {
  if (!version) return CLAUDE_EVENTS$1.filter((e) => !e.minVersion);
  return CLAUDE_EVENTS$1.filter((e) => !e.minVersion || versionGte$1(version, e.minVersion));
}
function isFluxHookEntry$6(entry) {
  return entry.type === "command" && (entry.command.includes("flux-hooks") || entry.command.includes("hooks-cli/index."));
}
function isFluxHookGroup$3(group) {
  return group.hooks.some(isFluxHookEntry$6);
}
function getClaudeConfigPath(homeDir) {
  return path.join(homeDir, ".claude", "settings.json");
}
async function readJson$f(filePath) {
  try {
    const raw = await promises.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function writeJson$j(filePath, data) {
  await promises.mkdir(path.dirname(filePath), { recursive: true });
  await promises.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
async function installClaudeHook(ctx, options) {
  const configPath = getClaudeConfigPath(ctx.homeDir);
  const claudeVersion = options && "claudeVersion" in options ? options.claudeVersion ?? null : await detectClaudeVersion(ctx.homeDir);
  const supportedEvents = filterEventsByVersion(claudeVersion);
  const settings = await readJson$f(configPath) ?? {};
  const existingHooks = settings.hooks ?? {};
  const fluxHooks = {};
  for (const { event, matcher, timeout } of supportedEvents) {
    const entry = { type: "command", command: ctx.hookCommand };
    if (timeout !== void 0) entry.timeout = timeout;
    const group = { hooks: [entry] };
    if (matcher !== void 0) group.matcher = matcher;
    fluxHooks[event] = [group];
  }
  for (const [event, groups] of Object.entries(fluxHooks)) {
    const existing = existingHooks[event] ?? [];
    const filtered = existing.filter((g) => !isFluxHookGroup$3(g));
    existingHooks[event] = [...filtered, ...groups];
  }
  const registeredEventNames = new Set(supportedEvents.map((e) => e.event));
  for (const { event, minVersion } of CLAUDE_EVENTS$1) {
    if (minVersion && !registeredEventNames.has(event) && existingHooks[event]) {
      const filtered = existingHooks[event].filter((g) => !isFluxHookGroup$3(g));
      if (filtered.length === 0) delete existingHooks[event];
      else existingHooks[event] = filtered;
    }
  }
  if (options?.extraGroups && options.isExtraGroup) {
    if (options.extraEnabled) {
      for (const [event, groups] of Object.entries(options.extraGroups)) {
        const current = existingHooks[event] ?? [];
        const filtered = current.filter((g) => !options.isExtraGroup(g));
        existingHooks[event] = [...filtered, ...groups];
      }
    } else {
      for (const event of Object.keys(options.extraGroups)) {
        const groups = existingHooks[event];
        if (!groups) continue;
        const filtered = groups.filter((g) => !options.isExtraGroup(g));
        if (filtered.length === 0) delete existingHooks[event];
        else existingHooks[event] = filtered;
      }
    }
  }
  settings.hooks = existingHooks;
  await writeJson$j(configPath, settings);
  return {
    configPath,
    claudeVersion,
    installedEvents: supportedEvents.map((e) => e.event)
  };
}
async function uninstallClaudeHook(homeDir, options) {
  const events2 = new Set(CLAUDE_EVENTS$1.map((item) => item.event));
  for (const event of options?.events ?? []) {
    events2.add(event);
  }
  for (const event of Object.keys(options?.extraGroups ?? {})) {
    events2.add(event);
  }
  const configPaths = /* @__PURE__ */ new Set([getClaudeConfigPath(homeDir), ...options?.configPaths ?? []]);
  for (const configPath of configPaths) {
    let settings;
    try {
      const raw = await promises.readFile(configPath, "utf-8");
      settings = JSON.parse(raw);
    } catch (err) {
      if (err.code === "ENOENT") continue;
      if (options?.strict) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to read Claude config at ${configPath}: ${reason}`);
      }
      continue;
    }
    if (!settings.hooks) continue;
    let mutated = false;
    for (const event of events2) {
      const groups = settings.hooks[event];
      if (!groups) continue;
      const filtered = groups.filter(
        (group) => !isFluxHookGroup$3(group) && !(options?.isExtraGroup?.(group) ?? false)
      );
      if (filtered.length === groups.length) continue;
      mutated = true;
      if (filtered.length === 0) delete settings.hooks[event];
      else settings.hooks[event] = filtered;
    }
    if (!mutated) continue;
    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }
    await writeJson$j(configPath, settings);
  }
}
const CLAUDE_EVENTS = [
  { event: "UserPromptSubmit" },
  { event: "SessionStart" },
  { event: "SessionEnd" },
  { event: "Stop" },
  { event: "StopFailure", minVersion: "2.1.78" },
  { event: "SubagentStart" },
  { event: "SubagentStop" },
  { event: "Notification", matcher: "*" },
  { event: "PreToolUse", matcher: "*" },
  { event: "PermissionRequest", matcher: "*", timeout: 86400 },
  { event: "PostToolUse", matcher: "*" },
  { event: "PostToolUseFailure", matcher: "*" },
  { event: "PreCompact" }
];
function getHookBinaryPath$b() {
  const resourcesPath = process.resourcesPath ?? path.join(electron.app.getAppPath(), "resources");
  return path.resolve(resourcesPath, "bin", "flux-hooks");
}
function getConfigPath$3() {
  return path.join(os.homedir(), ".claude", "settings.json");
}
function getManifestDir$6() {
  return path.join(os.homedir(), ".flux", "hooks");
}
function getManifestPath$b() {
  return path.join(getManifestDir$6(), "claude-manifest.json");
}
function getStatusLineScriptPath() {
  return path.join(os.homedir(), ".flux", "bin", "flux-statusline");
}
function buildCommand$9() {
  if (utils.is.dev) {
    return buildDevHooksCliCommand("claude");
  }
  const bin = getHookBinaryPath$b();
  return wrapWithInstallCheck(
    process.execPath,
    `ELECTRON_RUN_AS_NODE=1 ${shellQuote(process.execPath)} ${shellQuote(bin)} --source claude`
  );
}
function shellQuoteForBash(value) {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}
function isCommandStatusLine(value) {
  const statusLine = value;
  return statusLine?.type === "command" && typeof statusLine.command === "string" && statusLine.command.length > 0;
}
function expandHomePath(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}
function unshellQuote(value) {
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/'\\''/g, "'");
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}
function isFluxStatusLineWrapper(statusLine, scriptPaths) {
  if (!statusLine) return false;
  const command = statusLine.command;
  if (scriptPaths.includes(expandHomePath(command))) return true;
  const execMatch = command.match(/--exec[= ](\S+)/);
  if (execMatch) return scriptPaths.includes(expandHomePath(unshellQuote(execMatch[1])));
  return false;
}
async function readOriginalStatusLineFromScript(scriptPath, padding) {
  let script;
  try {
    script = await promises.readFile(scriptPath, "utf-8");
  } catch {
    return null;
  }
  const originalCommand = script.split("\n").find((line) => line.startsWith("_original_command="))?.slice("_original_command=".length).trim();
  if (!originalCommand) return null;
  const command = unshellQuote(originalCommand);
  if (!command) return null;
  return {
    type: "command",
    command,
    ...typeof padding === "number" ? { padding } : {}
  };
}
async function resolveOriginalStatusLine(existingStatusLine, previousManifest, fluxStatusLinePaths, scriptPath) {
  const existingIsWrapper = isFluxStatusLineWrapper(existingStatusLine, fluxStatusLinePaths);
  if (existingStatusLine && !existingIsWrapper) return { original: existingStatusLine, existingIsWrapper };
  if (isCommandStatusLine(previousManifest?.originalStatusLine) && !isFluxStatusLineWrapper(previousManifest.originalStatusLine, fluxStatusLinePaths)) {
    return { original: previousManifest.originalStatusLine, existingIsWrapper };
  }
  if (existingIsWrapper) {
    const legacy = await readLegacyOriginalStatusLine(
      scriptPath,
      previousManifest?.statusLineScriptPath,
      existingStatusLine?.padding
    );
    if (legacy && !isFluxStatusLineWrapper(legacy, fluxStatusLinePaths)) {
      return { original: legacy, existingIsWrapper };
    }
  }
  return { original: void 0, existingIsWrapper };
}
async function readLegacyOriginalStatusLine(scriptPath, previousScriptPath, padding) {
  return await readOriginalStatusLineFromScript(previousScriptPath ?? scriptPath, padding) ?? (previousScriptPath && previousScriptPath !== scriptPath ? await readOriginalStatusLineFromScript(scriptPath, padding) : null);
}
function buildStatusLineScript(cachePath, originalStatusLine) {
  const originalCommand = originalStatusLine?.command ?? "";
  return `#!/bin/bash
# Flux StatusLine Script — 由 Flux 自动配置
# 给 AI 助手：这个脚本会从 Claude Code stdin 接收 JSON。
# 如需定制展示内容，请修改原始 statusLine 脚本；不要改 Claude settings 里的 statusLine.command。
# 下面的 rate_limits 缓存逻辑用于给 Orca 展示 Claude 额度，删除后会丢失额度展示。
input=$(cat)
_rl=$(printf '%s\\n' "$input" | jq -c '.rate_limits // empty' 2>/dev/null)
[ -n "$_rl" ] && printf '%s\\n' "$_rl" > ${shellQuoteForBash(cachePath)}
_original_command=${shellQuoteForBash(originalCommand)}
if [ -n "$_original_command" ]; then
  printf '%s\\n' "$input" | /bin/bash -lc "$_original_command"
  exit $?
fi
exit 0
`;
}
async function removeFileIfExists(filePath) {
  try {
    await promises.unlink(filePath);
  } catch (err) {
    if (err.code !== "ENOENT") {
      log.warn("[ClaudeHookManager] failed to remove %s: %s", filePath, err.message);
    }
  }
}
async function readJson$e(filePath) {
  try {
    const raw = await promises.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function writeJson$i(filePath, data) {
  const dir = path.join(filePath, "..");
  await promises.mkdir(dir, { recursive: true });
  await promises.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
function isFluxHookEntry$5(entry) {
  return entry.type === "command" && (entry.command.includes("flux-hooks") || entry.command.includes("hooks-cli/index."));
}
function isFluxHookGroup$2(group) {
  return group.hooks.some(isFluxHookEntry$5);
}
class ClaudeHookManager {
  agentId = "claude";
  async install(options) {
    const configPath = getConfigPath$3();
    const { claudeVersion, installedEvents } = await installClaudeHook(
      { homeDir: os.homedir(), hookCommand: buildCommand$9() },
      {
        extraEnabled: false,
        extraGroups: [],
        isExtraGroup: isClaudeBitsHookGroup
      }
    );
    if (claudeVersion) {
      log.info(
        "[ClaudeHookManager] Detected Claude Code v%s — registering %d/%d events",
        claudeVersion,
        installedEvents.length,
        CLAUDE_EVENTS.length
      );
    } else {
      log.warn(
        "[ClaudeHookManager] Could not detect Claude Code version — registering only baseline events (%d/%d)",
        installedEvents.length,
        CLAUDE_EVENTS.length
      );
    }
    const settings = await readJson$e(configPath) ?? {};
    const previousManifest = await readJson$e(getManifestPath$b());
    const scriptPath = getStatusLineScriptPath();
    const cachePath = "/tmp/flux-rl.json";
    const statusLineEnabled = options?.statusLineEnabled ?? true;
    const existingStatusLine = isCommandStatusLine(settings.statusLine) ? settings.statusLine : void 0;
    const previousScriptPath = previousManifest?.statusLineScriptPath;
    const fluxStatusLinePaths = [scriptPath, previousScriptPath].filter((path2) => !!path2);
    const { original: originalStatusLine, existingIsWrapper: existingStatusLineIsFluxWrapper } = await resolveOriginalStatusLine(existingStatusLine, previousManifest, fluxStatusLinePaths, scriptPath);
    const shouldUseExistingStatusLinePadding = !!existingStatusLine && !existingStatusLineIsFluxWrapper;
    if (statusLineEnabled) {
      log.info("[ClaudeHookManager] writing statusLine script to %s", scriptPath);
      await promises.mkdir(path.join(scriptPath, ".."), { recursive: true });
      await promises.writeFile(scriptPath, buildStatusLineScript(cachePath, originalStatusLine), "utf-8");
      await promises.chmod(scriptPath, 493);
      settings.statusLine = {
        type: "command",
        command: scriptPath,
        padding: originalStatusLine ? shouldUseExistingStatusLinePadding ? existingStatusLine.padding ?? originalStatusLine.padding : originalStatusLine.padding : 0
      };
    } else if (existingStatusLineIsFluxWrapper) {
      if (originalStatusLine) {
        settings.statusLine = originalStatusLine;
      } else {
        delete settings.statusLine;
      }
    }
    log.info("[ClaudeHookManager] writing settings to %s", configPath);
    await writeJson$i(configPath, settings);
    if (!statusLineEnabled) {
      await removeFileIfExists(scriptPath);
      await removeFileIfExists(cachePath);
    }
    const manifest = {
      configPath,
      events: installedEvents,
      installedAt: (/* @__PURE__ */ new Date()).toISOString(),
      statusLineScriptPath: statusLineEnabled ? scriptPath : void 0,
      statusLineWrapped: statusLineEnabled,
      originalStatusLine: statusLineEnabled ? originalStatusLine : void 0,
      claudeVersion: claudeVersion ?? void 0
    };
    log.info("[ClaudeHookManager] writing manifest to %s", getManifestPath$b());
    await writeJson$i(getManifestPath$b(), manifest);
    log.info("[ClaudeHookManager] install completed (%d events registered)", installedEvents.length);
  }
  async uninstall() {
    const manifestPath = getManifestPath$b();
    const manifest = await readJson$e(manifestPath);
    await uninstallClaudeHook(os.homedir(), {
      extraGroups: [],
      isExtraGroup: isClaudeBitsHookGroup,
      events: manifest?.events,
      configPaths: manifest?.configPath ? [manifest.configPath] : void 0
    });
    if (!manifest) return;
    const configPath = manifest.configPath;
    const settings = await readJson$e(configPath);
    if (settings) {
      if (manifest.statusLineScriptPath && settings.statusLine?.command === manifest.statusLineScriptPath) {
        const originalStatusLine = isCommandStatusLine(manifest.originalStatusLine) ? manifest.originalStatusLine : null;
        if (originalStatusLine) {
          settings.statusLine = originalStatusLine;
        } else {
          delete settings.statusLine;
        }
      }
      await writeJson$i(configPath, settings);
    }
    if (manifest.statusLineScriptPath) {
      try {
        await promises.unlink(manifest.statusLineScriptPath);
      } catch {
      }
    }
    try {
      await promises.unlink(manifestPath);
    } catch {
    }
  }
  async checkHealth() {
    const issues = [];
    const binaryPath = getHookBinaryPath$b();
    if (!utils.is.dev && !fs.existsSync(binaryPath)) {
      issues.push(`Hook binary not found: ${binaryPath}`);
    }
    const configPath = getConfigPath$3();
    const settings = await readJson$e(configPath);
    if (!settings?.hooks) {
      issues.push("No hooks section found in Claude settings");
      return { agentId: "claude", installed: false, issues, manifestPath: getManifestPath$b() };
    }
    const manifest = await readJson$e(getManifestPath$b());
    const registeredEvents = manifest?.events ?? CLAUDE_EVENTS.filter((e) => !e.minVersion).map((e) => e.event);
    const command = buildCommand$9();
    for (const event of registeredEvents) {
      const groups = settings.hooks[event];
      if (!groups || !groups.some(isFluxHookGroup$2)) {
        issues.push(`Missing hook for event: ${event}`);
      } else {
        const fluxGroup = groups.find(isFluxHookGroup$2);
        const fluxEntry = fluxGroup?.hooks.find(isFluxHookEntry$5);
        if (fluxEntry && fluxEntry.command !== command) {
          issues.push(`Stale command for ${event}: expected ${command}`);
        }
      }
    }
    if (manifest?.statusLineWrapped === true) {
      const scriptPath = getStatusLineScriptPath();
      if (!fs.existsSync(scriptPath)) {
        issues.push(`StatusLine script not found: ${scriptPath}`);
      } else if (settings.statusLine?.command !== scriptPath) {
        issues.push(
          `StatusLine not configured (expected command: ${scriptPath}, got: ${settings.statusLine?.command ?? "none"})`
        );
      }
    }
    const installed = issues.length === 0;
    return {
      agentId: "claude",
      installed,
      issues,
      manifestPath: getManifestPath$b()
    };
  }
}
const CODEX_HOOK_EVENT_KEY = {
  PreToolUse: "pre_tool_use",
  PermissionRequest: "permission_request",
  PostToolUse: "post_tool_use",
  PreCompact: "pre_compact",
  PostCompact: "post_compact",
  SessionStart: "session_start",
  UserPromptSubmit: "user_prompt_submit",
  Stop: "stop",
  SubagentStop: "subagent_stop"
};
const DEFAULT_TIMEOUT_SEC = 600;
function commandHookHash(params) {
  const handler = {
    type: "command",
    command: params.command,
    timeout: params.timeoutSec,
    async: false
  };
  if (params.statusMessage !== void 0) {
    handler.statusMessage = params.statusMessage;
  }
  const identity = {
    event_name: params.snakeEvent,
    hooks: [handler]
  };
  if (params.matcher !== void 0) {
    identity.matcher = params.matcher;
  }
  const canonical = JSON.stringify(canonicalize(identity));
  const hex = crypto.createHash("sha256").update(canonical).digest("hex");
  return `sha256:${hex}`;
}
function computeCodexTrustEntries(hooksConfigPath, events2, shouldHashGroup = () => true) {
  const entries = [];
  for (const [pascalEvent, groups] of Object.entries(events2)) {
    const snakeEvent = CODEX_HOOK_EVENT_KEY[pascalEvent];
    if (!snakeEvent) continue;
    groups.forEach((group, groupIndex) => {
      if (!shouldHashGroup(group, pascalEvent)) return;
      group.hooks.forEach((handler, handlerIndex) => {
        if (handler.type !== void 0 && handler.type !== "command") return;
        const command = handler.command ?? "";
        if (command.trim() === "") return;
        const isAsync = handler.async === true;
        if (isAsync) return;
        const timeoutSec = Math.max(1, handler.timeout ?? DEFAULT_TIMEOUT_SEC);
        const statusMessage = handler.statusMessage;
        const key = `${hooksConfigPath}:${snakeEvent}:${groupIndex}:${handlerIndex}`;
        const trustedHash = commandHookHash({
          snakeEvent,
          matcher: group.matcher,
          command,
          timeoutSec,
          statusMessage
        });
        entries.push({ key, trustedHash });
      });
    });
  }
  return entries;
}
function canonicalize(value) {
  if (value === null || value === void 0) return value;
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === "object") {
    const sorted = {};
    for (const k of Object.keys(value).sort()) {
      sorted[k] = canonicalize(value[k]);
    }
    return sorted;
  }
  return value;
}
const CODEX_HOOKS_FEATURE = "hooks";
const CODEX_HOOKS_FEATURE_LEGACY = "codex_hooks";
const DEFAULT_BUNDLED_CODEX_PATH = "/Applications/Codex.app/Contents/Resources/codex";
const DEFAULT_CODEX_APP_INFO_PLIST_PATH = "/Applications/Codex.app/Contents/Info.plist";
const MIN_CODEX_CLI_VERSION_HOOKS_ONLY = "0.129.0";
const MIN_CODEX_APP_VERSION_HOOKS_ONLY = "26.506.0";
const execFileAsync$9 = util.promisify(child_process.execFile);
const CODEX_EVENTS = [
  // No matcher: Codex App may use session sources other than startup|resume; without this hook
  // Flux never sees SessionStart and jumpTarget is never written (only UserPromptSubmit / Stop).
  { event: "SessionStart" },
  { event: "UserPromptSubmit" },
  { event: "PreToolUse" },
  // PermissionRequest 需要用户在 Island 审批，timeout 必须足够长（Codex 默认 86400 秒）
  // 否则 hook 在用户点击前超时，Codex 会杀掉 hooks-cli 进程，导致审批无效
  { event: "PermissionRequest", matcher: "*", timeout: 86400 },
  { event: "PostToolUse" },
  { event: "Stop" },
  { event: "SubagentStop" }
];
function isFluxHookEntry$4(entry) {
  const cmd = entry.command;
  return typeof cmd === "string" && (cmd.includes("flux-hooks") || cmd.includes("hooks-cli/index."));
}
function isFluxHookGroup$1(group) {
  return group.hooks.some(isFluxHookEntry$4);
}
function getCodexHooksConfigPath(homeDir) {
  return path.join(homeDir, ".codex", "hooks.json");
}
function getCodexTomlConfigPath(homeDir) {
  return path.join(homeDir, ".codex", "config.toml");
}
function isRecord$1(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function unsupportedCodexHooksConfig(configPath, reason) {
  return new Error(`Unsupported Codex hooks config at ${configPath}: ${reason}`);
}
function validateCodexHooksConfig(configPath, hooks) {
  if (!isRecord$1(hooks)) {
    throw unsupportedCodexHooksConfig(configPath, "hooks must be an object");
  }
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      throw unsupportedCodexHooksConfig(configPath, `hooks.${event} must be an array of matcher groups`);
    }
    groups.forEach((group, groupIndex) => {
      if (!isRecord$1(group) || !Array.isArray(group.hooks)) {
        throw unsupportedCodexHooksConfig(
          configPath,
          `hooks.${event}[${groupIndex}] must be a matcher group with a hooks array`
        );
      }
    });
  }
}
async function readExistingCodexHooksFile(configPath) {
  let raw;
  try {
    raw = await promises.readFile(configPath, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") return { hooks: {} };
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read Codex hooks config at ${configPath}: ${reason}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse Codex hooks config at ${configPath}: ${reason}`);
  }
  if (!isRecord$1(parsed)) {
    throw unsupportedCodexHooksConfig(configPath, "root must be an object");
  }
  if (parsed.hooks == null) {
    parsed.hooks = {};
  }
  validateCodexHooksConfig(configPath, parsed.hooks);
  return parsed;
}
async function readText$4(filePath) {
  try {
    return await promises.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}
async function writeJson$h(filePath, data) {
  await promises.mkdir(path.dirname(filePath), { recursive: true });
  await promises.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
function applyCodexConfigToml(toml2, opts) {
  const parsed = parseToml(toml2) ?? {};
  if (opts.manageFeatureFlags !== false) {
    const existingFeatures = parsed.features ?? {};
    const wantedFlags = new Set(opts.featureFlagsToWrite);
    const newFeatures = {};
    if (wantedFlags.has(CODEX_HOOKS_FEATURE)) newFeatures[CODEX_HOOKS_FEATURE] = true;
    if (wantedFlags.has(CODEX_HOOKS_FEATURE_LEGACY)) {
      newFeatures[CODEX_HOOKS_FEATURE_LEGACY] = true;
    }
    for (const [k, v] of Object.entries(existingFeatures)) {
      if (k === CODEX_HOOKS_FEATURE || k === CODEX_HOOKS_FEATURE_LEGACY) continue;
      newFeatures[k] = v;
    }
    parsed.features = newFeatures;
  }
  const hooksTable = parsed.hooks ?? {};
  const stateTable = hooksTable.state ?? {};
  const managedKeys = new Set(opts.staleKeys ?? []);
  for (const entry of opts.trustEntries) managedKeys.add(entry.key);
  const merged = {};
  for (const [k, v] of Object.entries(stateTable)) {
    if (!managedKeys.has(k)) merged[k] = v;
  }
  for (const entry of opts.trustEntries) {
    merged[entry.key] = { trusted_hash: entry.trustedHash };
  }
  const cleanedState = {};
  for (const k of Object.keys(merged).sort()) {
    cleanedState[k] = merged[k];
  }
  if (Object.keys(cleanedState).length > 0) {
    hooksTable.state = cleanedState;
  } else {
    delete hooksTable.state;
  }
  if (Object.keys(hooksTable).length > 0) {
    parsed.hooks = hooksTable;
  } else {
    delete parsed.hooks;
  }
  return toml__namespace.stringify(parsed);
}
function disableCodexConfigToml(toml2, opts) {
  const parsed = parseToml(toml2);
  if (parsed === null) return toml2;
  const features = parsed.features;
  if (features) {
    for (const flag of opts.flagsToRemove) {
      delete features[flag];
    }
    if (Object.keys(features).length === 0) {
      delete parsed.features;
    }
  }
  const hooksTable = parsed.hooks;
  const stateTable = hooksTable?.state;
  if (hooksTable && stateTable) {
    for (const key of opts.keysToRemove) {
      delete stateTable[key];
    }
    if (Object.keys(stateTable).length === 0) {
      delete hooksTable.state;
    }
    if (Object.keys(hooksTable).length === 0) {
      delete parsed.hooks;
    }
  }
  return toml__namespace.stringify(parsed);
}
function readCodexTrustState(toml2) {
  const parsed = parseToml(toml2);
  if (parsed === null) return {};
  const stateTable = parsed.hooks?.state;
  if (!stateTable) return {};
  const out = {};
  for (const [k, v] of Object.entries(stateTable)) {
    if (v && typeof v === "object" && typeof v.trusted_hash === "string") {
      out[k] = v.trusted_hash;
    }
  }
  return out;
}
function hasAnyCodexHooksFeature(toml2) {
  const parsed = parseToml(toml2);
  if (parsed === null) return false;
  const features = parsed.features;
  if (!features) return false;
  return features[CODEX_HOOKS_FEATURE] === true || features[CODEX_HOOKS_FEATURE_LEGACY] === true;
}
function parseVersionParts(v) {
  const match = v.match(/\d+(?:\.\d+)+/);
  if (!match) return [];
  return match[0].split(".").map((part) => Number(part));
}
function versionGte(current, required) {
  const c = parseVersionParts(current);
  const r = parseVersionParts(required);
  if (c.length === 0 || r.length === 0) return false;
  const len = Math.max(c.length, r.length);
  for (let i = 0; i < len; i++) {
    const cv = c[i] ?? 0;
    const rv = r[i] ?? 0;
    if (cv > rv) return true;
    if (cv < rv) return false;
  }
  return true;
}
function isHooksOnlyCapableCodexCliVersion(version) {
  return versionGte(version, MIN_CODEX_CLI_VERSION_HOOKS_ONLY);
}
function isHooksOnlyCapableCodexAppVersion(version) {
  return versionGte(version, MIN_CODEX_APP_VERSION_HOOKS_ONLY);
}
function analyzeExistingCodexFeatureConfig(toml2) {
  const parsed = parseToml(toml2);
  if (parsed === null) {
    return {
      hasHooksKey: false,
      hooksValue: void 0,
      hasCodexHooksKey: false,
      codexHooksValue: void 0
    };
  }
  const features = parsed.features;
  if (!features) {
    return {
      hasHooksKey: false,
      hooksValue: void 0,
      hasCodexHooksKey: false,
      codexHooksValue: void 0
    };
  }
  const hasHooksKey = Object.prototype.hasOwnProperty.call(features, CODEX_HOOKS_FEATURE);
  const hasCodexHooksKey = Object.prototype.hasOwnProperty.call(features, CODEX_HOOKS_FEATURE_LEGACY);
  return {
    hasHooksKey,
    hooksValue: hasHooksKey ? features[CODEX_HOOKS_FEATURE] : void 0,
    hasCodexHooksKey,
    codexHooksValue: hasCodexHooksKey ? features[CODEX_HOOKS_FEATURE_LEGACY] : void 0
  };
}
function hasHooksOnlyFeatureConfig(toml2) {
  const parsed = parseToml(toml2);
  if (parsed === null) return false;
  const features = parsed.features;
  if (!features) return false;
  return features[CODEX_HOOKS_FEATURE] === true && features[CODEX_HOOKS_FEATURE_LEGACY] !== true;
}
function shouldDropLegacyFlagForUpgradedCodex(detectedVersions) {
  return Boolean(
    detectedVersions?.app.installed && detectedVersions.app.version && isHooksOnlyCapableCodexAppVersion(detectedVersions.app.version) && detectedVersions?.cli.installed && detectedVersions.cli.version && isHooksOnlyCapableCodexCliVersion(detectedVersions.cli.version)
  );
}
function tryRealpath(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return filePath;
  }
}
async function findStandaloneCodexCliBinary() {
  try {
    const { stdout } = await execFileAsync$9("/usr/bin/env", ["which", "codex"], {
      encoding: "utf-8",
      timeout: 2e3
    });
    const trimmed = stdout.trim();
    if (!trimmed || !fs.existsSync(trimmed)) return null;
    if (tryRealpath(trimmed) === tryRealpath(DEFAULT_BUNDLED_CODEX_PATH)) return null;
    return trimmed;
  } catch {
  }
  return null;
}
const CODEX_VERSION_WITH_KEYWORD_PATTERNS = [
  /\bcodex(?:\.app)?(?:\s+cli)?(?:\s+version)?[^0-9\n]{0,20}v?(\d+(?:\.\d+)+(?:-[0-9A-Za-z.+-]+)?)/i,
  /\bcodex(?:\.app)?[^\n]{0,40}?v?(\d+(?:\.\d+)+(?:-[0-9A-Za-z.+-]+)?)/i,
  /v?(\d+(?:\.\d+)+(?:-[0-9A-Za-z.+-]+)?)[^\n]{0,40}?\bcodex(?:\.app)?\b/i
];
const GENERIC_VERSION_PATTERN = /\bv?(\d+(?:\.\d+)+(?:-[0-9A-Za-z.+-]+)?)\b/;
function extractCodexVersionFromOutput(output) {
  const normalized = output.trim();
  if (!normalized) return null;
  for (const pattern of CODEX_VERSION_WITH_KEYWORD_PATTERNS) {
    const match = normalized.match(pattern);
    if (match?.[1]) return match[1];
  }
  const genericMatches = Array.from(normalized.matchAll(new RegExp(GENERIC_VERSION_PATTERN, "g")));
  const uniqueVersions = [...new Set(genericMatches.map((match) => match[1]).filter(Boolean))];
  return uniqueVersions.length === 1 ? uniqueVersions[0] : null;
}
async function detectVersionFromBinary(bin) {
  try {
    const { stdout, stderr } = await execFileAsync$9(bin, ["--version"], {
      encoding: "utf-8",
      timeout: 5e3
    });
    const output = `${stdout}
${stderr}`.trim();
    return extractCodexVersionFromOutput(output);
  } catch {
    return null;
  }
}
async function detectCodexAppVersion() {
  if (!fs.existsSync(DEFAULT_CODEX_APP_INFO_PLIST_PATH)) {
    return { installed: false, version: null };
  }
  try {
    const { stdout } = await execFileAsync$9("/usr/bin/plutil", [
      "-extract",
      "CFBundleShortVersionString",
      "raw",
      DEFAULT_CODEX_APP_INFO_PLIST_PATH
    ], {
      encoding: "utf-8",
      timeout: 2e3
    });
    const version = stdout.trim();
    return { installed: true, version: version || null };
  } catch {
    return { installed: true, version: null };
  }
}
async function detectCodexCliVersion() {
  const bin = await findStandaloneCodexCliBinary();
  if (!bin) return { installed: false, version: null };
  return { installed: true, version: await detectVersionFromBinary(bin) };
}
async function detectCodexVersions() {
  const [app, cli] = await Promise.all([detectCodexAppVersion(), detectCodexCliVersion()]);
  return { app, cli };
}
function resolveCodexFeatureFlags(toml2, detectedVersions) {
  if (detectedVersions) {
    const appInstalled = detectedVersions.app.installed;
    const cliInstalled = detectedVersions.cli.installed;
    const appVersion = detectedVersions.app.version;
    const cliVersion = detectedVersions.cli.version;
    if (appInstalled && appVersion && !isHooksOnlyCapableCodexAppVersion(appVersion)) {
      return [CODEX_HOOKS_FEATURE, CODEX_HOOKS_FEATURE_LEGACY];
    }
    if (cliInstalled && cliVersion && !isHooksOnlyCapableCodexCliVersion(cliVersion)) {
      return [CODEX_HOOKS_FEATURE, CODEX_HOOKS_FEATURE_LEGACY];
    }
    if (appInstalled || cliInstalled) {
      return [CODEX_HOOKS_FEATURE];
    }
  }
  return hasHooksOnlyFeatureConfig(toml2) ? [CODEX_HOOKS_FEATURE] : [CODEX_HOOKS_FEATURE, CODEX_HOOKS_FEATURE_LEGACY];
}
function parseToml(toml2) {
  if (!toml2.trim()) return {};
  try {
    return toml__namespace.parse(toml2);
  } catch (err) {
    console.warn(
      `[codex-hooks] failed to parse config.toml, falling back to safe default: ${err.message}`
    );
    return null;
  }
}
async function installCodexHook(ctx, options) {
  const hooksConfigPath = getCodexHooksConfigPath(ctx.homeDir);
  const existing = await readExistingCodexHooksFile(hooksConfigPath);
  const fluxHooks = {};
  for (const { event, matcher, timeout } of CODEX_EVENTS) {
    const entry = {
      command: ctx.hookCommand,
      type: "command",
      timeout: timeout ?? 5
    };
    const group = { hooks: [entry] };
    if (matcher !== void 0) group.matcher = matcher;
    fluxHooks[event] = [group];
  }
  for (const [event, groups] of Object.entries(fluxHooks)) {
    const current = existing.hooks[event] ?? [];
    const filtered = current.filter((g) => !isFluxHookGroup$1(g));
    existing.hooks[event] = [...filtered, ...groups];
  }
  if (options?.extraGroups && options.isExtraGroup) {
    if (options.extraEnabled) {
      for (const [event, groups] of Object.entries(options.extraGroups)) {
        const current = existing.hooks[event] ?? [];
        const filtered = current.filter((g) => !options.isExtraGroup(g));
        existing.hooks[event] = [...filtered, ...groups];
      }
    } else {
      for (const event of Object.keys(options.extraGroups)) {
        const groups = existing.hooks[event];
        if (!groups) continue;
        const filtered = groups.filter((g) => !options.isExtraGroup(g));
        if (filtered.length === 0) {
          delete existing.hooks[event];
        } else {
          existing.hooks[event] = filtered;
        }
      }
    }
  }
  await writeJson$h(hooksConfigPath, existing);
  const isExtraGroup = options?.isExtraGroup;
  const shouldHashGroup = (group) => isFluxHookGroup$1(group) || (isExtraGroup ? isExtraGroup(group) : false);
  const trustEntries = computeCodexTrustEntries(hooksConfigPath, existing.hooks, shouldHashGroup);
  const tomlConfigPath = getCodexTomlConfigPath(ctx.homeDir);
  const toml2 = await readText$4(tomlConfigPath);
  const featureConfig = analyzeExistingCodexFeatureConfig(toml2);
  const getDetectedVersions = async () => options && "detectedCodexVersions" in options ? options.detectedCodexVersions ?? null : await detectCodexVersions();
  let manageFeatureFlags = false;
  let detectedVersions = null;
  let featureFlagsAdded = [];
  if (!featureConfig.hasHooksKey) {
    detectedVersions = await getDetectedVersions();
    featureFlagsAdded = resolveCodexFeatureFlags(toml2, detectedVersions);
    manageFeatureFlags = true;
  } else if (featureConfig.hooksValue === true && featureConfig.codexHooksValue === true) {
    detectedVersions = await getDetectedVersions();
    if (shouldDropLegacyFlagForUpgradedCodex(detectedVersions)) {
      featureFlagsAdded = [CODEX_HOOKS_FEATURE];
      manageFeatureFlags = true;
    }
  }
  const skippedFeatureFlagInjection = !manageFeatureFlags;
  options?.logger?.info("[codex-hooks] install feature flag decision", {
    hasHooksKey: featureConfig.hasHooksKey,
    hooksValue: featureConfig.hooksValue,
    hasCodexHooksKey: featureConfig.hasCodexHooksKey,
    codexHooksValue: featureConfig.codexHooksValue,
    appInstalled: detectedVersions?.app.installed ?? false,
    appVersion: detectedVersions?.app.version ?? null,
    cliInstalled: detectedVersions?.cli.installed ?? false,
    cliVersion: detectedVersions?.cli.version ?? null,
    featureFlagsAdded,
    skippedFeatureFlagInjection,
    hooksEnabled: featureFlagsAdded.includes(CODEX_HOOKS_FEATURE),
    codexHooksEnabled: featureFlagsAdded.includes(CODEX_HOOKS_FEATURE_LEGACY)
  });
  const updated = applyCodexConfigToml(toml2, {
    featureFlagsToWrite: featureFlagsAdded,
    manageFeatureFlags,
    trustEntries,
    staleKeys: options?.staleKeys
  });
  await promises.mkdir(path.dirname(tomlConfigPath), { recursive: true });
  await promises.writeFile(tomlConfigPath, updated, "utf-8");
  return {
    hooksConfigPath,
    tomlConfigPath,
    featureFlagsAdded,
    trustEntries
  };
}
async function uninstallCodexHook(homeDir, options) {
  const inferredTrustKeys = [];
  const hooksConfigPaths = /* @__PURE__ */ new Set([
    getCodexHooksConfigPath(homeDir),
    ...options?.metadata?.hooksConfigPath ? [options.metadata.hooksConfigPath] : []
  ]);
  for (const hooksConfigPath of hooksConfigPaths) {
    let hooksFile;
    try {
      const raw = await promises.readFile(hooksConfigPath, "utf-8");
      hooksFile = JSON.parse(raw);
    } catch (err) {
      if (err.code === "ENOENT") continue;
      if (options?.strict) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to read Codex hooks config at ${hooksConfigPath}: ${reason}`);
      }
      continue;
    }
    if (!hooksFile.hooks) continue;
    const ownsGroup = (group) => isFluxHookGroup$1(group) || (options?.isExtraGroup?.(group) ?? false);
    inferredTrustKeys.push(
      ...computeCodexTrustEntries(hooksConfigPath, hooksFile.hooks, ownsGroup).map((entry) => entry.key)
    );
    const events2 = new Set(CODEX_EVENTS.map((item) => item.event));
    for (const event of options?.metadata?.events ?? []) {
      events2.add(event);
    }
    for (const event of Object.keys(options?.extraGroups ?? {})) {
      events2.add(event);
    }
    let mutated = false;
    for (const event of events2) {
      const groups = hooksFile.hooks[event];
      if (!groups) continue;
      const filtered = groups.filter((group) => !ownsGroup(group));
      if (filtered.length === groups.length) continue;
      mutated = true;
      if (filtered.length === 0) delete hooksFile.hooks[event];
      else hooksFile.hooks[event] = filtered;
    }
    if (mutated) {
      await writeJson$h(hooksConfigPath, hooksFile);
    }
  }
  const defaultTomlConfigPath = getCodexTomlConfigPath(homeDir);
  const metadataTomlConfigPath = options?.metadata?.tomlConfigPath ?? defaultTomlConfigPath;
  const tomlConfigPaths = /* @__PURE__ */ new Set([
    defaultTomlConfigPath,
    ...options?.metadata?.tomlConfigPath ? [options.metadata.tomlConfigPath] : []
  ]);
  for (const tomlConfigPath of tomlConfigPaths) {
    let toml2;
    try {
      toml2 = await promises.readFile(tomlConfigPath, "utf-8");
    } catch (err) {
      if (err.code === "ENOENT") continue;
      if (options?.strict) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to read Codex TOML config at ${tomlConfigPath}: ${reason}`);
      }
      continue;
    }
    if (!toml2) continue;
    const updated = disableCodexConfigToml(toml2, {
      keysToRemove: [
        .../* @__PURE__ */ new Set([
          ...inferredTrustKeys,
          ...tomlConfigPath === metadataTomlConfigPath ? options?.metadata?.trustedHookKeys ?? [] : []
        ])
      ],
      flagsToRemove: tomlConfigPath === metadataTomlConfigPath ? options?.metadata?.featureFlagsAdded ?? [] : []
    });
    if (updated !== toml2) {
      await promises.writeFile(tomlConfigPath, updated, "utf-8");
    }
  }
}
function getHookBinaryPath$a() {
  const resourcesPath = process.resourcesPath ?? path.join(electron.app.getAppPath(), "resources");
  return path.resolve(resourcesPath, "bin", "flux-hooks");
}
function getHooksConfigPath() {
  return getCodexHooksConfigPath(os.homedir());
}
function getTomlConfigPath() {
  return getCodexTomlConfigPath(os.homedir());
}
function getManifestPath$a() {
  return path.join(os.homedir(), ".flux", "hooks", "codex-manifest.json");
}
function buildCommand$8() {
  if (utils.is.dev) return buildDevHooksCliCommand("codex");
  const nodeCmd = `ELECTRON_RUN_AS_NODE=1 ${shellQuote(process.execPath)}`;
  const hookBinary = getHookBinaryPath$a();
  if (fs.existsSync(hookBinary)) {
    return wrapWithInstallCheck(
      process.execPath,
      `${nodeCmd} ${shellQuote(hookBinary)} --source codex`
    );
  }
  return wrapWithInstallCheck(
    process.execPath,
    `${nodeCmd} ${shellQuote(hookBinary)} --source codex`
  );
}
async function readJson$d(filePath) {
  try {
    const raw = await promises.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function writeJson$g(filePath, data) {
  await promises.mkdir(path.dirname(filePath), { recursive: true });
  await promises.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
async function readToml(filePath) {
  try {
    return await promises.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}
class CodexHookManager {
  agentId = "codex";
  async install(options) {
    const hooksPath = getHooksConfigPath();
    const tomlPath = getTomlConfigPath();
    const command = buildCommand$8();
    const previousManifest = await readJson$d(getManifestPath$a());
    const previousKeys = previousManifest?.trustedHookKeys ?? [];
    const installResult = await installCodexHook(
      { homeDir: os.homedir(), hookCommand: command },
      {
        extraEnabled: false,
        extraGroups: [],
        isExtraGroup: isCodexBitsHookGroup,
        logger: log,
        staleKeys: previousKeys
      }
    );
    const manifest = {
      hooksConfigPath: hooksPath,
      tomlConfigPath: tomlPath,
      events: CODEX_EVENTS.map((e) => e.event),
      // 重装时 hooks flag 已存在，installCodexHook 会按“保持用户现状”返回空数组；
      // 这里保留上次由 Flux 创建的归属，确保后续关闭开关仍能精确回收。
      featureFlagsAdded: [
        .../* @__PURE__ */ new Set([
          ...previousManifest?.featureFlagsAdded ?? [],
          ...installResult.featureFlagsAdded
        ])
      ],
      trustedHookKeys: installResult.trustEntries.map((e) => e.key),
      installedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await writeJson$g(getManifestPath$a(), manifest);
  }
  async uninstall() {
    const manifestPath = getManifestPath$a();
    const manifest = await readJson$d(manifestPath);
    await uninstallCodexHook(os.homedir(), {
      extraGroups: [],
      isExtraGroup: isCodexBitsHookGroup,
      metadata: manifest
    });
    try {
      await promises.unlink(manifestPath);
    } catch {
    }
  }
  async checkHealth() {
    const issues = [];
    const binaryPath = getHookBinaryPath$a();
    if (!utils.is.dev && !fs.existsSync(binaryPath)) {
      issues.push(`Hook binary not found: ${binaryPath}`);
    }
    const hooksConfigPath = getHooksConfigPath();
    const hooksConfig = await readJson$d(hooksConfigPath);
    if (!hooksConfig?.hooks) {
      issues.push("Codex hooks.json not found");
      return {
        agentId: "codex",
        installed: false,
        issues,
        manifestPath: getManifestPath$a()
      };
    }
    const command = buildCommand$8();
    for (const { event } of CODEX_EVENTS) {
      const groups = hooksConfig.hooks[event];
      if (!groups || !groups.some(isFluxHookGroup$1)) {
        issues.push(`Missing hook for event: ${event}`);
      } else {
        const fluxGroup = groups.find(isFluxHookGroup$1);
        const fluxEntry = fluxGroup?.hooks.find(isFluxHookEntry$4);
        if (fluxEntry && fluxEntry.command !== command) {
          issues.push(`Stale command for ${event}: expected ${command}`);
        }
      }
    }
    const toml2 = await readToml(getTomlConfigPath());
    if (!hasAnyCodexHooksFeature(toml2)) {
      issues.push("Codex hooks feature not enabled in config.toml");
    }
    const trustState = readCodexTrustState(toml2);
    const expected = computeCodexTrustEntries(
      hooksConfigPath,
      hooksConfig.hooks,
      (group) => isFluxHookGroup$1(group) || isCodexBitsHookGroup(group)
    );
    for (const entry of expected) {
      const persisted = trustState[entry.key];
      if (!persisted) {
        issues.push(`Missing trust state for ${entry.key}`);
      } else if (persisted !== entry.trustedHash) {
        issues.push(`Stale trust state for ${entry.key}: hash mismatch`);
      }
    }
    return {
      agentId: "codex",
      installed: issues.length === 0,
      issues,
      manifestPath: getManifestPath$a()
    };
  }
}
const COCO_EVENTS = [
  { event: "user_prompt_submit" },
  { event: "pre_tool_use" },
  { event: "post_tool_use" },
  { event: "post_tool_use_failure" },
  // permission_request 需要用户在 Island 审批，timeout 必须足够长
  // 否则 hook 在用户点击前超时，Coco CLI 会杀掉 hooks-cli 进程，导致审批无效
  { event: "permission_request", timeout: 86400 },
  { event: "stop" },
  { event: "session_start" },
  { event: "session_end" },
  { event: "subagent_start" },
  { event: "subagent_stop" },
  // notification_type: permission_prompt（权限提示）、elicitation_dialog（Agent 提问）、idle_prompt（Agent 空闲等待)
  { event: "notification" }
];
module.exports = { ClaudeHookManager, CodexHookManager };
