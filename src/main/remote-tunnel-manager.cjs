"use strict";

/**
 * Mac 发起的反向隧道管理器（PRD-016「SSH 远程」设置页，ADR-0005 实现附注 5）。
 *
 * 每台已添加主机一条 `ssh -N -R <remotePort>:127.0.0.1:<localPort> <target>`
 * 常驻进程：远程机自己的 127.0.0.1:<remotePort> 反向指向本机 WorkIsland
 * observe-only 入口。用户自管 SSH（复用 ~/.ssh/config 与密钥），BatchMode
 * 防止密码交互挂死；断开按指数退避自动重拉，撤销/关闭远程接入即停。
 */

const { spawn } = require("node:child_process");
const log = require("electron-log");

const DEFAULT_REMOTE_FORWARD_PORT = 17878;
const RESTART_BASE_DELAY_MS = 1000;
const RESTART_MAX_DELAY_MS = 30 * 1000;

function buildSshArgs({ sshTarget, remoteForwardPort, localPort }) {
  return [
    "-N",
    "-R", `${remoteForwardPort}:127.0.0.1:${localPort}`,
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    sshTarget
  ];
}

function createRemoteTunnelManager({
  spawnProcess = spawn,
  getLocalPort = () => 7878,
  remoteForwardPort = DEFAULT_REMOTE_FORWARD_PORT,
  now = Date.now
} = {}) {
  const tunnels = /* @__PURE__ */ new Map();

  function launch(hostId, sshTarget, record) {
    const args = buildSshArgs({ sshTarget, remoteForwardPort, localPort: getLocalPort() });
    let child;
    try {
      child = spawnProcess("ssh", args, { stdio: ["ignore", "ignore", "pipe"] });
    } catch (error) {
      log.error("[RemoteTunnel]", "spawn failed:", error.message);
      record.running = false;
      record.lastError = "SPAWN_FAILED";
      return;
    }
    record.running = true;
    record.pid = child.pid ?? null;
    record.lastStartedAt = now();
    record.lastError = null;
    log.info("[RemoteTunnel]", `tunnel up: ${sshTarget} (pid ${child.pid})`);
    let stderrTail = "";
    child.stderr?.on("data", (chunk) => {
      stderrTail = `${stderrTail}${chunk}`.split("\n").filter(Boolean).slice(-3).join("\n");
    });
    child.on("exit", (code) => {
      const isCurrent = record.child === child;
      record.running = false;
      record.pid = null;
      record.lastExitCode = code;
      record.stderrTail = stderrTail || null;
      if (!isCurrent) return;
      if (record.stopped) return;
      // 断线自动重拉：指数退避，封顶 30s。
      record.restarts += 1;
      const delay = Math.min(RESTART_BASE_DELAY_MS * 2 ** Math.min(record.restarts - 1, 5), RESTART_MAX_DELAY_MS);
      log.warn("[RemoteTunnel]", `tunnel exited (code ${code}), restart in ${delay}ms: ${sshTarget}`);
      record.restartTimer = setTimeout(() => {
        if (record.stopped) return;
        launch(hostId, sshTarget, record);
      }, delay);
    });
    record.child = child;
  }

  return {
    startTunnel({ hostId, sshTarget }) {
      if (!hostId || !sshTarget) return false;
      const existing = tunnels.get(hostId);
      if (existing?.running) return true;
      if (existing?.restartTimer) clearTimeout(existing.restartTimer);
      const record = existing ?? { restarts: 0, stopped: false };
      record.stopped = false;
      tunnels.set(hostId, record);
      launch(hostId, sshTarget, record);
      return true;
    },
    stopTunnel(hostId) {
      const record = tunnels.get(hostId);
      if (!record) return false;
      record.stopped = true;
      if (record.restartTimer) clearTimeout(record.restartTimer);
      try {
        record.child?.kill();
      } catch {
        // 进程已退出时 kill 失败可忽略
      }
      record.running = false;
      record.child = null;
      tunnels.delete(hostId);
      return true;
    },
    stopAll() {
      for (const hostId of Array.from(tunnels.keys())) this.stopTunnel(hostId);
    },
    hasTunnel(hostId) {
      return tunnels.has(hostId);
    },
    status() {
      const out = {};
      for (const [hostId, record] of tunnels) {
        out[hostId] = {
          running: !!record.running,
          pid: record.pid ?? null,
          lastExitCode: record.lastExitCode ?? null,
          lastStartedAt: record.lastStartedAt ?? null,
          restarts: record.restarts ?? 0,
          stderrTail: record.stderrTail ?? null,
          remoteForwardPort
        };
      }
      return out;
    }
  };
}

module.exports = {
  DEFAULT_REMOTE_FORWARD_PORT,
  buildSshArgs,
  createRemoteTunnelManager
};
