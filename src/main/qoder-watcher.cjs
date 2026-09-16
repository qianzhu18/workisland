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
const { execFile } = require("node:child_process");

const SCAN_INTERVAL_MS = 20 * 1000;
const IDLE_COMPLETE_MS = 150 * 1000;
const HEAD_PARSE_LIMIT = 16 * 1024;

function getQoderProjectsRoot(homeDir = os.homedir()) {
  return path.join(homeDir, ".qoder", "projects");
}

/**
 * QwenWorkCN 桌面版的真实会话库（2026-09-16 实测：其内嵌会话不写
 * ~/.qoder/projects，统一落在这里的 chats 表）。
 */
function getQwenWorkChatsDb(homeDir = os.homedir()) {
  return path.join(homeDir, "Library", "Application Support", "QwenWorkCN", "data", "agents.db");
}

const QWC_CHATS_SQL = [
  "SELECT id, REPLACE(REPLACE(name, char(124), '/'), char(10), ' '),",
  "       REPLACE(worktree_path, char(124), '/'),",
  "       created_at, updated_at",
  "FROM chats ORDER BY updated_at DESC"
].join(" ");

function defaultRunSqliteQuery(dbPath, sql) {
  return new Promise((resolve) => {
    execFile("sqlite3", [dbPath, sql], { timeout: 5000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? null : String(stdout ?? ""));
    });
  });
}

function parseRows(stdout, columnCount) {
  const rows = [];
  for (const line of String(stdout ?? "").split("\n")) {
    if (!line) continue;
    const fields = line.split("|");
    if (fields.length < columnCount) continue;
    rows.push([...fields.slice(0, columnCount - 1), fields.slice(columnCount - 1).join("|")]);
  }
  return rows;
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
  now = Date.now,
  runSqliteQuery = defaultRunSqliteQuery
} = {}) {
  let timer = null;
  // transcriptId → { filePath, projectPath, lastMtimeMs, completed }
  const sessions = /* @__PURE__ */ new Map();
  // QwenWorkCN chats：chatId → { sessionId, projectPath, updatedAt, completed }
  const qwcChats = /* @__PURE__ */ new Map();
  let qwcBusy = false;

  function emit(type, sessionId, projectPath, titleOverride) {
    onEvent({
      type,
      sessionId: `qoder-${sessionId}`,
      tool: "qoder",
      timestamp: now(),
      title: titleOverride ? `Qoder · ${titleOverride}` : `Qoder · ${shortCode(sessionId)}`,
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

    void scanQwenWorkChats(currentTime);
  }

  /**
   * QwenWorkCN chats 表扫描：新 chat 或 updated_at 刷新 → running；
   * updated_at 闲置 → completed。表很小（每轮全量），顺带完成删除对账。
   */
  async function scanQwenWorkChats(currentTime) {
    const dbPath = getQwenWorkChatsDb(homeDir);
    if (!fs.existsSync(dbPath) || qwcBusy) return;
    qwcBusy = true;
    try {
      const stdout = await runSqliteQuery(dbPath, QWC_CHATS_SQL);
      if (stdout === null) return;
      const rows = parseRows(stdout, 5);
      const liveKeys = new Set();
      for (const [id, name, worktreePath, createdAt, updatedAt] of rows) {
        if (!id) continue;
        liveKeys.add(id);
        const updatedAtMs = (Number(updatedAt) || Number(createdAt) || 0) * 1000;
        const prev = qwcChats.get(id);
        if (!prev) {
          const alreadyIdle = currentTime - updatedAtMs >= idleCompleteMs;
          qwcChats.set(id, { sessionId: `qwc-${id}`, projectPath: worktreePath || "", updatedAt: updatedAtMs, completed: alreadyIdle });
          if (!alreadyIdle) {
            emit("sessionStarted", `qwc-${id}`, worktreePath || "", name || "");
            logger.info?.("[QoderWatcher]", `qwenworkcn chat started: ${id}`);
          } else {
            logger.debug?.("[QoderWatcher]", `qwenworkcn historical chat archived: ${id}`);
          }
        } else if (updatedAtMs > prev.updatedAt) {
          prev.updatedAt = updatedAtMs;
          prev.completed = false;
          prev.projectPath = worktreePath || prev.projectPath;
        }
      }
      for (const [key, chat] of qwcChats) {
        if (!liveKeys.has(key)) {
          qwcChats.delete(key);
          continue;
        }
        if (!chat.completed && currentTime - chat.updatedAt >= idleCompleteMs) {
          chat.completed = true;
          emit("sessionCompleted", chat.sessionId, chat.projectPath);
          logger.info?.("[QoderWatcher]", `qwenworkcn chat idle-complete: ${key}`);
        }
      }
    } finally {
      qwcBusy = false;
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
  getQwenWorkChatsDb,
  listTranscriptDirs,
  parseMetaFromHead,
  SCAN_INTERVAL_MS,
  IDLE_COMPLETE_MS
};
