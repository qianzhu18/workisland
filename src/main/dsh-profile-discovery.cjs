"use strict";

const path = require("node:path");

function discoverRunningDshProfiles(psOutput) {
  const profiles = new Map();
  for (const rawLine of String(psOutput || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !/\bdsh\b/.test(line)) continue;
    const pidMatch = line.match(/^(\d+)\b/);
    const profileMatch = line.match(/(?:^|\s)--profile(?:=|\s+)([^\s]+)/);
    const portMatch = line.match(/(?:^|\s)--port(?:=|\s+)(\d+)/);
    const homeMatch = line.match(/(?:^|\s)DSH_HOME=(.*?)(?=\s[A-Z][A-Z0-9_]*=|$)/);
    if (!pidMatch || !profileMatch || !homeMatch) continue;
    const name = profileMatch[1].trim();
    const homeDir = homeMatch[1].trim();
    if (!name || !homeDir) continue;
    const profileDir = path.join(homeDir, "profiles", name);
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

module.exports = { discoverRunningDshProfiles };
