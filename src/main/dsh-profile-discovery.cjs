"use strict";

const os = require("node:os");
const path = require("node:path");

const DSH_SUBCOMMANDS = ["desktop", "web", "tui", "headless", "acp", "sdk"];

// macOS 桌面版使用 Electron 可执行文件，Helper 带有独立 user-data-dir。
// 限定可执行文件位置，避免将命令参数中的应用路径误认为正在运行的客户端。
const PROCESS_PREFIX = String.raw`^\s*\d+\s+(?:\S+\s+[A-Z?+]+\s+[\d:.]+\s+)?`;
const DSH_DESKTOP_APP_PATTERN = new RegExp(PROCESS_PREFIX + String.raw`"?\/(?:(?!\s+\/)[^\n])*?DeepSeek Harness\.app\/Contents\/MacOS\/DeepSeek Harness(?:"|\s|$)`);
const DSH_DESKTOP_HELPER_PATTERN = new RegExp(PROCESS_PREFIX + String.raw`"?\/(?:(?!\s+\/)[^\n])*?DeepSeek Harness\.app\/Contents\/Frameworks\/DeepSeek Harness Helper[^\n]*?\/Contents\/MacOS\/DeepSeek Harness Helper[^\n]*?--user-data-dir=[^\n]*?@deepseek-ai\/dsh-desktop(?:\s|$)`);
function isDesktopDshProcess(line) {
  return DSH_DESKTOP_APP_PATTERN.test(line) || DSH_DESKTOP_HELPER_PATTERN.test(line);
}

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
    if (!line) continue;
    const isDesktopClient = isDesktopDshProcess(line);
    if (!/\bdsh\b/.test(line) && !isDesktopClient) continue;
    const pidMatch = line.match(/^(\d+)\b/);
    if (!pidMatch) continue;
    const profileMatch = isDesktopClient ? null : line.match(/(?:^|\s)--profile(?:=|\s+)([^\s]+)/);
    const portMatch = line.match(/(?:^|\s)--port(?:=|\s+)(\d+)/);
    const homeMatch = line.match(/(?:^|\s)DSH_HOME=(.*?)(?=\s[A-Z][A-Z0-9_]*=|$)/);
    // launcher 用 `dsh web --port 3080` 启动，命令行里没有 --profile/DSH_HOME；
    // 这时按子命令名 + 默认 DSH_HOME 兜底，profile 名就是子命令名。
    const subcommandMatch = profileMatch
      ? null
      : line.match(/(?:^|\s)(?:node\s+)?\S*dsh\S*\s+(web|tui|headless|acp|sdk|desktop)(?=\s|$)/);
    const name = (profileMatch?.[1] || subcommandMatch?.[1] || (isDesktopClient ? "desktop" : "") || "").trim();
    const homeDir = (homeMatch?.[1] || defaultHomeDir || "").trim();
    if (!name || !homeDir) continue;
    const profileDir = profileDirFor(homeDir, name);
    // 桌面客户端会带一串 Helper 进程；都映射到同一个 desktop profile，
    // Map 按 profileDir 去重，但优先保留主进程（非 Helper）的 pid。
    const existing = profiles.get(profileDir);
    const isHelper = /Helper/.test(line);
    if (!existing || (existing.record.name === "desktop" && isDesktopClient && existing.isHelper && !isHelper)) {
      profiles.set(profileDir, {
        isHelper,
        record: { pid: Number(pidMatch[1]), name, ...(portMatch ? { port: Number(portMatch[1]) } : {}), homeDir, profileDir }
      });
    }
  }
  return [...profiles.values()].map(({ record }) => record);
}

module.exports = { discoverRunningDshProfiles, isDesktopDshProcess, DSH_SUBCOMMANDS, defaultDshHome };
