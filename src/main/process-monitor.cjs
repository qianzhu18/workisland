"use strict";

const childProcess = require("child_process");
const { promisify } = require("util");
const log = require("electron-log");

function parseWindowsTasklist(stdout) {
  return new Set(String(stdout || "").split(/\r?\n/).map((line) => {
    const match = line.match(/^"([^"]+)"/);
    return match?.[1]?.toLowerCase();
  }).filter(Boolean));
}

function createProcessMonitorClass({ isVisibleInIsland, platform = process.platform, execFile = childProcess.execFile }) {
  function hasAppBundlePathSegment(command, appBundleNames) {
    const segments = command.toLowerCase().split("/");
    return appBundleNames.some((appBundleName) => segments.includes(appBundleName.toLowerCase()));
  }
  function isCursorDesktopAppCommand(command) {
    return hasAppBundlePathSegment(command, ["Cursor.app"]);
  }
  function isClaudeDesktopAppCommand(command) {
    return hasAppBundlePathSegment(command, ["Claude.app"]);
  }
  function isCodexDesktopAppCommand(command) {
    return hasAppBundlePathSegment(command, ["Codex.app", "Codex Desktop.app"]);
  }
  function isOpenCodeDesktopAppCommand(command) {
    return hasAppBundlePathSegment(command, ["OpenCode.app", "OpenCode Desktop.app"]);
  }
  function isTraeDesktopAppCommand(command) {
    return hasAppBundlePathSegment(command, ["Trae CN.app", "Trae.app", "Trae - Dev.app", "Trae CN - Dev.app", "Trae CN - Alpha.app"]);
  }
  const execFileAsync$7 = promisify(execFile);
  const PS_TIMEOUT_MS$1 = platform === "win32" ? 5e3 : 500;
  const POLL_INTERVAL_MS$2 = 15e3;
  const APP_EXIT_GRACE_MS = 14e3;
  let desktopDetectionAvailable = true;
  async function detectDesktopApps() {
    if (!desktopDetectionAvailable) return null;
    let isCursorRunning = false;
    let isClaudeDesktopAppRunning = false;
    let isCodexDesktopAppRunning = false;
    let isOpenCodeRunning = false;
    let isTraeRunning = false;
    try {
      if (platform === "win32") {
        const { stdout } = await execFileAsync$7("tasklist.exe", ["/FO", "CSV", "/NH"], { timeout: PS_TIMEOUT_MS$1, windowsHide: true });
        const names = parseWindowsTasklist(stdout);
        return {
          isCursorRunning: names.has("cursor.exe"),
          isClaudeDesktopAppRunning: names.has("claude.exe"),
          isCodexDesktopAppRunning: names.has("codex.exe"),
          isOpenCodeRunning: names.has("opencode.exe"),
          isTraeRunning: names.has("trae.exe")
        };
      }
      const { stdout } = await execFileAsync$7(
        "/bin/ps",
        ["-Ao", "command="],
        { timeout: PS_TIMEOUT_MS$1 }
      );
      for (const line of stdout.split("\n")) {
        if (!isCursorRunning && isCursorDesktopAppCommand(line)) isCursorRunning = true;
        if (!isClaudeDesktopAppRunning && isClaudeDesktopAppCommand(line)) isClaudeDesktopAppRunning = true;
        if (!isCodexDesktopAppRunning && isCodexDesktopAppCommand(line)) isCodexDesktopAppRunning = true;
        if (!isOpenCodeRunning && isOpenCodeDesktopAppCommand(line)) isOpenCodeRunning = true;
        if (!isTraeRunning && isTraeDesktopAppCommand(line)) isTraeRunning = true;
        if (isCursorRunning && isClaudeDesktopAppRunning && isCodexDesktopAppRunning && isOpenCodeRunning && isTraeRunning) break;
      }
    } catch (err) {
      if (platform === "win32") {
        desktopDetectionAvailable = false;
        log.warn("[ProcessMonitor] Windows process listing unavailable; desktop-app exit cleanup is disabled:", err.message);
      } else {
        log.error("[ProcessMonitor] ps failed:", err);
      }
      return null;
    }
    const result = { isCursorRunning, isClaudeDesktopAppRunning, isCodexDesktopAppRunning, isOpenCodeRunning, isTraeRunning };
    return result;
  }
  class ProcessMonitor {
    timer = null;
    opts;
    /**
     * 内部记录每个会话首次检测到 App 不在的时间戳。
     * App 重新出现时删除对应条目。
     */
    appGoneSince = /* @__PURE__ */ new Map();
    constructor(opts) {
      this.opts = opts;
    }
    start() {
      if (this.timer) return;
      log.info("[ProcessMonitor] started, interval=%dms", POLL_INTERVAL_MS$2);
      this.tick();
      this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS$2);
    }
    stop() {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      this.appGoneSince.clear();
      log.info("[ProcessMonitor] stopped");
    }
    async tick() {
      try {
        const status = await detectDesktopApps();
        if (!status) return;
        const sessions = this.opts.getSessions();
        if (sessions.length === 0) return;
        let changed = false;
        changed = this.reconcileDesktopApps(sessions, status) || changed;
        if (changed) this.opts.onChanged();
      } catch (err) {
        log.error("[ProcessMonitor] tick error:", err);
      }
    }
    /**
     * 桌面 App 会话的存活协调。
     * 使用 appGoneSince 记录首次检测到 App 消失的时间，
     * 超过 APP_EXIT_GRACE_MS 后清理会话。
     */
    reconcileDesktopApps(sessions, status) {
      if (!status) return false;
      let changed = false;
      const now = Date.now();
      for (const session of sessions) {
        if (session.isSessionEnded) continue;
        if (!isVisibleInIsland(session)) continue;
        if (this.isExplicitNonCodexAppCodexSession(session)) continue;
        if (this.isExplicitNonOpenCodeAppOpenCodeSession(session)) continue;
        const appAlive = this.isDesktopAppAlive(session, status);
        if (appAlive === void 0) continue;
        if (appAlive) {
          if (this.appGoneSince.has(session.id)) {
            this.appGoneSince.delete(session.id);
          }
          if (!session.isProcessAlive) {
            this.opts.updateSession(session.id, { isProcessAlive: true });
            changed = true;
          }
        } else {
          if (!this.appGoneSince.has(session.id)) {
            this.appGoneSince.set(session.id, now);
          }
          const elapsed = now - this.appGoneSince.get(session.id);
          if (elapsed >= APP_EXIT_GRACE_MS) {
            log.info("[ProcessMonitor] app exited (%dms) → cleaning session %s (%s)", elapsed, session.id, session.tool);
            this.appGoneSince.delete(session.id);
            this.opts.updateSession(session.id, {
              isSessionEnded: true,
              phase: "completed",
              completionDismissed: true,
              jumpTarget: void 0
            });
            changed = true;
          }
        }
      }
      return changed;
    }
    isExplicitNonCodexAppCodexSession(session) {
      if (session.tool !== "codex") return false;
      const app = session.jumpTarget?.app?.trim().toLowerCase();
      return !!app && app !== "codex";
    }
    isExplicitNonOpenCodeAppOpenCodeSession(session) {
      if (session.tool !== "opencode") return false;
      const app = session.jumpTarget?.app?.trim().toLowerCase();
      return !!app && app !== "opencode";
    }
    /**
     * 判断桌面 App 会话对应的 App 是否运行中。
     * 返回 undefined 表示该会话不是桌面 App 会话。
     */
    isDesktopAppAlive(session, status) {
      if (session.tool === "cursor") return status.isCursorRunning;
      if (session.tool === "claude" && session.jumpTarget?.app?.toLowerCase() === "claude" && !session.jumpTarget?.tty) {
        return status.isClaudeDesktopAppRunning;
      }
      if (session.tool === "codex" && session.jumpTarget?.app?.toLowerCase() === "codex" && !session.jumpTarget?.tty) {
        return status.isCodexDesktopAppRunning;
      }
      if (session.tool === "opencode" && session.jumpTarget?.app?.toLowerCase() === "opencode" && !session.jumpTarget?.tty) {
        return status.isOpenCodeRunning;
      }
      if (session.tool === "trae") {
        return status.isTraeRunning;
      }
      return void 0;
    }
  }

  return ProcessMonitor;
}

module.exports = { createProcessMonitorClass, parseWindowsTasklist };
