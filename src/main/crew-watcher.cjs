"use strict";

/**
 * CrewAI 触发通道 v1：事件文件观测。
 *
 * 背景（2026-10-27 调研定案）：CrewAI（Crew CLI）没有本地 hooks 事件协议——
 * 它的 "hooks" 是 Python 代码级 API（@on / task_callback / step_callback），
 * webhook 是企业版 AMP 平台的云端回调，本地无法直接挂接。因此采用 WorkIsland
 * 已验证的被动观测模式（同 DuMate/Codex transcript watcher）：
 * 用户在自己的 crew 代码中接入 integrations/crewai/workisland_crew.py，
 * 该模块把任务开始/完成/整场完成事件 append 到
 *   ~/.flux/hooks/crew/events.jsonl
 * 本 watcher 增量轮询该文件（字节游标），只读取事件字段（crew 名、任务名、
 * cwd、失败标记），不读取任何任务正文或 LLM 输出（observe-only，对齐 ADR-0005 D3）。
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCAN_INTERVAL_MS = 10 * 1000;
const READ_CHUNK_BYTES = 64 * 1024;

function getCrewEventsRoot(homeDir = os.homedir()) {
  return path.join(homeDir, ".flux", "hooks", "crew");
}

function getCrewEventsFile(homeDir = os.homedir()) {
  return path.join(getCrewEventsRoot(homeDir), "events.jsonl");
}

function shortSessionCode(sessionId) {
  return String(sessionId || "").slice(-6);
}

/**
 * 从起始偏移读取一个文件，按行解析 JSON；返回 [parsedEvents, newOffset]。
 * 不完整尾行（正在 append 的半行）不解析，交给下一次扫描。
 */
function readEventsFrom(fd, statSize, startOffset) {
  const events = [];
  let offset = startOffset;
  while (offset < statSize) {
    const len = Math.min(READ_CHUNK_BYTES, statSize - offset);
    const buf = Buffer.alloc(len);
    const bytesRead = fs.readSync(fd, buf, 0, len, offset);
    if (bytesRead <= 0) break;
    const chunk = buf.subarray(0, bytesRead);
    let lineStart = 0;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] !== 10 /* \n */) continue;
      const line = chunk.subarray(lineStart, i).toString("utf8").trim();
      lineStart = i + 1;
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
          events.push(parsed);
        }
      } catch {
        // 半行或损坏行：跳过
      }
    }
    offset += bytesRead;
  }
  return [events, offset];
}

function createCrewWatcher({
  homeDir = os.homedir(),
  logger = { info() {}, debug() {}, warn() {}, error() {} },
  onEvent = () => {},
  scanIntervalMs = SCAN_INTERVAL_MS,
  now = Date.now
} = {}) {
  let timer = null;
  // 已消费字节游标。启动时（首个 scan）初始化为文件当前 size，历史事件不重放；
  // 只有 WorkIsland 运行期间新 append 的事件才会被播报。
  let cursor = -1;
  // 上次观测的 stat（ino + size）：文件被重建（ino 变化）或清空/截断（size 回退）
  // 时，从头部重新消费。events.jsonl 是 append-only 协议，重建/截断属于协议外
  // 异常；"截断后重写更长内容"且中途未被观测到的情况无法可靠区分，损坏行会被
  // 静默跳过、后续行继续消费。
  let lastStat = null;
  // sessionId → { title, projectPath }
  const sessions = /* @__PURE__ */ new Map();

  function emit(type, sessionId, extra = {}) {
    const record = sessions.get(sessionId);
    onEvent({
      type,
      sessionId: `crew-${sessionId}`,
      tool: "crew",
      timestamp: now(),
      title: record?.title || `CrewAI · ${shortSessionCode(sessionId)}`,
      projectPath: record?.projectPath || extra.cwd || "",
      detectionSource: "crew-events-file",
      ...extra
    });
  }

  function scan() {
    const filePath = getCrewEventsFile(homeDir);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return;
    }
    if (lastStat !== null && (stat.ino !== lastStat.ino || stat.size < lastStat.size)) {
      // 文件被重建或清空/截断：从头部重新消费。
      cursor = 0;
    }
    lastStat = { ino: stat.ino, size: stat.size };
    if (stat.size === cursor) return;

    let fd;
    try {
      fd = fs.openSync(filePath, "r");
    } catch {
      return;
    }
    let events = [];
    try {
      [events, cursor] = readEventsFrom(fd, stat.size, cursor);
    } catch (err) {
      logger.warn?.("[CrewWatcher]", "read failed:", err?.message ?? err);
      return;
    } finally {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }

    for (const event of events) {
      const sessionId = String(event.sessionId || "");
      if (!sessionId) continue;
      switch (event.type) {
        case "sessionStarted": {
          const title = event.crewName ? `Crew · ${event.crewName}` : `CrewAI · ${shortSessionCode(sessionId)}`;
          sessions.set(sessionId, {
            title,
            projectPath: typeof event.cwd === "string" ? event.cwd : ""
          });
          emit("sessionStarted", sessionId, {
            title,
            projectPath: event.cwd || ""
          });
          logger.info?.("[CrewWatcher]", `session started: ${sessionId} (${title})`);
          break;
        }
        case "taskCompleted": {
          const taskName = String(event.taskName || "");
          emit("activityUpdated", sessionId, {
            activity: taskName ? `任务完成：${taskName}` : "任务完成"
          });
          break;
        }
        case "sessionCompleted": {
          const failed = event.failed === true;
          emit("sessionCompleted", sessionId, {
            ...(failed ? { error: "crew 运行失败" } : {}),
            isInterrupt: false,
            isSessionEnd: true
          });
          sessions.delete(sessionId);
          logger.info?.("[CrewWatcher]", `session completed: ${sessionId}${failed ? " (failed)" : ""}`);
          break;
        }
        default:
          break;
      }
    }
  }

  /**
   * 游标初始化（仅一次）：
   * - 启动时事件文件已存在且有内容 → 游标 = 当前 size，历史不重放；
   * - 启动时文件尚不存在 → 游标 = 0，文件随后出现时从头增量消费，
   *   避免把 WorkIsland 开始监控后才写入的新事件误吞为"历史"。
   */
  function initializeCursor() {
    if (cursor !== -1) return;
    try {
      cursor = fs.statSync(getCrewEventsFile(homeDir)).size;
    } catch {
      cursor = 0;
    }
  }

  return {
    start() {
      if (timer) return;
      initializeCursor();
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
      cursor = -1;
      lastStat = null;
    },
    scan,
    hasSession(sessionId) {
      return sessions.has(String(sessionId).replace(/^crew-/, ""));
    },
    sessionCount() {
      return sessions.size;
    }
  };
}

module.exports = {
  createCrewWatcher,
  getCrewEventsRoot,
  getCrewEventsFile,
  readEventsFrom,
  SCAN_INTERVAL_MS
};
