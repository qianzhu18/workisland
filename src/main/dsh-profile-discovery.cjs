"use strict";

const os = require("node:os");
const path = require("node:path");

const DSH_SUBCOMMANDS = ["web", "tui", "headless", "acp", "sdk"];

function defaultDshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
}

function profileDirFor(homeDir, name) {
  return homeDir.startsWith("/")
    ? path.posix.join(homeDir, "profiles", name)
    : path.join(homeDir, "profiles", name);
}

function discoverRunningDshProfiles(psOutput, options = {}) {
  const defaultHomeDir = options.homeDir || defaultDshHome();
  const profiles = new Map();
  for (const rawLine of String(psOutput || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !/\bdsh\b/.test(line)) continue;
    const pidMatch = line.match(/^(\d+)\b/);
    if (!pidMatch) continue;
    const profileMatch = line.match(/(?:^|\s)--profile(?:=|\s+)([^\s]+)/);
    const portMatch = line.match(/(?:^|\s)--port(?:=|\s+)(\d+)/);
    const homeMatch = line.match(/(?:^|\s)DSH_HOME=(.*?)(?=\s[A-Z][A-Z0-9_]*=|$)/);
    // launcher 用 `dsh web --port 3080` 启动，命令行里没有 --profile/DSH_HOME；
    // 这时按子命令名 + 默认 DSH_HOME 兜底，profile 名就是子命令名。
    const subcommandMatch = profileMatch
      ? null
      : line.match(/(?:^|\s)(?:node\s+)?\S*dsh\S*\s+(web|tui|headless|acp|sdk)(?=\s|$)/);
    const name = (profileMatch?.[1] || subcommandMatch?.[1] || "").trim();
    const homeDir = (homeMatch?.[1] || defaultHomeDir || "").trim();
    if (!name || !homeDir) continue;
    const profileDir = profileDirFor(homeDir, name);
    if (!profiles.has(profileDir)) {
      profiles.set(profileDir, {
        pid: Number(pidMatch[1]),
        name,
        ...(portMatch ? { port: Number(portMatch[1]) } : {}),
        homeDir,
        profileDir
      });
    }
  }
  return [...profiles.values()];
}

module.exports = { discoverRunningDshProfiles, DSH_SUBCOMMANDS, defaultDshHome };
