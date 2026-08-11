"use strict";

const fs = require("node:fs");
const path = require("node:path");
const log = require("electron-log");

class HookPayloadRecorder {
  config;
  sessionDir = null;
  constructor(config) {
    this.config = config;
    if (config.enabled) {
      this.sessionDir = this.initSessionDir();
    }
  }
  /**
   * Record a hook payload.
   * Safe to call regardless of enabled state.
   */
  record(source, payload) {
    if (!this.config.enabled || !this.sessionDir) return;
    try {
      const record = { source, payload };
      this.appendRecord(source, record);
    } catch (err) {
      console.warn("[HookPayloadRecorder] failed to record:", err.message);
    }
  }
  /**
   * Initialize session directory: __tests__/hook-payloads/${timestamp}/
   * Returns null if initialization fails.
   */
  initSessionDir() {
    try {
      const sessionDir = path.join(this.config.outputDir, String(this.config.startupTime));
      fs.mkdirSync(sessionDir, { recursive: true });
      log.debug(`[HookPayloadRecorder] initialized at ${sessionDir}`);
      return sessionDir;
    } catch (err) {
      console.warn("[HookPayloadRecorder] failed to initialize:", err.message);
      return null;
    }
  }
  /**
   * Append record to file.
   * Handles both single-file and per-source modes.
   */
  appendRecord(source, record) {
    if (!this.sessionDir) return;
    const filePath = this.config.groupBySource ? path.join(this.sessionDir, `${source}.json`) : path.join(this.sessionDir, "hook-payloads.json");
    let data;
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        data = JSON.parse(content);
        if (!Array.isArray(data)) {
          data = [];
        }
      } catch {
        data = [];
      }
    } else {
      data = [];
    }
    if (this.config.groupBySource) {
      data.push(record.payload);
    } else {
      data.push(record);
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }
}
function createHookPayloadRecorder() {
  const isDevMode = process.env.NODE_ENV === "development";
  const isDisabled = process.env.DISABLE_HOOK_RECORDING === "1";
  if (!isDevMode || isDisabled) {
    return null;
  }
  const groupBySource = process.env.HOOK_PAYLOADS_GROUP_BY_SOURCE === "1";
  return new HookPayloadRecorder({
    enabled: true,
    outputDir: path.join(process.cwd(), "__tests__", "hook-payloads"),
    groupBySource,
    startupTime: Date.now()
  });
}
function readFileTail(filePath, maxBytes) {
  if (!filePath) return null;
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }
  if (stat.size <= 0) {
    return { data: Buffer.alloc(0), truncated: false, totalSize: 0 };
  }
  const readLength = Math.min(stat.size, maxBytes);
  const startOffset = stat.size - readLength;
  const truncated = startOffset > 0;
  let buf;
  let fd = -1;
  try {
    fd = fs.openSync(filePath, "r");
    buf = Buffer.alloc(readLength);
    fs.readSync(fd, buf, 0, readLength, startOffset);
  } catch (err) {
    log.warn("[JsonlTailReader] readFileTail failed, path:", filePath, "err:", err.message);
    return null;
  } finally {
    if (fd >= 0) {
      try {
        fs.closeSync(fd);
      } catch {
      }
    }
  }
  return { data: buf, truncated, totalSize: stat.size };
}
function splitJsonlLines(data) {
  const text = typeof data === "string" ? data : data.toString("utf8");
  const lastNewlineIdx = text.lastIndexOf("\n");
  if (lastNewlineIdx < 0) {
    return { lines: [], trailingFragment: text };
  }
  const completedSection = text.slice(0, lastNewlineIdx);
  const trailingFragment = text.slice(lastNewlineIdx + 1);
  const lines = completedSection.length === 0 ? [] : completedSection.split("\n");
  return { lines, trailingFragment };
}
function readJsonlTailObjects(filePath, maxBytes) {
  const tail = readFileTail(filePath, maxBytes);
  if (!tail) return null;
  const { lines } = splitJsonlLines(tail.data);
  const startIdx = tail.truncated ? 1 : 0;
  const result = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      result.push(obj);
    }
  }
  return result;
}
const ATTACH_RETRY_INTERVAL_MS = 250;
const ATTACH_RETRY_MAX_ATTEMPTS = 24;
class ClaudeTranscriptWatcher {
  watches = /* @__PURE__ */ new Map();
  pendingRetries = /* @__PURE__ */ new Map();
  onInterruptDetected;
  onCompletionDetected;
  /** 记录每个 session 已经发射过完成的 turnId/offset，避免同一 turn 重复发完成 */
  lastCompletionOffset = /* @__PURE__ */ new Map();
  /**
   * 构造器支持两种调用形式（向后兼容）：
   *   new ClaudeTranscriptWatcher(onInterruptDetected)              // 老用法
   *   new ClaudeTranscriptWatcher({ onInterruptDetected, onCompletionDetected })  // 新用法
   */
  constructor(arg) {
    if (typeof arg === "function") {
      this.onInterruptDetected = arg;
      this.onCompletionDetected = null;
    } else if (arg && typeof arg === "object") {
      this.onInterruptDetected = arg.onInterruptDetected || null;
      this.onCompletionDetected = arg.onCompletionDetected || null;
    } else {
      this.onInterruptDetected = null;
      this.onCompletionDetected = null;
    }
  }
  /**
   * 开始监听某会话的 transcript。
   * 幂等：同一 (sessionId, path) 重复调用直接返回；path 变了则先 detach 再 attach。
   * 通常在 ClaudeAdapter 收到 UserPromptSubmit 时调用。
   *
   * 文件不存在时不立刻放弃，进入 ENOENT 重试模式（详见 ATTACH_RETRY_* 注释）。
   */
  attach(sessionId, transcriptPath) {
    if (!transcriptPath) return;
    const existing = this.watches.get(sessionId);
    if (existing) {
      if (existing.path === transcriptPath) return;
      this.detach(sessionId);
    }
    const pending = this.pendingRetries.get(sessionId);
    if (pending) {
      if (pending.path === transcriptPath) return;
      this.cancelRetry(sessionId);
    }
    this.tryAttach(sessionId, transcriptPath, 0);
  }
  /**
   * 单次 attach 尝试。fs.watch 因 ENOENT 失败时按 ATTACH_RETRY_INTERVAL_MS 轮询重试，
   * 直到文件出现或 attempt 用尽。其它错误（EACCES 等）直接放弃。
   */
  tryAttach(sessionId, transcriptPath, attempt) {
    let initialOffset = 0;
    try {
      initialOffset = fs.statSync(transcriptPath).size;
    } catch {
      initialOffset = 0;
    }
    const isFreshFileFromRetry = attempt > 0;
    if (isFreshFileFromRetry) initialOffset = 0;
    let fsWatcher;
    try {
      fsWatcher = fs.watch(transcriptPath, { persistent: false }, () => {
        this.handleChange(sessionId);
      });
    } catch (err) {
      const code = err.code;
      if (code === "ENOENT" && attempt + 1 < ATTACH_RETRY_MAX_ATTEMPTS) {
        const handle = setTimeout(() => {
          const stillPending = this.pendingRetries.get(sessionId);
          if (!stillPending || stillPending.path !== transcriptPath) return;
          this.pendingRetries.delete(sessionId);
          this.tryAttach(sessionId, transcriptPath, attempt + 1);
        }, ATTACH_RETRY_INTERVAL_MS);
        if (typeof handle.unref === "function") handle.unref();
        this.pendingRetries.set(sessionId, { handle, path: transcriptPath });
        return;
      }
      log.warn(
        "[ClaudeTranscriptWatcher] fs.watch failed, sessionId:",
        sessionId,
        "path:",
        transcriptPath,
        "err:",
        err.message,
        "attempts:",
        attempt + 1
      );
      return;
    }
    fsWatcher.on("error", (err) => {
      log.warn("[ClaudeTranscriptWatcher] watcher error, sessionId:", sessionId, "err:", err.message);
      this.detach(sessionId);
    });
    this.watches.set(sessionId, {
      path: transcriptPath,
      fsWatcher,
      lastOffset: initialOffset,
      partialLine: ""
    });
    if (isFreshFileFromRetry) {
      this.handleChange(sessionId);
    }
  }
  /** 取消正在进行的 ENOENT 重试（detach 时统一清理）。 */
  cancelRetry(sessionId) {
    const pending = this.pendingRetries.get(sessionId);
    if (!pending) return;
    clearTimeout(pending.handle);
    this.pendingRetries.delete(sessionId);
  }
  /**
   * 停止监听某会话。
   * 通常在 ClaudeAdapter 收到 Stop / StopFailure / SessionEnd 时调用，
   * 以及命中 marker 之后由内部自动调用。
   */
  detach(sessionId) {
    this.cancelRetry(sessionId);
    const entry = this.watches.get(sessionId);
    if (!entry) return;
    try {
      entry.fsWatcher.close();
    } catch {
    }
    this.watches.delete(sessionId);
    this.lastCompletionOffset.delete(sessionId);
  }
  /** BridgeServer.stop() 时统一清理，避免 fd 泄漏 / 定时器残留。 */
  detachAll() {
    for (const sessionId of Array.from(this.pendingRetries.keys())) {
      this.cancelRetry(sessionId);
    }
    for (const sessionId of Array.from(this.watches.keys())) {
      this.detach(sessionId);
    }
  }
  /** 仅供测试 / 诊断使用，返回当前监听中的会话数。 */
  get activeCount() {
    return this.watches.size;
  }
  /**
   * 文件变化时：读取 lastOffset → 当前 EOF 的增量字节，按行扫描 marker。
   * 任一新行命中 marker 即触发回调，回调内部会从 watches 中删除条目避免重复触发。
   */
  handleChange(sessionId) {
    const entry = this.watches.get(sessionId);
    if (!entry) return;
    let stat;
    try {
      stat = fs.statSync(entry.path);
    } catch {
      this.detach(sessionId);
      return;
    }
    if (stat.size < entry.lastOffset) {
      entry.lastOffset = 0;
      entry.partialLine = "";
    }
    if (stat.size === entry.lastOffset) return;
    const length = stat.size - entry.lastOffset;
    let buf;
    let fd = -1;
    try {
      fd = fs.openSync(entry.path, "r");
      buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, entry.lastOffset);
    } catch (err) {
      log.warn(
        "[ClaudeTranscriptWatcher] read failed, sessionId:",
        sessionId,
        "err:",
        err.message
      );
      return;
    } finally {
      if (fd >= 0) {
        try {
          fs.closeSync(fd);
        } catch {
        }
      }
    }
    entry.lastOffset = stat.size;
    const combined = entry.partialLine + buf.toString("utf8");
    const { lines, trailingFragment } = splitJsonlLines(combined);
    entry.partialLine = trailingFragment;
    for (const line of lines) {
      if (isInterruptMarkerLine(line)) {
        log.info("[ClaudeTranscriptWatcher] interrupt marker detected, sessionId:", sessionId);
        this.detach(sessionId);
        this.onInterruptDetected && this.onInterruptDetected(sessionId);
        return;
      }
      // 成功完成检测：assistant 消息块带 stop_reason:"end_turn" / "stop_sequence"
      // 关键：这是 hook 之外的第二完成通道，让没装 hook 的 Claude 也能被监控到。
      // 同一 turn 可能有多条 assistant 消息（流式分块），但 stop_reason 只在最后一条
      // 出现，且每个 turn 只发一次完成。用 lastCompletionOffset 记录已发射的 offset，
      // 避免对同一 turn 重复发完成事件。
      if (this.onCompletionDetected) {
        const completion = parseAssistantCompletionLine(line);
        if (completion) {
          const fired = this.lastCompletionOffset.get(sessionId);
          // 简单去重：同一行不重复发（按 offset > lastFired 判断需要更复杂的状态，
          // 这里用 message.id 去重更可靠）
          const messageId = completion.messageId;
          const dedupKey = messageId
            ? `${sessionId}:${messageId}`
            : `${sessionId}:${entry.lastOffset}`;
          if (fired !== dedupKey) {
            this.lastCompletionOffset.set(sessionId, dedupKey);
            log.info(
              "[ClaudeTranscriptWatcher] completion detected, sessionId:",
              sessionId
            );
            this.onCompletionDetected(sessionId, completion);
          }
        }
      }
    }
  }
}
const INTERRUPT_MARKER_PREFIX = "[Request interrupted by user";
function isInterruptMarkerText(text) {
  if (!text.startsWith(INTERRUPT_MARKER_PREFIX)) return false;
  if (!text.endsWith("]")) return false;
  return true;
}
function isInterruptMarkerLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (!trimmed.includes(INTERRUPT_MARKER_PREFIX)) return false;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object") return false;
  const obj = parsed;
  if (obj.type !== "user") return false;
  const message = obj.message;
  if (!message || typeof message !== "object") return false;
  const content = message.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === "object") {
        const b = block;
        if (b.type === "text" && typeof b.text === "string" && isInterruptMarkerText(b.text)) {
          return true;
        }
      }
    }
    return false;
  }
  if (typeof content === "string") {
    return isInterruptMarkerText(content);
  }
  return false;
}
/**
 * 检测 Claude transcript 行是否为"助手 turn 成功完成"信号。
 *
 * Claude Code 的 transcript 格式：每行一个 JSON，type:"assistant" 的 record 里
 * message.stop_reason 在 turn 正常结束时为 "end_turn"（也可能是 "stop_sequence"
 * 表示命中停止词，"tool_use" 表示要调工具——后者不算完成）。
 *
 * 返回 null 表示不是完成信号；否则返回 { summary, lastAssistantMessage, messageId }。
 * 注意：一个 turn 可能有多个 type:"assistant" 的流式分块，但只有最后一条带 stop_reason，
 * 所以同一 turn 只会命中一次。
 */
function parseAssistantCompletionLine(line) {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.type !== "assistant") return null;
  const message = parsed.message;
  if (!message || typeof message !== "object") return null;
  const stopReason = message.stop_reason;
  // end_turn = 正常完成；stop_sequence = 命中停止词（也算完成）
  // tool_use = 要调工具（不算完成，继续跑）；null/undefined = 还在流式输出
  if (stopReason !== "end_turn" && stopReason !== "stop_sequence") return null;
  const messageId = typeof message.id === "string" ? message.id : void 0;
  const content = message.content;
  let lastText = "";
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === "object" && block.type === "text" && typeof block.text === "string") {
        lastText = block.text;
      }
    }
  } else if (typeof content === "string") {
    lastText = content;
  }
  const summary = lastText ? lastText.slice(0, 140) : "";
  return {
    summary,
    lastAssistantMessage: lastText || void 0,
    messageId
  };
}
module.exports = {
  HookPayloadRecorder,
  createHookPayloadRecorder,
  readJsonlTailObjects,
  ClaudeTranscriptWatcher,
  isInterruptMarkerLine,
  parseAssistantCompletionLine
};
