"use strict";

/**
 * Codex transcript watcher —— 独立于 hook 的任务完成检测通道。
 *
 * 背景：orca 原本只能通过 Codex 的 Stop hook 检测任务完成。一旦用户没装 hook
 * 或 Codex 不发 Stop（中断、桌面版异常退出），灵动岛永远停留在 running。
 *
 * 本 watcher 主动 tail ~/.codex/sessions/yyyy/mm/dd/rollout-*.jsonl，解析
 * payload.type，提取 task_started / task_complete / turn_aborted / error 等
 * 事件，转成 orca 标准事件（与 CodexAdapter 产出格式一致）通过 EventEmitter
 * 推给 AppCoordinator，复用现有 emitEvent → agentEvent → apply 管线。
 *
 * 设计来源：参考 stow 的 codex-watcher.ts，clean-room 复刻为纯 JS。
 * 与 hook 通道的去重由 agent-event-dedup.cjs + AppCoordinator 协同完成。
 *
 * 重要约束：
 *   - 启动时只回读 tail 重建状态，不发历史完成通知（避免重启轰炸）
 *   - 子 agent 会话（thread_source === 'subagent'）不发 root 完成事件
 *   - 所有产出事件带 detectionSource: 'codex-transcript'，供去重识别
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { EventEmitter } = require("events");

const CODEX_SESSIONS_DIR = path.join(os.homedir(), ".codex", "sessions");
const SCAN_INTERVAL_MS = 2000;
const LOOKBACK_MS = 24 * 60 * 60 * 1000;
const BOOTSTRAP_TAIL_BYTES = 64 * 1024;
const MAX_TITLE_LEN = 60;
const MAX_SUMMARY_LEN = 140;
// Codex Desktop 会给复制的用户消息加 attachment 元信息头，需要剥掉
const CODEX_REQUEST_HEADING = /^#{1,6}\s*My request for Codex:\s*$/im;

/**
 * @typedef {Object} TrackedFile
 * @property {string} path
 * @property {string} sessionId
 * @property {number} startedAt
 * @property {number} lastReadSize
 * @property {number} lastEventAt
 * @property {string} title
 * @property {string=} cwd
 * @property {number=} lastTotalTokens
 * @property {string=} lastPrompt
 * @property {string=} lastResponse
 * @property {string=} originator
 * @property {unknown=} source
 * @property {boolean=} isSubagent
 * @property {string=} model
 * @property {boolean} turnRunning        最近一次 turn 是否还在跑
 * @property {string=} activeTurnId
 * @property {boolean} lastTurnCompleted
 */

class CodexTranscriptWatcher extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, TrackedFile>} */
    this.files = new Map();
    /** @type {ReturnType<typeof setInterval> | null} */
    this.timer = null;
    this.running = false;
    this.bootstrapped = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    try {
      this.scan(true);
    } catch (error) {
      this.emit("watcher-error", error);
    }
    this.timer = setInterval(() => {
      try {
        this.scan(false);
      } catch (error) {
        this.emit("watcher-error", error);
      }
    }, SCAN_INTERVAL_MS);
    const tracked = this.listTracked();
    console.log(
      `[codex-transcript-watcher] started, watching ${CODEX_SESSIONS_DIR}, ${tracked.length} active session(s)`
    );
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  /** 按 session id 查 rollout transcript 路径；未跟踪返回 null。 */
  getTranscriptPath(sessionId) {
    return this.files.get(sessionId)?.path ?? null;
  }

  listTracked() {
    return Array.from(this.files.values());
  }

  health() {
    return {
      running: this.running,
      trackedFiles: this.files.size,
      transcriptPath: CODEX_SESSIONS_DIR
    };
  }

  /**
   * 供 AppCoordinator.startReconciliation 调用：对 state 中不存在的新 session
   * 合成 sessionStarted 事件，让没装 hook 的机器也能在灵动岛看到 session。
   *
   * 重要：只注册"当前活跃"的 session（turnRunning === true），不注册历史已完成的。
   * 否则会把 24h 内所有历史会话都塞进 state，既不可见（无 latestUserPrompt）又会
   * 被 removeInvisibleSessions 删掉，导致 discover → prune → discover 死循环。
   */
  discoverActiveSessions(knownSessionIds) {
    const known = new Set(knownSessionIds || []);
    const discovered = [];
    for (const f of this.files.values()) {
      if (known.has(f.sessionId)) continue;
      // 只补登记当前正在跑的 root turn；历史已完成的不该出现在灵动岛
      if (!f.turnRunning || f.isSubagent) continue;
      discovered.push(
        this.buildEvent(f, "sessionStarted", {
          ts: f.lastEventAt || f.startedAt,
          title: f.title,
          summary: f.lastPrompt,
          latestUserPrompt: f.lastPrompt
        })
      );
    }
    return discovered;
  }

  // ── 内部实现 ──────────────────────────────────────────────────────────

  scan(initial) {
    const discovered = this.discover();
    for (const f of discovered) {
      const existing = this.files.get(f.sessionId);
      if (existing) {
        this.readIncrement(existing);
      } else {
        this.files.set(f.sessionId, f);
        if (initial) {
          // 启动阶段：回读 tail 建立状态，但不发 session_start（避免历史会话刷屏）
          this.readTail(f);
        } else {
          // 运行中发现新文件：真·新会话，立即发 sessionStarted
          this.emit(
            "event",
            this.buildEvent(f, "sessionStarted", {
              ts: f.startedAt,
              title: f.title,
              summary: f.lastPrompt,
              latestUserPrompt: f.lastPrompt
            })
          );
          this.readIncrement(f);
        }
      }
    }
    this.bootstrapped = true;
  }

  discover() {
    const cutoff = Date.now() - LOOKBACK_MS;
    /** @type {TrackedFile[]} */
    const out = [];
    const stack = [CODEX_SESSIONS_DIR];
    while (stack.length > 0) {
      const dir = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          stack.push(full);
        } else if (
          e.isFile() &&
          e.name.startsWith("rollout-") &&
          e.name.endsWith(".jsonl")
        ) {
          let stat;
          try {
            stat = fs.statSync(full);
          } catch {
            continue;
          }
          // 只看 24 小时内的文件，避免扫描历史
          if (stat.mtimeMs < cutoff) continue;
          out.push({
            path: full,
            sessionId: this.extractSessionId(e.name),
            startedAt: stat.birthtimeMs || stat.mtimeMs,
            lastReadSize: 0,
            lastEventAt: stat.mtimeMs,
            title: "Codex 会话",
            turnRunning: false,
            lastTurnCompleted: false
          });
        }
      }
    }
    return out;
  }

  extractSessionId(filename) {
    // rollout-2026-07-19T15-00-27-019f792d-1d9c-7ac2-b7f2-2141d2fd1b27.jsonl
    const m = filename.match(
      /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/
    );
    return m ? m[1] : filename.replace(/\.jsonl$/, "");
  }

  readIncrement(file) {
    let stat;
    try {
      stat = fs.statSync(file.path);
    } catch {
      return;
    }
    if (stat.size === file.lastReadSize) return;
    if (stat.size < file.lastReadSize) {
      // 文件被截断（兜底）
      file.lastReadSize = 0;
    }
    const fd = fs.openSync(file.path, "r");
    try {
      const len = stat.size - file.lastReadSize;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, file.lastReadSize);
      file.lastReadSize = stat.size;
      const text = buf.toString("utf8");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (!line.startsWith("{")) continue;
        this.processLine(file, line);
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  readTail(file) {
    let stat;
    try {
      stat = fs.statSync(file.path);
    } catch {
      return;
    }
    const chunkSize = Math.min(stat.size, BOOTSTRAP_TAIL_BYTES);
    const fd = fs.openSync(file.path, "r");
    try {
      // 先读头部第一条 record，拿到 session_meta / 标题
      const headSize = Math.min(stat.size, 32 * 1024);
      const head = Buffer.alloc(headSize);
      fs.readSync(fd, head, 0, headSize, 0);
      const headText = head.toString("utf8");
      const firstLine = headText
        .split("\n")
        .find((l) => l.trim().startsWith("{"));
      if (firstLine) this.processLine(file, firstLine, false);

      const buf = Buffer.alloc(chunkSize);
      fs.readSync(fd, buf, 0, chunkSize, stat.size - chunkSize);
      file.lastReadSize = stat.size;
      const text = buf.toString("utf8");
      const lines = text.split("\n").filter((l) => l.trim().startsWith("{"));
      for (const line of lines) {
        this.processLine(file, line, false);
      }
      // 启动只恢复 transcript 明确显示仍在执行的根会话；绝不重放历史完成通知。
      // 不再用“最近 5 分钟”限制：长时间运行但暂时没有新输出的 turn 也必须在
      // WorkIsland 重启后恢复，否则用户会丢失正在进行的任务。
      if (file.turnRunning && !file.isSubagent) {
        this.emit(
          "event",
          this.buildEvent(file, "sessionStarted", {
            ts: file.lastEventAt,
            title: file.title,
            summary: file.lastPrompt,
            latestUserPrompt: file.lastPrompt,
            replayed: true
          })
        );
      }
      // 注意：lastTurnCompleted 的历史完成不发通知，避免重启轰炸
    } finally {
      fs.closeSync(fd);
    }
  }

  processLine(file, line, shouldEmit = true) {
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      return;
    }
    const ts = evt.timestamp ? new Date(evt.timestamp).getTime() : Date.now();
    file.lastEventAt = ts;
    const payload = evt.payload;
    if (!payload || typeof payload !== "object") return;

    const self = this;
    const emit = (event) => {
      if (shouldEmit && !file.isSubagent) self.emit("event", event);
    };

    // —— 提取 user prompt 作为 title ——
    if (
      evt.type === "response_item" &&
      payload.type === "message" &&
      payload.role === "user"
    ) {
      const contents = Array.isArray(payload.content) ? payload.content : [];
      for (const c of contents) {
        if (c && c.type === "input_text" && typeof c.text === "string") {
          const text = extractCodexPrompt(c.text);
          if (text && !text.startsWith("<") && text.length >= 4) {
            file.title = text.slice(0, MAX_TITLE_LEN);
            file.lastPrompt = text.slice(0, MAX_SUMMARY_LEN);
            break;
          }
        }
      }
      return;
    }

    // —— session_meta（cwd / thread_source / originator 等） ——
    if (evt.type === "session_meta") {
      if (typeof payload.cwd === "string") file.cwd = payload.cwd;
      if (typeof payload.originator === "string")
        file.originator = payload.originator;
      file.source = payload.source;
      file.isSubagent =
        payload.thread_source === "subagent" ||
        Boolean(payload.source && payload.source.subagent);
      return;
    }

    if (evt.type === "turn_context") {
      if (typeof payload.cwd === "string") file.cwd = payload.cwd;
      if (typeof payload.model === "string") file.model = payload.model;
      return;
    }

    const payloadType = payload.type || "";

    switch (payloadType) {
      case "task_started":
      case "turn_started": {
        const nextTurnId =
          typeof payload.turn_id === "string" ? payload.turn_id : undefined;
        const isNewTurn =
          !file.turnRunning ||
          Boolean(
            nextTurnId && file.activeTurnId && file.activeTurnId !== nextTurnId
          );
        file.turnRunning = true;
        file.activeTurnId = nextTurnId || file.activeTurnId;
        file.lastTurnCompleted = false;
        if (isNewTurn) {
          emit(
            this.buildEvent(file, "turnStarted", {
              ts,
              turnId: nextTurnId,
              title: file.title
            })
          );
          // 首次进入 turn 时若 session 还未被灵动岛感知，补一个 sessionStarted
          emit(
            this.buildEvent(file, "sessionStarted", {
              ts,
              title: file.title,
              summary: file.lastPrompt,
              latestUserPrompt: file.lastPrompt
            })
          );
        }
        break;
      }

      case "user_message": {
        const message =
          typeof payload.message === "string"
            ? extractCodexPrompt(payload.message)
            : "";
        if (message && !message.startsWith("<")) {
          file.title = message.slice(0, MAX_TITLE_LEN);
          file.lastPrompt = message.slice(0, MAX_SUMMARY_LEN);
          // Codex Desktop 可能在 task_started 之前先写 user_message，把它当作
          // 新 turn 的起点（与 stow 行为一致）
          if (!file.turnRunning || file.lastTurnCompleted) {
            file.turnRunning = true;
            file.activeTurnId = undefined;
            file.lastTurnCompleted = false;
          }
          // 总是补发 sessionStarted 携带最新 prompt：即使 task_started 已经先发过，
          // 这里更新 prompt 让灵动岛 session 可见（isVisibleInIsland 需要 latestUserPrompt）。
          // sessionStarted 是幂等事件（reducer 用 ?? merge），重复发无副作用。
          emit(
            this.buildEvent(file, "sessionStarted", {
              ts,
              title: file.title,
              summary: file.lastPrompt,
              latestUserPrompt: file.lastPrompt
            })
          );
        }
        break;
      }

      case "token_count": {
        // 不发广播，避免噪音；仅更新 lastEventAt（token 统计走 quota 通道）
        const cumulative =
          payload.info &&
          payload.info.total_token_usage &&
          payload.info.total_token_usage.total_tokens;
        if (typeof cumulative === "number") {
          file.lastTotalTokens = cumulative;
        }
        break;
      }

      case "agent_message": {
        const msg =
          typeof payload.message === "string" ? payload.message : undefined;
        if (msg) {
          file.lastResponse = msg.slice(0, MAX_SUMMARY_LEN);
        }
        break;
      }

      case "agent_reasoning": {
        // 不发广播，避免噪音；只更新 lastEventAt
        break;
      }

      case "error": {
        if (!file.turnRunning) break;
        file.turnRunning = false;
        const errMsg = payload.message || payload.error || "Codex 报错";
        emit(
          this.buildEvent(file, "sessionCompleted", {
            ts,
            error: errMsg,
            isInterrupt: false
          })
        );
        break;
      }

      case "task_complete":
      case "turn_completed":
      case "task_completed":
      case "turn_aborted": {
        const completedTurnId =
          typeof payload.turn_id === "string" ? payload.turn_id : undefined;
        if (
          !file.turnRunning ||
          (file.activeTurnId &&
            completedTurnId &&
            file.activeTurnId !== completedTurnId)
        ) {
          break;
        }
        file.turnRunning = false;
        file.activeTurnId = undefined;
        file.lastTurnCompleted = true;
        const error = payload.error;
        const aborted = payloadType === "turn_aborted";
        const terminalMessage =
          typeof error === "string"
            ? error
            : error && typeof error.message === "string"
            ? error.message
            : aborted
            ? payload.reason === "interrupted"
              ? "任务已中止（用户主动停止）"
              : "任务已中止"
            : undefined;
        const lastMessage =
          typeof payload.last_agent_message === "string"
            ? payload.last_agent_message.slice(0, MAX_SUMMARY_LEN)
            : file.lastResponse;
        if (lastMessage) file.lastResponse = lastMessage;
        emit(
          this.buildEvent(file, "sessionCompleted", {
            ts,
            summary: lastMessage || terminalMessage || "任务完成",
            lastAssistantMessage: lastMessage,
            latestUserPrompt: file.lastPrompt,
            isInterrupt: aborted,
            // 标记为最终完成，供 session-state reducer 的 final 门控识别
            final: true,
            turnId: payload.turn_id
          })
        );
        break;
      }

      default:
        // 未识别的事件类型，静默跳过（避免噪音）
        break;
    }
  }

  /**
   * 构造 orca 标准事件（与 CodexAdapter 产出格式一致）。
   * 关键：所有事件带 detectionSource: 'codex-transcript'，供去重识别。
   */
  buildEvent(file, type, opts = {}) {
    /** @type {any} */
    const event = {
      type,
      sessionId: file.sessionId,
      tool: "codex",
      timestamp: opts.ts || Date.now(),
      detectionSource: "codex-transcript"
    };
    if (opts.title !== undefined) event.title = opts.title;
    if (opts.summary !== undefined) event.summary = opts.summary;
    if (opts.lastAssistantMessage !== undefined)
      event.lastAssistantMessage = opts.lastAssistantMessage;
    if (opts.latestUserPrompt !== undefined)
      event.latestUserPrompt = opts.latestUserPrompt;
    if (opts.isInterrupt !== undefined) event.isInterrupt = opts.isInterrupt;
    if (opts.error !== undefined) event.error = opts.error;
    if (opts.turnId !== undefined) event.turnId = opts.turnId;
    if (opts.final !== undefined) event.final = opts.final;
    if (opts.replayed !== undefined) event.replayed = opts.replayed;
    return event;
  }
}

/**
 * Codex Desktop 会给复制的用户消息加 attachment 元信息头，剥掉它。
 * Clean-room 复刻自 stow 的 extractCodexPrompt。
 */
function extractCodexPrompt(value) {
  let text = value.replace(/\r\n?/g, "\n").trim();
  const requestHeading = text.match(CODEX_REQUEST_HEADING);
  if (requestHeading && requestHeading.index !== undefined) {
    text = text.slice(requestHeading.index + requestHeading[0].length);
  }
  text = text
    .replace(/<image\b[^>]*>/gi, "")
    .replace(/<\/image\s*>/gi, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .split("\n")
    .filter((line) => !/^\s*#{2,6}\s+[^:\n]+:\s*\/.+\s*$/.test(line))
    .join("\n");
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_SUMMARY_LEN);
}

module.exports = { CodexTranscriptWatcher, CODEX_SESSIONS_DIR };
