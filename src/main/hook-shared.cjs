"use strict";

const electron = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHooksCliCommand } = require("./hooks-cli-command.cjs");

const REGISTRY_PATH = path.join(os.homedir(), ".flux", "sessions.json");
const MAX_SESSIONS = 50;
const MAX_AGE_MS$1 = 24 * 60 * 60 * 1e3;
function saveSessions(sessions) {
  try {
    const dir = path.dirname(REGISTRY_PATH);
    fs.mkdirSync(dir, { recursive: true });
    const recent = sessions.filter((s) => s.updatedAt > Date.now() - MAX_AGE_MS$1).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS);
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(recent, null, 2));
  } catch {
  }
}
function shellQuote(p) {
  if (process.platform === "win32") return `"${String(p).replaceAll('"', '\\"')}"`;
  return `'${p}'`;
}
function buildDevHooksCliCommand(source) {
  return createHooksCliCommand({
    appPath: electron.app.getAppPath(),
    source,
    nodePath: process.env.FLUX_HOOK_NODE || process.execPath,
    electronNodePath: process.execPath
  });
}
function wrapWithInstallCheck(guardPath, command, { platform = process.platform, portableExecutable = process.env.PORTABLE_EXECUTABLE_FILE } = {}) {
  if (platform === "win32") {
    const sourceMatch = String(command).match(/--source\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
    const source = sourceMatch?.[1] || sourceMatch?.[2] || sourceMatch?.[3];
    if (portableExecutable && source) {
      return `if not exist ${shellQuote(portableExecutable)} exit /b 0 & ${shellQuote(portableExecutable)} --workisland-hook-source=${source}`;
    }
    const normalized = command.replace(/^ELECTRON_RUN_AS_NODE=1\s+/, 'set "ELECTRON_RUN_AS_NODE=1"&& ');
    return `if not exist ${shellQuote(guardPath)} exit /b 0 & ${normalized}`;
  }
  return `[ -e ${shellQuote(guardPath)} ] || exit 0; ${command}`;
}
// Migration-only marker: installers remove obsolete private reporting hooks
// from existing Agent configs and never add them back.
const BITS_REPORT_BIN_MARKER = "flux-bits-report";
function isBitsCommand(command) {
  return typeof command === "string" && command.includes(BITS_REPORT_BIN_MARKER);
}
function isClaudeBitsHookGroup(group) {
  return Array.isArray(group?.hooks) && group.hooks.some((e) => isBitsCommand(e?.command));
}
function isCodexBitsHookGroup(group) {
  return Array.isArray(group?.hooks) && group.hooks.some((e) => isBitsCommand(e?.command));
}
function isCursorBitsEntry(entry) {
  return isBitsCommand(entry?.command);
}
function isKimiBitsEntry(entry) {
  return !!entry.command && isBitsCommand(entry.command);
}
const OPENCODE_BITS_PLUGIN_FILENAME = "ai-code-report.plugin.js";
module.exports = {
  saveSessions,
  shellQuote,
  buildDevHooksCliCommand,
  wrapWithInstallCheck,
  isClaudeBitsHookGroup,
  isCodexBitsHookGroup,
  isCursorBitsEntry,
  isKimiBitsEntry,
  OPENCODE_BITS_PLUGIN_FILENAME
};
