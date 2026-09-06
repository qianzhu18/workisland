"use strict";

/**
 * 远程主机注册表（ADR-0005 D4 / D5）。
 *
 * 持久化在 ~/.flux/remote-hosts.json（0600）：
 * - hostId（UUID，远程侧生成）→ 显示名 + 会话密钥的 SHA-256 哈希；
 * - 撤销 = 删除记录，旧会话密钥立即失效（D5）；
 * - 配对令牌与明文会话密钥永远不落盘。
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

function getStorePath(homeDir = os.homedir()) {
  return path.join(homeDir, ".flux", "remote-hosts.json");
}

function hashSessionKey(sessionKey) {
  return crypto.createHash("sha256").update(sessionKey, "utf8").digest("hex");
}

function createRemoteHostStore({ filePath = getStorePath(), now = Date.now } = {}) {
  let data = { hosts: [] };

  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (parsed && Array.isArray(parsed.hosts)) data = { hosts: parsed.hosts };
    } catch {
      data = { hosts: [] };
    }
    return data;
  }

  function save() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  load();

  return {
    /** 首次配对或刷新显示名；每次调用都会轮换会话密钥哈希。 */
    upsertHost(hostId, displayName, sessionKey) {
      const timestamp = now();
      let host = data.hosts.find((h) => h.hostId === hostId);
      if (host) {
        host.displayName = displayName;
        host.sessionKeyHash = hashSessionKey(sessionKey);
        host.pairedAt = timestamp;
        host.lastSeenAt = timestamp;
      } else {
        host = {
          hostId,
          displayName,
          sessionKeyHash: hashSessionKey(sessionKey),
          pairedAt: timestamp,
          lastSeenAt: timestamp
        };
        data.hosts.push(host);
      }
      save();
      return { hostId: host.hostId, displayName: host.displayName, pairedAt: host.pairedAt, lastSeenAt: host.lastSeenAt };
    },
    /** 会话密钥 → 主机记录（哈希比对）；命中时刷新 lastSeenAt。 */
    findBySessionKey(sessionKey) {
      const hash = hashSessionKey(sessionKey);
      const host = data.hosts.find((h) => h.sessionKeyHash === hash);
      if (!host) return null;
      host.lastSeenAt = now();
      return { hostId: host.hostId, displayName: host.displayName, pairedAt: host.pairedAt, lastSeenAt: host.lastSeenAt };
    },
    /** D5 撤销：删除记录即拉黑当前会话密钥；重新配对需要用户重新生成令牌。 */
    revokeHost(hostId) {
      const before = data.hosts.length;
      data.hosts = data.hosts.filter((h) => h.hostId !== hostId);
      const changed = data.hosts.length !== before;
      if (changed) save();
      return changed;
    },
    listHosts() {
      return data.hosts
        .map(({ hostId, displayName, pairedAt, lastSeenAt }) => ({ hostId, displayName, pairedAt, lastSeenAt }))
        .sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0));
    },
    hostCount() {
      return data.hosts.length;
    }
  };
}

module.exports = { createRemoteHostStore, getStorePath, hashSessionKey };
