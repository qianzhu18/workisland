"use strict";

/**
 * DuMate（百度搭子）触发通道 v1：沙箱日志观测。
 *
 * 背景（2026-09-13 实测定案）：dumate-opencode 定制构建不自动加载 config/opencode/plugin
 * 目录（探测实验证实），插件路线对该构建不可靠。改用 WorkIsland 已验证的被动观测
 * 模式（同 Codex transcript watcher）：每个 DuMate 会话在
 *   ~/Library/Application Support/qianfan-desktop-app/qianfan_desk_xdg/<账号>/data/logs/sandbox/ses_*.log
 * 留下生命周期日志——新文件出现 = 会话开始；文件闲置 = 会话结束（阈值判定，
 * 先例：Codex 180s 闲置兜底）。只读取 sessionId / directory= 两个无内容字段，
 * 日志正文（命令、消息分片）一律不进任何下游对象（observe-only，对齐 ADR-0005 D3）。
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DUATE_DATA_ROOT_SEGMENTS = ["Library", "Application Support", "qianfan-desktop-app", "qianfan_desk_xdg"];
const SCAN_INTERVAL_MS = 20 * 1000;
const IDLE_COMPLETE_MS = 150 * 1000;
const HEAD_PARSE_LIMIT = 80;

function getQianfanXdgRoot(homeDir = os.homedir()) {
  return path.join(homeDir, ...DUATE_DATA_ROOT_SEGMENTS);
}

function listAccountSandboxDirs(homeDir = os.homedir()) {
  const root = getQianfanXdgRoot(homeDir);
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sandboxDir = path.join(root, entry.name, "data", "logs", "sandbox");
    if (fs.existsSync(sandboxDir)) dirs.push(sandboxDir);
  }
  return dirs.sort();
}

/** 从日志头部解析 directory=<项目路径>；只取这一个字段。 */
function parseProjectDirFromHead(headText) {
  for (const line of headText.split("\n")) {
    const match = line.match(/directory=(\S+)/);
    if (match) return match[1];
  }
  return "";
}

function shortSessionCode(sessionId) {
  return sessionId.replace(/^ses_/, "").slice(-6);
}

function createDuMateWatcher({
  homeDir = os.homedir(),
  logger = { info() {}, debug() {}, warn() {}, error() {} },
  onEvent = () => {},
  scanIntervalMs = SCAN_INTERVAL_MS,
  idleCompleteMs = IDLE_COMPLETE_MS,
  now = Date.now
} = {}) {
  let timer = null;
  // sessionId → { logPath, projectPath, lastMtimeMs, started, completed }
  const sessions = /* @__PURE__ */ new Map();

  function emit(type, sessionId, projectPath) {
    onEvent({
      type,
      sessionId: `dumate-${sessionId}`,
      tool: "dumate",
      timestamp: now(),
      // 合成标题与项目路径；沙箱日志正文（命令/消息分片）不进入事件
      title: `DuMate · ${shortSessionCode(sessionId)}`,
      projectPath: projectPath || "",
      detectionSource: "dumate-sandbox-log"
    });
  }

  function scan() {
    for (const sandboxDir of listAccountSandboxDirs(homeDir)) {
      let files;
      try {
        files = fs.readdirSync(sandboxDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.isFile() || !file.name.startsWith("ses_") || !file.name.endsWith(".log")) continue;
        const sessionId = file.name.slice(4, -4);
        if (!sessionId || sessions.has(sessionId)) continue;
        const logPath = path.join(sandboxDir, file.name);
        let stat;
        try {
          stat = fs.statSync(logPath);
        } catch {
          continue;
        }
        let projectPath = "";
        try {
          const fd = fs.openSync(logPath, "r");
          const buffer = Buffer.alloc(16 * 1024);
          const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
          fs.closeSync(fd);
          projectPath = parseProjectDirFromHead(buffer.toString("utf8", 0, bytes));
        } catch {
          // 读头失败不阻塞会话出现
        }
        sessions.set(sessionId, {
          logPath,
          projectPath,
          lastMtimeMs: stat.mtimeMs,
          started: true,
          completed: false
        });
        emit("sessionStarted", sessionId, projectPath);
        logger.info?.("[DuMateWatcher]", `session started: ${sessionId} (${projectPath || "unknown dir"})`);
      }
    }

    const currentTime = now();
    for (const [sessionId, session] of sessions) {
      if (session.completed) continue;
      let mtimeMs = session.lastMtimeMs;
      try {
        mtimeMs = fs.statSync(session.logPath).mtimeMs;
        session.lastMtimeMs = mtimeMs;
      } catch {
        // 日志文件被清理也视为结束
      }
      if (currentTime - mtimeMs >= idleCompleteMs) {
        session.completed = true;
        emit("sessionCompleted", sessionId, session.projectPath);
        logger.info?.("[DuMateWatcher]", `session idle-complete: ${sessionId}`);
      }
    }
  }

  return {
    start() {
      if (timer) return;
      scan();
      timer = setInterval(() => scan(), scanIntervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      sessions.clear();
    },
    scan,
    hasSession(sessionId) {
      return sessions.has(sessionId);
    },
    sessionCount() {
      return sessions.size;
    }
  };
}

module.exports = {
  createDuMateWatcher,
  getQianfanXdgRoot,
  listAccountSandboxDirs,
  parseProjectDirFromHead,
  SCAN_INTERVAL_MS,
  IDLE_COMPLETE_MS
};
