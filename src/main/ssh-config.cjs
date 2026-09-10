"use strict";

/**
 * ~/.ssh/config 解析（PRD-016 远程接入「SSH 远程」设置页）。
 *
 * 纯函数、零依赖：只提取添加主机所需的最小字段
 * （alias / hostName / user / port），通配符与取反模式跳过。
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function splitTokens(value) {
  return value.split(/[=\s]+/).filter(Boolean);
}

/**
 * 解析 ssh config 文本。Host 行的每个非通配 pattern 生成一条候选主机；
 * 后续 HostName / User / Port 归属最近的 Host 行。
 */
function parseSshConfig(text) {
  const entries = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    for (const alias of current.aliases) {
      entries.push({
        alias,
        hostName: current.hostName ?? alias,
        user: current.user ?? null,
        port: current.port ?? "22"
      });
    }
    current = null;
  };
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const tokens = splitTokens(line);
    if (tokens.length < 2) continue;
    const key = tokens[0].toLowerCase();
    const value = tokens.slice(1).join(" ");
    if (key === "host") {
      flush();
      const aliases = tokens.slice(1).filter((pattern) => !/[*!?]/.test(pattern));
      if (aliases.length > 0) current = { aliases, hostName: null, user: null, port: null };
      continue;
    }
    if (!current) continue;
    if (key === "hostname") current.hostName = value;
    else if (key === "user") current.user = value;
    else if (key === "port") {
      if (/^\d{1,5}$/.test(value)) current.port = value;
    }
  }
  flush();
  return entries;
}

/**
 * 扫描 ~/.ssh/config。文件不存在或不可读时返回空列表（首次使用是常态）。
 * 同名 alias 只保留一条（Include 复杂用法留给后续版本）。
 */
function scanSshConfig({ homeDir = os.homedir(), readFileSync = fs.readFileSync } = {}) {
  const configPath = path.join(homeDir, ".ssh", "config");
  let text;
  try {
    text = readFileSync(configPath, "utf8");
  } catch {
    return { configPath, entries: [] };
  }
  const seen = /* @__PURE__ */ new Set();
  const entries = [];
  for (const entry of parseSshConfig(text)) {
    if (seen.has(entry.alias)) continue;
    seen.add(entry.alias);
    entries.push(entry);
  }
  return { configPath, entries };
}

/** ssh 目标串（scp / ssh 命令直接可用）：优先 alias，否则 user@host[:port]。 */
function formatSshTarget(entry) {
  if (!entry) return "";
  const isDefaultPort = !entry.port || entry.port === "22";
  if (entry.alias && entry.alias !== entry.hostName) return entry.alias;
  const base = entry.user ? `${entry.user}@${entry.hostName}` : entry.hostName;
  return isDefaultPort ? base : `ssh://${base}:${entry.port}`;
}

module.exports = { parseSshConfig, scanSshConfig, formatSshTarget };
