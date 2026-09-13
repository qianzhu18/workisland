"use strict";

/**
 * 千问办公（Qoder CLI / QwenWorkCN 桌面版）触发通道：transcript 文件观测。
 *
 * 背景（2026-09-13 实测定案）：hook 已正确写入 ~/.qoder/settings.json，但
 * QwenWorkCN 内嵌会话以 `--settings <应用托管文件>` 调起 qoderclicn，实测
 * 不执行用户级 hooks（用户开会话时 WorkIsland 零事件）。而每个 Qoder 会话
 * 必然落盘 transcript：
 *   ~/.qoder/projects/<项目目录>/transcript/<sessionId>.session.execution.jsonl
 * 首行 session_meta 携带 sessionId 与 cwd（无内容字段）。因此与 dumate-watcher
 * 同款观测：新 transcript 出现 = 会话开始；文件闲置 = 会话结束（150s，先例
 * Codex 180s 兜底）。observe-only：transcript 正文（prompt/进度）不进事件。
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCAN_INTERVAL_MS = 20 * 1000;
const IDLE_COMPLETE_MS = 150 * 1000;
const HEAD_PARSE_LIMIT = 16 * 1024;

function getQoderProjectsRoot(homeDir = os.homedir()) {
  return path.join(homeDir, ".qoder", "projects");
}

function listTranscriptDirs(homeDir = os.homedir()) {
  const root = getQoderProjectsRoot(homeDir);
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const transcriptDir = path.join(root, entry.name, "transcript");
    if (fs.existsSync(transcriptDir)) dirs.push(transcriptDir);
  }
  return dirs.sort();
}

/** 从 transcript 头部取首行 session_meta 的 cwd 与 sessionId（元数据，非内容）。 */
function parseMetaFromHead(headText) {
  let cwd = "";
  let sessionId = "";
  for (const line of headText.split("\n")) {
    if (!line.includes("session_meta")) continue;
    try {
      const meta = JSON.parse(line);
      if (typeof meta.cwd === "string") cwd = meta.cwd;
      if (typeof meta.sessionId === "string") sessionId = meta.sessionId;
    } catch {
      // 头部行损坏时按无元数据处理
    }
    break;
  }
  return { cwd, sessionId };
}

function shortCode(sessionId) {
  return sessionId.replace(/^task-/, "").replace(/\.session.*$/, "").slice(-6);
}

function createQoderWatcher({
  homeDir = os.homedir(),
  logger = { info() {}, debug() {}, warn() {}, error() {} },
  onEvent = () => {},
  scanIntervalMs = SCAN_INTERVAL_MS,
  idleCompleteMs = IDLE_COMPLETE_MS,
  now = Date.now
} = {}) {
  let timer = null;
  // transcriptId → { filePath, projectPath, lastMtimeMs, completed }
  const sessions = /* @__PURE__ */ new Map();

  function emit(type, sessionId, projectPath) {
    onEvent({
      type,
      sessionId: `qoder-${sessionId}`,
      tool: "qoder",
      timestamp: now(),
      title: `Qoder · ${shortCode(sessionId)}`,
      projectPath: projectPath || "",
      detectionSource: "qoder-transcript"
    });
  }

  function scan() {
    const currentTime = now();
    for (const transcriptDir of listTranscriptDirs(homeDir)) {
      let files;
      try {
        files = fs.readdirSync(transcriptDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
        const transcriptId = file.name.replace(/\.jsonl$/, "").replace(/\.session\.execution$/, "");
        if (!transcriptId || sessions.has(transcriptId)) continue;
        const filePath = path.join(transcriptDir, file.name);
        let stat;
        try {
          stat = fs.statSync(filePath);
        } catch {
          continue;
        }
        let projectPath = "";
        let metaId = "";
        try {
          const fd = fs.openSync(filePath, "r");
          const buffer = Buffer.alloc(HEAD_PARSE_LIMIT);
          const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
          fs.closeSync(fd);
          ({ cwd: projectPath, sessionId: metaId } = parseMetaFromHead(buffer.toString("utf8", 0, bytes)));
        } catch {
          // 读头失败不阻塞会话出现
        }
        const sessionId = metaId || transcriptId;
        const alreadyIdle = currentTime - stat.mtimeMs >= idleCompleteMs;
        sessions.set(transcriptId, {
          filePath,
          sessionId,
          projectPath,
          lastMtimeMs: stat.mtimeMs,
          completed: alreadyIdle
        });
        if (alreadyIdle) {
          logger.debug?.("[QoderWatcher]", `historical transcript archived silently: ${transcriptId}`);
        } else {
          emit("sessionStarted", sessionId, projectPath);
          logger.info?.("[QoderWatcher]", `session started: ${sessionId} (${projectPath || "unknown dir"})`);
        }
      }
    }

    for (const [, session] of sessions) {
      if (session.completed) continue;
      let mtimeMs = session.lastMtimeMs;
      try {
        mtimeMs = fs.statSync(session.filePath).mtimeMs;
        session.lastMtimeMs = mtimeMs;
      } catch {
        // transcript 被清理也视为结束
      }
      if (currentTime - mtimeMs >= idleCompleteMs) {
        session.completed = true;
        emit("sessionCompleted", session.sessionId, session.projectPath);
        logger.info?.("[QoderWatcher]", "session idle-complete");
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
    sessionCount() {
      return sessions.size;
    }
  };
}

module.exports = {
  createQoderWatcher,
  getQoderProjectsRoot,
  listTranscriptDirs,
  parseMetaFromHead,
  SCAN_INTERVAL_MS,
  IDLE_COMPLETE_MS
};
