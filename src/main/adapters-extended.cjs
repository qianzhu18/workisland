"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const child_process = require("node:child_process");
const promises = require("node:fs/promises");
const log = require("electron-log");
const fs__namespace = fs;
const path__namespace = path;
const { i18n } = require("./i18n.cjs");

function parseEventTimestamp(timestamp, fallback) {
  if (typeof timestamp !== "string") {
    return Date.now();
  }
  const parsed = Date.parse(timestamp);
  return isNaN(parsed) ? Date.now() : parsed;
}
async function parseGeminiTokens(transcriptPath) {
  let content;
  try {
    content = await promises.readFile(transcriptPath, "utf-8");
  } catch (err) {
    log.warn("[geminiTokens] readFile failed for %s:", transcriptPath, err);
    return null;
  }
  const lines = content.split("\n").filter(Boolean);
  log.info("[geminiTokens] 开始解析 %s: 共 %d 行", transcriptPath, lines.length);
  let lastInputTokens = 0;
  let lastOutputTokens = 0;
  let lastModel;
  let tokenLineCount = 0;
  for (const line of lines) {
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    if (!item.tokens) continue;
    const tokens = item.tokens;
    if (typeof tokens.input === "number") {
      lastInputTokens = tokens.input;
    }
    if (typeof tokens.output === "number") {
      lastOutputTokens = tokens.output;
    }
    tokenLineCount++;
    if (item.model) {
      lastModel = item.model;
    }
  }
  if (lastInputTokens === 0 && lastOutputTokens === 0) {
    log.info("[geminiTokens] 解析结果为空 %s: tokenLineCount=%d", transcriptPath, tokenLineCount);
    return null;
  }
  log.info(
    "[geminiTokens] 解析完成 %s: tokenLineCount=%d input=%d output=%d model=%s",
    transcriptPath,
    tokenLineCount,
    lastInputTokens,
    lastOutputTokens,
    lastModel ?? "unknown"
  );
  return {
    inputTokens: lastInputTokens,
    outputTokens: lastOutputTokens,
    // 使用 input + output 而非 Gemini 的 tokens.total，
    // 因为 total 包含 cached/thoughts 等类型，与其他 Adapter 口径不一致
    totalTokens: lastInputTokens + lastOutputTokens,
    model: lastModel,
    isEstimated: false
  };
}
const HERMES_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
function getHermesCumulativeTokens(sessionId) {
  if (!HERMES_SESSION_ID_PATTERN.test(sessionId)) {
    log.warn("[hermesTokens] sessionId 不符合白名单，跳过 SQLite fallback: %s", sessionId);
    return null;
  }
  const dbPath = path.join(os.homedir(), ".hermes", "state.db");
  if (!fs.existsSync(dbPath)) {
    log.info("[hermesTokens] DB 文件不存在: %s", dbPath);
    return null;
  }
  try {
    const result = child_process.execFileSync(
      "sqlite3",
      [
        dbPath,
        `SELECT input_tokens, output_tokens, model FROM sessions WHERE id = '${sessionId}' LIMIT 1`
      ],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 3e3 }
    ).trim();
    if (!result) {
      log.info("[hermesTokens] SQLite 查询无结果: sessionId=%s", sessionId);
      return null;
    }
    const [inputRaw, outputRaw, modelRaw] = result.split("|");
    const inputTokens = Number.parseInt(inputRaw ?? "", 10);
    const outputTokens = Number.parseInt(outputRaw ?? "", 10);
    if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null;
    if (inputTokens <= 0 && outputTokens <= 0) return null;
    log.info(
      "[hermesTokens] 累计快照: sessionId=%s input=%d output=%d model=%s",
      sessionId,
      inputTokens,
      outputTokens,
      modelRaw?.trim() || "unknown"
    );
    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      model: modelRaw?.trim() || void 0,
      isEstimated: false
    };
  } catch (err) {
    log.warn("[hermesTokens] sqlite3 query failed for sessionId=%s:", sessionId, err);
    return null;
  }
}
function diffHermesCumulativeTokens(cumulative, accounted) {
  const inputTokens = Math.max(0, cumulative.inputTokens - accounted.inputTokens);
  const outputTokens = Math.max(0, cumulative.outputTokens - accounted.outputTokens);
  log.info(
    "[hermesTokens] diff: 累计=(%d,%d) 已入账=(%d,%d) 增量=(%d,%d)",
    cumulative.inputTokens,
    cumulative.outputTokens,
    accounted.inputTokens,
    accounted.outputTokens,
    inputTokens,
    outputTokens
  );
  if (inputTokens === 0 && outputTokens === 0) return null;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    model: cumulative.model,
    isEstimated: false
  };
}
const { getStatsService } = require("./stats-service.cjs");
const lastReportedAt = /* @__PURE__ */ new Map();
const accountedTokens = /* @__PURE__ */ new Map();
function applyBaselineDiff(dedupeKey, cumulative) {
  let baseline = accountedTokens.get(dedupeKey);
  if (!baseline) {
    // 进程内没有基线时（重启后第一次采集），用统计服务里已入账的累计值兜底，
    // 否则整段会话的历史用量会被当成本轮增量再记一遍。
    const separator = dedupeKey.indexOf(":");
    const tool = separator >= 0 ? dedupeKey.slice(0, separator) : dedupeKey;
    const sessionId = separator >= 0 ? dedupeKey.slice(separator + 1) : "";
    baseline = getStatsService().getTokenTotals(tool, sessionId);
  }
  const deltaInput = Math.max(0, cumulative.inputTokens - baseline.input);
  const deltaOutput = Math.max(0, cumulative.outputTokens - baseline.output);
  const deltaCacheRead = Math.max(0, (cumulative.cacheReadTokens ?? 0) - (baseline.cacheRead ?? 0));
  const deltaCacheCreation = Math.max(0, (cumulative.cacheCreationTokens ?? 0) - (baseline.cacheCreation ?? 0));
  accountedTokens.set(dedupeKey, {
    input: cumulative.inputTokens,
    output: cumulative.outputTokens,
    cacheRead: cumulative.cacheReadTokens ?? 0,
    cacheCreation: cumulative.cacheCreationTokens ?? 0
  });
  if (deltaInput === 0 && deltaOutput === 0 && deltaCacheRead === 0 && deltaCacheCreation === 0) return null;
  return {
    inputTokens: deltaInput,
    outputTokens: deltaOutput,
    cacheReadTokens: deltaCacheRead,
    cacheCreationTokens: deltaCacheCreation,
    totalTokens: deltaInput + deltaOutput,
    model: cumulative.model,
    isEstimated: cumulative.isEstimated
  };
}
function reportTokenUsage(tool, sessionId, result, remote) {
  const hasCacheTokens = (result.cacheReadTokens ?? 0) > 0 || (result.cacheCreationTokens ?? 0) > 0;
  if (result.inputTokens === 0 && result.outputTokens === 0 && !hasCacheTokens) {
    log.info("[TokenCollector] 跳过：%s/%s 无有效 token 数据 result=%j", tool, sessionId, result);
    return;
  }
  const dedupeKey = `${tool}:${sessionId}`;
  const now = Date.now();
  const lastTs = lastReportedAt.get(dedupeKey);
  if (lastTs && now - lastTs < 3e3) {
    log.info("[TokenCollector] reportTokenUsage 跳过：3s 内已上报 %s", dedupeKey);
    return;
  }
  lastReportedAt.set(dedupeKey, now);
  const teaPayload = {
    tool,
    session_id: sessionId,
    model: result.model,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    cache_read_tokens: result.cacheReadTokens,
    cache_creation_tokens: result.cacheCreationTokens,
    total_tokens: result.totalTokens,
    is_estimated: result.isEstimated,
    is_remote: !!remote,
    remote_host: remote?.remoteHost
  };
  log.info(
    "[TokenCollector] 上报 %s/%s: input=%d output=%d total=%d cache_read=%d cache_creation=%d model=%s estimated=%s remote=%s | TEA payload=%j",
    tool,
    sessionId,
    result.inputTokens,
    result.outputTokens,
    result.totalTokens,
    result.cacheReadTokens,
    result.cacheCreationTokens,
    result.model ?? "unknown",
    result.isEstimated,
    remote?.remoteHost ?? "local",
    teaPayload
  );
  log.info(
    "[TokenCollector] 写入本地 StatsService: tool=%s sessionId=%s input=%d output=%d",
    tool,
    sessionId,
    result.inputTokens,
    result.outputTokens
  );
  getStatsService().recordToken(tool, sessionId, result.inputTokens, result.outputTokens, result.cacheReadTokens ?? 0, result.cacheCreationTokens ?? 0, remote);
}
/**
 * 从 Claude Code transcript 累加 token 用量。
 * 每条 assistant 消息带 message.usage（input/output/cache_read/cache_creation），
 * 全量累加得到会话累计值，交给 applyBaselineDiff 转成增量再入账。
 */
async function parseClaudeTokens(transcriptPath) {
  let content;
  try {
    content = await promises.readFile(transcriptPath, "utf-8");
  } catch (err) {
    log.warn("[claudeTokens] readFile failed for %s:", transcriptPath, err);
    return null;
  }
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheCreation = 0;
  let model;
  // 同一次请求可能因流式写入出现多条记录，按 requestId 去重。
  const seenRequestIds = new Set();
  for (const line of content.split("\n")) {
    if (!line) continue;
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    const u = item?.message?.usage;
    if (item?.type !== "assistant" || !u) continue;
    const requestId = item.requestId ?? item.message?.request_id ?? u.request_id;
    if (requestId) {
      if (seenRequestIds.has(requestId)) continue;
      seenRequestIds.add(requestId);
    }
    input += u.input_tokens ?? 0;
    output += u.output_tokens ?? 0;
    cacheRead += u.cache_read_input_tokens ?? 0;
    cacheCreation += u.cache_creation_input_tokens ?? 0;
    if (item.message.model) model = item.message.model;
  }
  if (input === 0 && output === 0) return null;
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: cacheCreation,
    totalTokens: input + output,
    model,
    isEstimated: false
  };
}
/**
 * 从 Codex rollout transcript 取 token 累计。
 * token_count 事件的 info.total_token_usage 是会话累计值，取最后一条即可；
 * input_tokens 含缓存部分，拆开与其他工具的口径对齐。
 */
async function parseCodexTokens(transcriptPath) {
  let content;
  try {
    content = await promises.readFile(transcriptPath, "utf-8");
  } catch (err) {
    log.warn("[codexTokens] readFile failed for %s:", transcriptPath, err);
    return null;
  }
  let usage = null;
  let model;
  for (const line of content.split("\n")) {
    if (!line) continue;
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    const p = item?.payload;
    if (!p) continue;
    if (p.type === "token_count" && p.info?.total_token_usage) usage = p.info.total_token_usage;
    if (p.type === "thread_settings_applied" && p.thread_settings?.model) model = p.thread_settings.model;
  }
  if (!usage) return null;
  const cached = usage.cached_input_tokens ?? 0;
  const input = Math.max(0, (usage.input_tokens ?? 0) - cached);
  const output = usage.output_tokens ?? 0;
  if (input === 0 && output === 0 && cached === 0) return null;
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cached,
    cacheCreationTokens: usage.cache_write_input_tokens ?? 0,
    totalTokens: input + output,
    model,
    isEstimated: false
  };
}
async function collectAndReportTokens(tool, sessionId, transcriptPath) {
  try {
    const dedupeKey = `${tool}:${sessionId}`;
    const now = Date.now();
    const lastTs = lastReportedAt.get(dedupeKey);
    if (lastTs && now - lastTs < 3e3) {
      log.info("[TokenCollector] 跳过：3s 内已上报 %s", dedupeKey);
      return;
    }
    await new Promise((r) => setImmediate(r));
    log.info("[TokenCollector] 开始采集 tool=%s sessionId=%s", tool, sessionId);
    let result = null;
    switch (tool) {
      case "gemini":
        if (!transcriptPath) {
          log.info("[TokenCollector] 跳过：gemini 缺少 transcriptPath");
          return;
        }
        result = await parseGeminiTokens(transcriptPath);
        if (result) result = applyBaselineDiff(dedupeKey, result);
        break;
      case "hermes":
        result = getHermesCumulativeTokens(sessionId);
        if (result) result = applyBaselineDiff(dedupeKey, result);
        break;
      case "claude":
        if (!transcriptPath) {
          log.info("[TokenCollector] 跳过：claude 缺少 transcriptPath");
          return;
        }
        result = await parseClaudeTokens(transcriptPath);
        if (result) result = applyBaselineDiff(dedupeKey, result);
        break;
      case "codex":
        if (!transcriptPath) {
          log.info("[TokenCollector] 跳过：codex 缺少 transcriptPath");
          return;
        }
        result = await parseCodexTokens(transcriptPath);
        if (result) result = applyBaselineDiff(dedupeKey, result);
        break;
    }
    if (!result) {
      log.info("[TokenCollector] 跳过：%s/%s collector 返回 null，无有效 token 数据", tool, sessionId);
      return;
    }
    reportTokenUsage(tool, sessionId, result);
    if (lastReportedAt.size > 500) lastReportedAt.clear();
    if (accountedTokens.size > 500) {
      const keys = [...accountedTokens.keys()];
      for (let i = 0; i < keys.length >> 1; i++) accountedTokens.delete(keys[i]);
    }
  } catch (err) {
    log.warn("[TokenCollector] collectAndReportTokens failed for %s/%s:", tool, sessionId, err);
  }
}
const ACK$4 = { type: "acknowledged" };
function asNonEmptyString(v) {
  if (typeof v !== "string") return void 0;
  const t = v.trim();
  return t ? t : void 0;
}
function summarizeGeminiToolUse(toolName, payload) {
  const raw = payload.tool_input;
  if (raw && typeof raw === "object") {
    const input = raw;
    const params = Object.entries(input).filter(([, v]) => v !== void 0 && v !== null && v !== "").map(([k, v]) => {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      const short = s.length > 60 ? s.slice(0, 57) + "..." : s;
      return `${k}: ${short}`;
    });
    if (params.length > 0) {
      const joined = params.join(", ");
      const maxLen = 120;
      const full = `${toolName}(${joined})`;
      return full.length > maxLen ? full.slice(0, maxLen - 3) + "..." : full;
    }
  }
  return `Using ${toolName}`;
}
function extractResponsePreview$1(raw) {
  if (typeof raw === "string") return raw.trim().slice(0, 80);
  if (raw && typeof raw === "object") {
    const obj = raw;
    const display = typeof obj.returnDisplay === "string" && obj.returnDisplay.trim() || typeof obj.llmContent === "string" && obj.llmContent.trim() || typeof obj.stdout === "string" && obj.stdout.trim() || "";
    return display.replace(/\n/g, " ").slice(0, 80);
  }
  return "";
}
function buildGeminiPermissionRequest(sessionId, toolName, toolInput) {
  return {
    id: crypto.randomUUID(),
    sessionId,
    toolName,
    toolInput,
    riskLevel: "high",
    approvalMode: "terminalNative"
  };
}
class GeminiAdapter {
  agentId = "gemini";
  /** 已知会话，用于 BeforeAgent 区分新旧会话 */
  knownSessions = /* @__PURE__ */ new Set();
  /** 最近用户 prompt，用于 sessionCompleted 时携带 latestUserPrompt */
  latestPromptBySession = /* @__PURE__ */ new Map();
  /** ask_user 的临时问题文本：由 BeforeTool 捕获，在 Notification 时展示，AfterTool 清空 */
  pendingQuestionBySession = /* @__PURE__ */ new Map();
  /** cwd 缓存：SessionStart 时缓存，供其他事件在缺少 cwd 字段时使用 */
  cachedCwdBySession = /* @__PURE__ */ new Map();
  /** transcriptPath 缓存：SessionStart 时缓存，用于 SessionEnd 时采集 token */
  transcriptPathBySession = /* @__PURE__ */ new Map();
  handleHook(clientId, payload, ctx) {
    const tool = this.agentId;
    const sessionId = payload.session_id;
    const now = parseEventTimestamp(payload.timestamp);
    switch (payload.hook_event_name) {
      case "SessionStart": {
        const source = payload.source;
        if (source === "compact" || source === "clear") {
          ctx.updateJumpTarget(sessionId, tool, {
            terminal_app: payload.terminal_app,
            terminal_tty: payload.terminal_tty,
            terminal_session_id: payload.terminal_session_id,
            warp_pane_uuid: payload.warp_pane_uuid,
            cwd: payload.cwd,
            pid: payload.pid
          });
          ctx.sendResponse(clientId, ACK$4);
          break;
        }
        const cwd = payload.cwd || "";
        const project = cwd ? path.basename(cwd) : "";
        const isNew = !this.knownSessions.has(sessionId);
        if (isNew) this.knownSessions.add(sessionId);
        if (cwd) {
          this.cachedCwdBySession.set(sessionId, cwd);
        }
        const transcriptPath = payload.transcript_path;
        if (transcriptPath) {
          this.transcriptPathBySession.set(sessionId, transcriptPath);
        }
        ctx.emitEvent({
          type: "sessionStarted",
          sessionId,
          tool,
          timestamp: now,
          title: project || "Gemini session",
          transcriptPath
        });
        ctx.updateJumpTarget(sessionId, tool, {
          terminal_app: payload.terminal_app,
          terminal_tty: payload.terminal_tty,
          terminal_session_id: payload.terminal_session_id,
          warp_pane_uuid: payload.warp_pane_uuid,
          cwd: payload.cwd,
          pid: payload.pid
        });
        ctx.sendResponse(clientId, ACK$4);
        break;
      }
      case "BeforeAgent": {
        const rawPrompt = payload.prompt || "";
        if (rawPrompt) this.latestPromptBySession.set(sessionId, rawPrompt);
        const isNew = !this.knownSessions.has(sessionId);
        if (isNew) this.knownSessions.add(sessionId);
        const cwd = payload.cwd || this.cachedCwdBySession.get(sessionId) || "";
        const project = cwd ? path.basename(cwd) : "";
        let title;
        if (isNew) {
          title = rawPrompt ? rawPrompt.slice(0, 60) : project || "Gemini session";
        }
        ctx.emitEvent({
          type: "sessionStarted",
          sessionId,
          tool,
          timestamp: now,
          title,
          summary: isNew ? rawPrompt?.slice(0, 120) : void 0
        });
        ctx.updateJumpTarget(sessionId, tool, {
          terminal_app: payload.terminal_app,
          terminal_tty: payload.terminal_tty,
          terminal_session_id: payload.terminal_session_id,
          warp_pane_uuid: payload.warp_pane_uuid,
          cwd: payload.cwd,
          pid: payload.pid
        });
        ctx.playSoundEvent("sessionStart");
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: "Thinking...",
          latestUserPrompt: rawPrompt?.slice(0, 120)
        });
        ctx.sendResponse(clientId, ACK$4);
        break;
      }
      case "BeforeTool": {
        if (!this.knownSessions.has(sessionId)) {
          this.knownSessions.add(sessionId);
          const cwd = payload.cwd || "";
          const project = cwd ? path.basename(cwd) : "";
          ctx.emitEvent({
            type: "sessionStarted",
            sessionId,
            tool,
            timestamp: now,
            title: project || "Gemini session"
          });
        }
        const toolName = payload.tool_name || "Tool";
        if (toolName === "ask_user") {
          const input = payload.tool_input;
          const questions = input?.questions;
          const first = Array.isArray(questions) ? questions[0] : void 0;
          const q = asNonEmptyString(first?.question) || asNonEmptyString(first?.header);
          if (q) this.pendingQuestionBySession.set(sessionId, q);
        }
        const activity = summarizeGeminiToolUse(toolName, payload);
        ctx.emitEvent({
          type: "toolUseStarted",
          sessionId,
          tool,
          timestamp: now,
          toolName,
          activity
        });
        ctx.sendResponse(clientId, ACK$4);
        break;
      }
      case "AfterTool": {
        const toolName = payload.tool_name || "Tool";
        ctx.clearStalePendingInteraction(sessionId);
        if (toolName === "ask_user") {
          this.pendingQuestionBySession.delete(sessionId);
        }
        const preview = extractResponsePreview$1(payload.tool_response);
        const activity = preview ? `${toolName}: ${preview}` : `${toolName} done`;
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity
        });
        ctx.sendResponse(clientId, ACK$4);
        break;
      }
      case "AfterAgent": {
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: ""
        });
        ctx.emitEvent({
          type: "sessionCompleted",
          sessionId,
          tool,
          timestamp: now,
          lastAssistantMessage: payload.prompt_response,
          latestUserPrompt: this.latestPromptBySession.get(sessionId),
          isInterrupt: payload.stop_hook_active,
          isSessionEnd: false
        });
        ctx.playSoundEvent("taskComplete");
        ctx.sendResponse(clientId, ACK$4);
        break;
      }
      case "SessionEnd": {
        ctx.clearStalePendingInteraction(sessionId);
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: ""
        });
        ctx.emitEvent({
          type: "sessionCompleted",
          sessionId,
          tool,
          timestamp: now,
          latestUserPrompt: this.latestPromptBySession.get(sessionId),
          isSessionEnd: true
        });
        const transcriptPath = this.transcriptPathBySession.get(sessionId);
        if (transcriptPath) {
          collectAndReportTokens("gemini", sessionId, transcriptPath);
        }
        this.knownSessions.delete(sessionId);
        this.latestPromptBySession.delete(sessionId);
        this.pendingQuestionBySession.delete(sessionId);
        this.cachedCwdBySession.delete(sessionId);
        this.transcriptPathBySession.delete(sessionId);
        ctx.sendResponse(clientId, ACK$4);
        break;
      }
      case "PreCompress": {
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: "Compacting conversation..."
        });
        ctx.sendResponse(clientId, ACK$4);
        break;
      }
      case "Notification": {
        const notificationType = payload.notification_type;
        if (notificationType === "ToolPermission") {
          const details = payload.details;
          const detailType = details?.type;
          if (detailType === "ask_user") {
            ctx.playSoundEvent("approvalNeeded");
            const question = this.pendingQuestionBySession.get(sessionId);
            ctx.emitEvent({
              type: "activityUpdated",
              sessionId,
              tool,
              timestamp: now,
              activity: question || i18n.k2249756269({}, "由于 Code Agent 限制，请在终端中回答问题")
            });
            ctx.emitEvent({
              type: "questionAsked",
              sessionId,
              tool,
              timestamp: now
            });
            ctx.sendResponse(clientId, ACK$4);
            ctx.setPendingQuestion(
              sessionId,
              clientId,
              tool,
              {
                disconnectPolicy: "preserveOnDisconnect"
              },
              payload
            );
            break;
          } else {
            const title = details?.title || "unknown";
            ctx.playSoundEvent("approvalNeeded");
            const permissionRequest = buildGeminiPermissionRequest(
              sessionId,
              title,
              `${i18n.k2393745408({ placeholder1: title }, "需要审批：{placeholder1}")}`
            );
            ctx.emitEvent({
              type: "permissionRequested",
              sessionId,
              tool,
              timestamp: now,
              permissionRequest,
              activity: permissionRequest.toolInput
            });
            ctx.sendResponse(clientId, ACK$4);
            ctx.setPendingPermission(
              sessionId,
              clientId,
              tool,
              {
                approvalMode: "terminalNative",
                disconnectPolicy: "preserveOnDisconnect",
                responseChannelClosedAt: Date.now()
              },
              payload
            );
            break;
          }
        } else {
          ctx.emitEvent({
            type: "activityUpdated",
            sessionId,
            tool,
            timestamp: now,
            activity: payload.message || notificationType || "Notification"
          });
        }
        ctx.sendResponse(clientId, ACK$4);
        break;
      }
      default:
        ctx.sendResponse(clientId, ACK$4);
    }
  }
  isBlockingEvent(_payload) {
    return false;
  }
}
const ACK$3 = { type: "acknowledged" };
const APPROVAL_SESSION_MATCH_WINDOW_MS = 10 * 60 * 1e3;
const MAX_RECENT_COMMAND_INVOCATIONS = 100;
const SUBAGENT_SPAWN_MATCH_WINDOW_MS = 15 * 1e3;
const SESSION_TRACKING_TTL_MS = 15 * 60 * 1e3;
const TRACKING_CLEANUP_INTERVAL = 64;
const EVENT_ALIASES = {
  "session:start": "on_session_start",
  "session:end": "on_session_end"
};
function readNestedObject(payload, key) {
  const value = payload[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function normalizeEventName(payload) {
  const raw = payload.hook_event_name ?? payload.event_type;
  if (typeof raw !== "string" || !raw.trim()) return void 0;
  const normalized = raw.trim().toLowerCase();
  return EVENT_ALIASES[normalized] ?? normalized;
}
function pickNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return void 0;
}
function pickSessionId(payload) {
  const extra = readNestedObject(payload, "extra");
  const extraSessionKey = typeof extra?.session_key === "string" && extra.session_key.trim() && extra.session_key !== "default" ? extra.session_key : void 0;
  return pickNonEmptyString(payload.session_id, payload.session_key, extra?.task_id, extraSessionKey);
}
function truncate$2(text, max = 120) {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}
function stringifyValue(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => stringifyValue(item)).filter(Boolean).join(", ");
  }
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return "";
}
function readFirstString(obj, keys) {
  for (const key of keys) {
    const text = stringifyValue(obj[key]);
    if (text) return text;
  }
  return void 0;
}
function resolveSessionTitle(payload) {
  const explicitTitle = readFirstString(payload, ["session_title", "title"]);
  if (explicitTitle) return explicitTitle;
  const cwd = typeof payload.cwd === "string" ? payload.cwd : "";
  if (cwd) return path.basename(cwd);
  const executionEnv = readFirstString(payload, ["terminal_app", "platform", "model"]);
  if (executionEnv) return executionEnv;
  return "Hermes session";
}
function extractUserMessage(payload) {
  if (typeof payload.user_message === "string" && payload.user_message.trim()) {
    return payload.user_message.trim();
  }
  const extra = readNestedObject(payload, "extra");
  if (extra && typeof extra.user_message === "string" && extra.user_message.trim()) {
    return extra.user_message.trim();
  }
  const toolInput = payload.tool_input;
  if (toolInput && typeof toolInput === "object") {
    return readFirstString(toolInput, ["user_message", "prompt", "message", "text"]);
  }
  return void 0;
}
function extractAssistantResponse(payload) {
  if (typeof payload.assistant_response === "string" && payload.assistant_response.trim()) {
    return payload.assistant_response.trim();
  }
  const extra = readNestedObject(payload, "extra");
  if (extra && typeof extra.assistant_response === "string" && extra.assistant_response.trim()) {
    return extra.assistant_response.trim();
  }
  const assistantResponse = payload.assistant_response;
  if (assistantResponse && typeof assistantResponse === "object") {
    const nested = readFirstString(
      assistantResponse,
      ["text", "message", "content", "output", "response"]
    );
    if (nested) return nested;
  }
  return readFirstString(payload, ["message", "summary", "response"]);
}
function readBoolean(payload, key) {
  const direct = payload[key];
  if (typeof direct === "boolean") return direct;
  const extra = readNestedObject(payload, "extra");
  const nested = extra?.[key];
  return typeof nested === "boolean" ? nested : void 0;
}
function summarizeToolInput$1(toolName, toolInput) {
  if (!toolInput) return `Using ${toolName}`;
  const params = Object.entries(toolInput).filter(([, value]) => value !== void 0 && value !== null && stringifyValue(value)).map(([key, value]) => `${key}: ${truncate$2(stringifyValue(value), 60)}`);
  if (params.length === 0) return `Using ${toolName}`;
  return truncate$2(`${toolName}(${params.join(", ")})`);
}
function extractToolResultPreview(payload) {
  const extra = readNestedObject(payload, "extra");
  const candidates = [
    payload.tool_result,
    payload.tool_output,
    payload.tool_response,
    payload.result,
    payload.output,
    extra?.result
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      const text = candidate.trim();
      if (text.startsWith("{") || text.startsWith("[")) {
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === "object") {
            const preview = readFirstString(
              parsed,
              ["stdout", "stderr", "output", "message", "result", "text", "error"]
            );
            if (preview) return truncate$2(preview.replace(/\s+/g, " "));
          }
        } catch {
        }
      }
      return truncate$2(text.replace(/\s+/g, " "));
    }
    if (candidate && typeof candidate === "object") {
      const preview = readFirstString(
        candidate,
        ["stdout", "stderr", "output", "message", "result", "text"]
      );
      if (preview) return truncate$2(preview.replace(/\s+/g, " "));
    }
  }
  return void 0;
}
function isClarifyTool(toolName) {
  const normalized = toolName.trim().toLowerCase();
  return normalized === "clarify" || normalized === "askuserquestions" || normalized === "ask_user_questions";
}
function toQuestionChoices(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    if (typeof item === "string") {
      return { id: `c${index}`, label: item };
    }
    if (item && typeof item === "object") {
      const label = readFirstString(item, ["label", "title", "text", "value"]);
      if (label) return { id: `c${index}`, label };
    }
    return null;
  }).filter((item) => !!item);
}
function readQuestionChoices(input) {
  return toQuestionChoices(input.options ?? input.choices);
}
function buildQuestionPrompt(payload, sessionId) {
  const toolInput = payload.tool_input;
  if (!toolInput || typeof toolInput !== "object") return null;
  const input = toolInput;
  if (Array.isArray(input.questions) && input.questions.length > 0) {
    const questions = input.questions.map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const question2 = readFirstString(item, ["question", "prompt", "message", "text"]);
      if (!question2) return null;
      return {
        id: `q${index}`,
        question: question2,
        type: item.multiSelect ? "multiple" : "single",
        choices: readQuestionChoices(item)
      };
    }).filter((item) => !!item);
    if (questions.length > 0) {
      return { id: crypto.randomUUID(), sessionId, questions };
    }
  }
  const question = readFirstString(input, ["question", "prompt", "message", "text", "query"]);
  if (!question) return null;
  return {
    id: crypto.randomUUID(),
    sessionId,
    questions: [
      {
        id: "q0",
        question,
        type: "single",
        choices: readQuestionChoices(input)
      }
    ]
  };
}
function buildPermissionRequest(sessionId, payload) {
  const extra = readNestedObject(payload, "extra");
  const toolName = readFirstString(payload, ["tool_name", "approval_target", "action"]) || "approval";
  const toolInput = readFirstString(payload, ["reason", "message", "description", "summary"]) || (extra ? readFirstString(extra, ["reason", "message", "description", "summary"]) : void 0) || (payload.tool_input && typeof payload.tool_input === "object" ? summarizeToolInput$1(toolName, payload.tool_input) : toolName);
  return {
    id: readFirstString(payload, ["approval_id", "tool_call_id"]) || (extra ? readFirstString(extra, ["approval_id", "tool_call_id"]) : void 0) || crypto.randomUUID(),
    sessionId,
    toolName,
    toolInput,
    riskLevel: "high",
    approvalMode: "terminalNative"
  };
}
function summarizeApprovalResponse(payload) {
  const extra = readNestedObject(payload, "extra");
  const decision = readFirstString(payload, ["decision", "result", "response", "status", "choice"]) || (extra ? readFirstString(extra, ["decision", "result", "response", "status", "choice"]) : void 0) || "completed";
  const detail = readFirstString(payload, ["message", "reason", "summary"]) || (extra ? readFirstString(extra, ["message", "reason", "summary"]) : void 0);
  return detail ? `Approval ${decision}: ${detail}` : `Approval ${decision}`;
}
function normalizeCommandText(command) {
  if (!command) return void 0;
  const normalized = command.replace(/\s+/g, " ").trim();
  return normalized || void 0;
}
function extractToolCommand(payload) {
  const toolInput = payload.tool_input;
  if (!toolInput || typeof toolInput !== "object") return void 0;
  return normalizeCommandText(readFirstString(toolInput, ["command"]));
}
function extractApprovalCommand(payload) {
  const extra = readNestedObject(payload, "extra");
  return normalizeCommandText(
    readFirstString(payload, ["command"]) || (extra ? readFirstString(extra, ["command"]) : void 0)
  );
}
function normalizeToolName(toolName) {
  if (!toolName) return void 0;
  const normalized = toolName.trim().toLowerCase();
  return normalized || void 0;
}
function isDelegateTaskTool(toolName) {
  const normalized = normalizeToolName(toolName);
  return normalized === "delegate_task" || normalized === "delegatetask";
}
function extractRuntimeContext(payload) {
  return {
    terminalSessionId: pickNonEmptyString(payload.terminal_session_id),
    terminalTty: pickNonEmptyString(payload.terminal_tty),
    pid: pickNonEmptyString(payload.pid),
    hostName: pickNonEmptyString(payload._hostname)
  };
}
function hasRuntimeFingerprint(context) {
  return !!(context.terminalSessionId || context.terminalTty || context.pid || context.hostName);
}
function hasMatchingRuntimeContext(left, right) {
  if (!left || !right) return false;
  if (left.terminalSessionId && right.terminalSessionId) {
    return left.terminalSessionId === right.terminalSessionId;
  }
  if (left.pid && right.pid && left.terminalTty && right.terminalTty) {
    return left.pid === right.pid && left.terminalTty === right.terminalTty;
  }
  if (left.pid && right.pid && left.hostName && right.hostName) {
    return left.pid === right.pid && left.hostName === right.hostName;
  }
  if (left.terminalTty && right.terminalTty && left.hostName && right.hostName) {
    return left.terminalTty === right.terminalTty && left.hostName === right.hostName;
  }
  if (left.pid && right.pid) {
    return left.pid === right.pid;
  }
  return false;
}
function readSubagentExtra(payload) {
  const extra = readNestedObject(payload, "extra");
  if (!extra) return null;
  return readFirstString(extra, ["child_role", "child_type", "child_summary", "child_status", "child_id"]) ? extra : null;
}
function extractParentSessionId(payload) {
  const extra = readNestedObject(payload, "extra");
  return pickNonEmptyString(
    readFirstString(payload, ["parent_session_id", "parent_id", "forked_from_id"]),
    extra ? readFirstString(extra, ["parent_session_id", "parent_id", "forked_from_id"]) : void 0
  );
}
function extractChildSessionId(payload) {
  const extra = readNestedObject(payload, "extra");
  return pickNonEmptyString(
    readFirstString(payload, ["child_session_id", "child_id"]),
    extra ? readFirstString(extra, ["child_session_id", "child_id"]) : void 0
  );
}
function extractSubagentId(payload) {
  const extra = readNestedObject(payload, "extra");
  return pickNonEmptyString(
    readFirstString(payload, ["agent_id", "child_session_id", "child_id"]),
    extra ? readFirstString(extra, ["agent_id", "child_session_id", "child_id"]) : void 0
  );
}
function hasSubagentExtraMetadata(payload) {
  return !!readSubagentExtra(payload);
}
function buildSubagentInfo(payload, now) {
  const subagentExtra = readSubagentExtra(payload);
  return {
    agentId: pickNonEmptyString(
      readFirstString(payload, ["child_session_id", "child_id", "agent_id"]),
      subagentExtra ? readFirstString(subagentExtra, ["child_session_id", "child_id", "agent_id", "child_id"]) : void 0
    ) || crypto.randomUUID(),
    agentType: pickNonEmptyString(
      readFirstString(payload, ["child_role", "child_type", "agent_type"]),
      subagentExtra ? readFirstString(subagentExtra, ["child_role", "child_type"]) : void 0
    ),
    taskDescription: pickNonEmptyString(
      readFirstString(payload, ["child_summary", "description", "task"]),
      subagentExtra ? readFirstString(subagentExtra, ["child_summary", "description", "task"]) : void 0
    ),
    startedAt: now
  };
}
class HermesAdapter {
  agentId = "hermes";
  knownSessions = /* @__PURE__ */ new Set();
  latestPromptBySession = /* @__PURE__ */ new Map();
  latestAssistantBySession = /* @__PURE__ */ new Map();
  lastActiveAtBySession = /* @__PURE__ */ new Map();
  recentCommandInvocations = [];
  approvalSessionByCommand = /* @__PURE__ */ new Map();
  subagentParentByChildSession = /* @__PURE__ */ new Map();
  sessionRuntimeBySession = /* @__PURE__ */ new Map();
  pendingSubagentLaunches = [];
  hookCallsSinceCleanup = 0;
  /**
   * 记录最近活跃的 session，给 Hermes 审批事件做“最近活跃 session”回退。
   */
  markSessionActive(sessionId, timestamp) {
    this.lastActiveAtBySession.set(sessionId, timestamp);
  }
  /**
   * 记录最近一次带 command 的工具调用。审批 hook 缺少 task_id 时，可借此把
   * `pre_approval_request/post_approval_response` 归并回正确会话。
   */
  rememberCommandInvocation(sessionId, command, timestamp) {
    this.recentCommandInvocations.push({ sessionId, command, timestamp });
    const cutoff = timestamp - APPROVAL_SESSION_MATCH_WINDOW_MS;
    while (this.recentCommandInvocations.length > 0) {
      const head = this.recentCommandInvocations[0];
      if (head.timestamp >= cutoff && this.recentCommandInvocations.length <= MAX_RECENT_COMMAND_INVOCATIONS) {
        break;
      }
      this.recentCommandInvocations.shift();
    }
  }
  /**
   * 按“命令优先，其次终端指纹唯一命中，最后最近活跃 session”解析 Hermes 审批事件归属。
   * 对 runtime 命中多个 session 的场景，宁可不归属也不把审批卡片误挂到错误会话。
   */
  resolveSessionId(payload, eventName, now) {
    const directSessionId = pickSessionId(payload);
    if (directSessionId) return directSessionId;
    if (eventName !== "pre_approval_request" && eventName !== "post_approval_response") {
      return void 0;
    }
    const command = extractApprovalCommand(payload);
    if (command) {
      const approvalMatch = this.approvalSessionByCommand.get(command);
      if (approvalMatch && now - approvalMatch.timestamp <= APPROVAL_SESSION_MATCH_WINDOW_MS) {
        return approvalMatch.sessionId;
      }
      for (let index = this.recentCommandInvocations.length - 1; index >= 0; index -= 1) {
        const candidate = this.recentCommandInvocations[index];
        if (candidate.command !== command) continue;
        if (now - candidate.timestamp > APPROVAL_SESSION_MATCH_WINDOW_MS) break;
        return candidate.sessionId;
      }
    }
    const runtimeMatches = this.collectRuntimeSessionMatches(payload, now, APPROVAL_SESSION_MATCH_WINDOW_MS);
    if (runtimeMatches.length === 1) {
      return runtimeMatches[0].sessionId;
    }
    if (runtimeMatches.length > 1) {
      return void 0;
    }
    let latestSessionId;
    let latestTimestamp = -1;
    for (const [sessionId, timestamp] of Array.from(this.lastActiveAtBySession.entries())) {
      if (now - timestamp > APPROVAL_SESSION_MATCH_WINDOW_MS) continue;
      if (timestamp > latestTimestamp) {
        latestTimestamp = timestamp;
        latestSessionId = sessionId;
      }
    }
    return latestSessionId;
  }
  /**
   * session 真正 finalize 后清理本地归并缓存，避免旧 session 持续参与审批匹配。
   */
  clearSessionTracking(sessionId) {
    this.latestPromptBySession.delete(sessionId);
    this.latestAssistantBySession.delete(sessionId);
    this.knownSessions.delete(sessionId);
    this.lastActiveAtBySession.delete(sessionId);
    for (let index = this.recentCommandInvocations.length - 1; index >= 0; index -= 1) {
      if (this.recentCommandInvocations[index].sessionId === sessionId) {
        this.recentCommandInvocations.splice(index, 1);
      }
    }
    for (const [command, cached] of Array.from(this.approvalSessionByCommand.entries())) {
      if (cached.sessionId === sessionId) {
        this.approvalSessionByCommand.delete(command);
      }
    }
    for (const [childSessionId, mapped] of Array.from(this.subagentParentByChildSession.entries())) {
      if (childSessionId === sessionId || mapped.parentSessionId === sessionId) {
        this.subagentParentByChildSession.delete(childSessionId);
      }
    }
    this.sessionRuntimeBySession.delete(sessionId);
    for (let index = this.pendingSubagentLaunches.length - 1; index >= 0; index -= 1) {
      if (this.pendingSubagentLaunches[index].parentSessionId === sessionId) {
        this.pendingSubagentLaunches.splice(index, 1);
      }
    }
  }
  /**
   * 以固定采样频率触发一次惰性清理，避免每个 hook 都全量扫描内部缓存。
   */
  maybeCleanupStaleTracking(now) {
    this.hookCallsSinceCleanup += 1;
    if (this.hookCallsSinceCleanup < TRACKING_CLEANUP_INTERVAL) return;
    this.hookCallsSinceCleanup = 0;
    this.cleanupExpiredSessionTracking(now);
    this.cleanupExpiredApprovalTracking(now);
    this.cleanupExpiredPendingLaunches(now);
  }
  /**
   * 按 session 最近活跃时间回收过期缓存，兜住异常退出未触发 finalize 的泄漏场景。
   */
  cleanupExpiredSessionTracking(now) {
    const staleCutoff = now - SESSION_TRACKING_TTL_MS;
    const staleSessionIds = /* @__PURE__ */ new Set();
    for (const [sessionId, timestamp] of this.lastActiveAtBySession.entries()) {
      if (timestamp < staleCutoff) {
        staleSessionIds.add(sessionId);
      }
    }
    for (const sessionId of this.knownSessions) {
      const lastActiveAt = this.lastActiveAtBySession.get(sessionId);
      if (!lastActiveAt || lastActiveAt < staleCutoff) {
        staleSessionIds.add(sessionId);
      }
    }
    for (const sessionId of this.latestPromptBySession.keys()) {
      const lastActiveAt = this.lastActiveAtBySession.get(sessionId);
      if (!lastActiveAt || lastActiveAt < staleCutoff) {
        staleSessionIds.add(sessionId);
      }
    }
    for (const sessionId of this.latestAssistantBySession.keys()) {
      const lastActiveAt = this.lastActiveAtBySession.get(sessionId);
      if (!lastActiveAt || lastActiveAt < staleCutoff) {
        staleSessionIds.add(sessionId);
      }
    }
    for (const sessionId of this.sessionRuntimeBySession.keys()) {
      const lastActiveAt = this.lastActiveAtBySession.get(sessionId);
      if (!lastActiveAt || lastActiveAt < staleCutoff) {
        staleSessionIds.add(sessionId);
      }
    }
    for (const [childSessionId, binding] of this.subagentParentByChildSession.entries()) {
      if (binding.timestamp < staleCutoff) {
        staleSessionIds.add(childSessionId);
      }
    }
    for (const sessionId of staleSessionIds) {
      this.clearSessionTracking(sessionId);
    }
  }
  /**
   * 清理审批匹配缓存，避免命令匹配数组与索引在长期空闲后持续堆积。
   */
  cleanupExpiredApprovalTracking(now) {
    const approvalCutoff = now - APPROVAL_SESSION_MATCH_WINDOW_MS;
    for (let index = this.recentCommandInvocations.length - 1; index >= 0; index -= 1) {
      if (this.recentCommandInvocations[index].timestamp < approvalCutoff) {
        this.recentCommandInvocations.splice(index, 1);
      }
    }
    for (const [command, cached] of this.approvalSessionByCommand.entries()) {
      if (cached.timestamp < approvalCutoff) {
        this.approvalSessionByCommand.delete(command);
      }
    }
  }
  /**
   * 清理未被消费的子 Agent 启动记录，防止异常链路下 pending 队列长期残留。
   */
  cleanupExpiredPendingLaunches(now) {
    const pendingCutoff = now - SUBAGENT_SPAWN_MATCH_WINDOW_MS;
    for (let index = this.pendingSubagentLaunches.length - 1; index >= 0; index -= 1) {
      if (this.pendingSubagentLaunches[index].timestamp < pendingCutoff) {
        this.pendingSubagentLaunches.splice(index, 1);
      }
    }
  }
  /**
   * 记录 session 的终端运行时信息，供空 session_id 的工具事件与后继新 session 做启发式关联。
   */
  rememberSessionRuntime(sessionId, payload) {
    const nextRuntime = extractRuntimeContext(payload);
    if (!hasRuntimeFingerprint(nextRuntime)) return;
    const previous = this.sessionRuntimeBySession.get(sessionId);
    this.sessionRuntimeBySession.set(sessionId, {
      terminalSessionId: pickNonEmptyString(nextRuntime.terminalSessionId, previous?.terminalSessionId),
      terminalTty: pickNonEmptyString(nextRuntime.terminalTty, previous?.terminalTty),
      pid: pickNonEmptyString(nextRuntime.pid, previous?.pid),
      hostName: pickNonEmptyString(nextRuntime.hostName, previous?.hostName)
    });
  }
  /**
   * 收集与当前 payload 终端指纹一致的 session 候选，供不同场景按各自策略决策。
   */
  collectRuntimeSessionMatches(payload, now, matchWindowMs) {
    const runtime = extractRuntimeContext(payload);
    if (!hasRuntimeFingerprint(runtime)) return [];
    const matches = /* @__PURE__ */ new Map();
    for (const [candidateSessionId, timestamp] of Array.from(this.lastActiveAtBySession.entries())) {
      if (now - timestamp > matchWindowMs) continue;
      const candidateRuntime = this.sessionRuntimeBySession.get(candidateSessionId);
      if (!hasMatchingRuntimeContext(runtime, candidateRuntime)) continue;
      const parentSessionId = this.subagentParentByChildSession.get(candidateSessionId)?.parentSessionId ?? candidateSessionId;
      const previous = matches.get(parentSessionId);
      if (!previous || timestamp > previous.timestamp) {
        matches.set(parentSessionId, { sessionId: parentSessionId, timestamp });
      }
    }
    return Array.from(matches.values()).sort((left, right) => right.timestamp - left.timestamp);
  }
  /**
   * 使用终端上下文为 Hermes 空 session_id 的工具调用回推最可能的父会话。
   */
  resolveSessionIdFromRuntime(payload, now) {
    return this.collectRuntimeSessionMatches(payload, now, SUBAGENT_SPAWN_MATCH_WINDOW_MS)[0]?.sessionId;
  }
  /**
   * 记录一次可能触发 Hermes 子会话启动的空 session 工具调用。
   */
  rememberPendingSubagentLaunch(parentSessionId, payload, now) {
    const toolName = readFirstString(payload, ["tool_name"]);
    if (!isDelegateTaskTool(toolName)) return;
    const runtime = extractRuntimeContext(payload);
    const toolInput = payload.tool_input && typeof payload.tool_input === "object" ? payload.tool_input : void 0;
    this.pendingSubagentLaunches.push({
      parentSessionId,
      timestamp: now,
      toolName,
      taskDescription: summarizeToolInput$1(toolName || "delegate_task", toolInput),
      ...runtime
    });
    const cutoff = now - SUBAGENT_SPAWN_MATCH_WINDOW_MS;
    for (let index = this.pendingSubagentLaunches.length - 1; index >= 0; index -= 1) {
      if (this.pendingSubagentLaunches[index].timestamp < cutoff) {
        this.pendingSubagentLaunches.splice(index, 1);
      }
    }
  }
  /**
   * 将后继新建的普通 Hermes session 反查到最近的 delegate_task 启动记录，从而归并成子 Agent。
   */
  consumePendingSubagentLaunch(payload, now) {
    const runtime = extractRuntimeContext(payload);
    if (!hasRuntimeFingerprint(runtime)) return void 0;
    for (let index = this.pendingSubagentLaunches.length - 1; index >= 0; index -= 1) {
      const candidate = this.pendingSubagentLaunches[index];
      if (now - candidate.timestamp > SUBAGENT_SPAWN_MATCH_WINDOW_MS) {
        this.pendingSubagentLaunches.splice(index, 1);
        continue;
      }
      if (!hasMatchingRuntimeContext(runtime, candidate)) continue;
      this.pendingSubagentLaunches.splice(index, 1);
      return candidate;
    }
    return void 0;
  }
  /**
   * 处理 Hermes 空 session_id 的工具调用，并缓存可能触发子会话启动的上下文。
   */
  handleAnonymousToolCall(payload, eventName, now) {
    const parentSessionId = this.resolveSessionIdFromRuntime(payload, now);
    if (eventName === "pre_tool_call" && parentSessionId) {
      this.rememberPendingSubagentLaunch(parentSessionId, payload, now);
    }
  }
  /**
   * 识别 Hermes 子 Agent 的事件流并归并到父会话，避免在岛上生成独立对话。
   */
  handleSubagentChildEvent(clientId, payload, eventName, now, tool, childSessionId, parentSessionId, ctx, options) {
    if (parentSessionId === childSessionId) return false;
    const mappedSubagentId = extractSubagentId(payload) || options?.fallbackInfo?.agentId || childSessionId;
    const existing = this.subagentParentByChildSession.get(childSessionId);
    const nextTaskDescription = pickNonEmptyString(
      readFirstString(payload, ["child_summary", "description", "task"]),
      options?.fallbackInfo?.taskDescription,
      existing?.taskDescription
    );
    const nextAgentType = pickNonEmptyString(
      readFirstString(payload, ["child_role", "child_type", "agent_type"]),
      options?.fallbackInfo?.agentType,
      existing?.agentType
    );
    this.subagentParentByChildSession.set(childSessionId, {
      parentSessionId,
      agentId: mappedSubagentId,
      timestamp: now,
      taskDescription: nextTaskDescription,
      agentType: nextAgentType
    });
    this.markSessionActive(parentSessionId, now);
    ctx.updateJumpTarget(parentSessionId, tool);
    if (!existing) {
      ctx.emitEvent({
        sessionId: parentSessionId,
        tool,
        timestamp: now,
        type: "subagentStarted",
        subAgentInfo: {
          agentId: mappedSubagentId,
          agentType: nextAgentType,
          taskDescription: nextTaskDescription,
          startedAt: now
        }
      });
    }
    if (eventName === "pre_tool_call") {
      const toolName = readFirstString(payload, ["tool_name"]) || "tool";
      const toolInput = payload.tool_input && typeof payload.tool_input === "object" ? payload.tool_input : void 0;
      ctx.emitEvent({
        sessionId: parentSessionId,
        tool,
        timestamp: now,
        type: "subagentToolActivity",
        subAgentId: mappedSubagentId,
        activity: summarizeToolInput$1(toolName, toolInput)
      });
    } else if (eventName === "post_tool_call") {
      const toolName = readFirstString(payload, ["tool_name"]) || "tool";
      const preview = extractToolResultPreview(payload);
      ctx.emitEvent({
        sessionId: parentSessionId,
        tool,
        timestamp: now,
        type: "subagentToolActivity",
        subAgentId: mappedSubagentId,
        activity: preview ? `${toolName}: ${preview}` : `${toolName} done`
      });
    } else if (eventName === "pre_llm_call") {
      ctx.emitEvent({
        sessionId: parentSessionId,
        tool,
        timestamp: now,
        type: "subagentToolActivity",
        subAgentId: mappedSubagentId,
        activity: "Thinking..."
      });
    } else if (eventName === "on_session_end") {
      ctx.clearStalePendingInteraction(parentSessionId);
      ctx.emitEvent({
        sessionId: parentSessionId,
        tool,
        timestamp: now,
        type: "subagentStopped",
        subAgentInfo: {
          agentId: mappedSubagentId,
          startedAt: now
        }
      });
      this.subagentParentByChildSession.delete(childSessionId);
    }
    ctx.sendResponse(clientId, ACK$3);
    return true;
  }
  handleHook(clientId, payload, ctx) {
    const now = Date.now();
    this.maybeCleanupStaleTracking(now);
    const eventName = normalizeEventName(payload);
    const sessionId = eventName ? this.resolveSessionId(payload, eventName, now) : void 0;
    if (!eventName || !sessionId) {
      if (eventName === "pre_tool_call" || eventName === "post_tool_call") {
        this.handleAnonymousToolCall(payload, eventName, now);
      }
      ctx.sendResponse(clientId, ACK$3);
      return;
    }
    this.rememberSessionRuntime(sessionId, payload);
    const tool = this.agentId;
    const directChildSessionId = extractChildSessionId(payload);
    const explicitParentSessionId = extractParentSessionId(payload);
    const mappedParentSessionId = this.subagentParentByChildSession.get(sessionId)?.parentSessionId;
    const parentSessionId = pickNonEmptyString(explicitParentSessionId, mappedParentSessionId);
    const childSessionId = directChildSessionId || (parentSessionId ? sessionId : void 0);
    const hasSubagentMetadata = hasSubagentExtraMetadata(payload);
    const subagentId = extractSubagentId(payload);
    const heuristicLaunch = !parentSessionId && !childSessionId && !subagentId && !hasSubagentMetadata && !this.knownSessions.has(sessionId) && (eventName === "on_session_start" || eventName === "pre_llm_call") ? this.consumePendingSubagentLaunch(payload, now) : void 0;
    if (heuristicLaunch && this.handleSubagentChildEvent(
      clientId,
      payload,
      eventName,
      now,
      tool,
      sessionId,
      heuristicLaunch.parentSessionId,
      ctx,
      {
        fallbackInfo: {
          agentId: sessionId,
          agentType: heuristicLaunch.toolName,
          taskDescription: heuristicLaunch.taskDescription
        }
      }
    )) {
      return;
    }
    if (childSessionId && parentSessionId && this.handleSubagentChildEvent(clientId, payload, eventName, now, tool, childSessionId, parentSessionId, ctx)) {
      return;
    }
    if ((subagentId || hasSubagentMetadata) && eventName !== "subagent_start" && eventName !== "subagent_stop") {
      ctx.sendResponse(clientId, ACK$3);
      return;
    }
    const remoteHost = typeof payload._hostname === "string" ? payload._hostname : void 0;
    const extra = readNestedObject(payload, "extra");
    const baseEvent = {
      sessionId,
      tool,
      timestamp: now,
      remoteHost
    };
    this.markSessionActive(sessionId, now);
    ctx.updateJumpTarget(sessionId, tool);
    switch (eventName) {
      case "on_session_start":
      case "on_session_reset": {
        this.knownSessions.add(sessionId);
        ctx.emitEvent({
          ...baseEvent,
          type: "sessionStarted",
          title: resolveSessionTitle(payload)
        });
        ctx.sendResponse(clientId, ACK$3);
        break;
      }
      case "pre_llm_call": {
        const prompt = extractUserMessage(payload) || "";
        if (prompt) this.latestPromptBySession.set(sessionId, prompt);
        this.knownSessions.add(sessionId);
        ctx.emitEvent({
          ...baseEvent,
          type: "sessionStarted",
          title: payload.is_first_turn ?? extra?.is_first_turn ? resolveSessionTitle(payload) : void 0,
          summary: prompt ? truncate$2(prompt) : void 0,
          latestUserPrompt: prompt || void 0
        });
        if (prompt) {
          ctx.playSoundEvent("sessionStart");
        }
        ctx.emitEvent({
          ...baseEvent,
          type: "activityUpdated",
          activity: "Thinking...",
          latestUserPrompt: prompt || void 0
        });
        ctx.sendResponse(clientId, ACK$3);
        break;
      }
      case "post_llm_call": {
        const prompt = extractUserMessage(payload) || this.latestPromptBySession.get(sessionId);
        const assistantResponse = extractAssistantResponse(payload);
        if (prompt) this.latestPromptBySession.set(sessionId, prompt);
        if (assistantResponse) this.latestAssistantBySession.set(sessionId, assistantResponse);
        ctx.emitEvent({
          ...baseEvent,
          type: "sessionCompleted",
          summary: assistantResponse ? truncate$2(assistantResponse) : void 0,
          lastAssistantMessage: assistantResponse,
          latestUserPrompt: prompt,
          isSessionEnd: false
        });
        ctx.playSoundEvent("taskComplete");
        ctx.sendResponse(clientId, ACK$3);
        break;
      }
      case "pre_tool_call": {
        const toolName = readFirstString(payload, ["tool_name"]) || "tool";
        const toolInput = payload.tool_input && typeof payload.tool_input === "object" ? payload.tool_input : void 0;
        const command = extractToolCommand(payload);
        if (command) {
          this.rememberCommandInvocation(sessionId, command, now);
        }
        this.rememberPendingSubagentLaunch(sessionId, payload, now);
        if (isClarifyTool(toolName)) {
          const questionPrompt = buildQuestionPrompt(payload, sessionId);
          if (questionPrompt) {
            ctx.playSoundEvent("approvalNeeded");
            ctx.emitEvent({
              ...baseEvent,
              type: "questionAsked",
              questionPrompt
            });
            ctx.sendResponse(clientId, ACK$3);
            ctx.setPendingQuestion(
              sessionId,
              clientId,
              tool,
              { disconnectPolicy: "preserveOnDisconnect" },
              payload
            );
            break;
          }
        }
        ctx.emitEvent({
          ...baseEvent,
          type: "toolUseStarted",
          toolName,
          activity: summarizeToolInput$1(toolName, toolInput)
        });
        ctx.sendResponse(clientId, ACK$3);
        break;
      }
      case "post_tool_call": {
        const toolName = readFirstString(payload, ["tool_name"]) || "tool";
        if (isClarifyTool(toolName)) {
          ctx.clearStalePendingInteraction(sessionId);
        }
        const preview = extractToolResultPreview(payload);
        ctx.emitEvent({
          ...baseEvent,
          type: "toolUseCompleted",
          toolName
        });
        ctx.emitEvent({
          ...baseEvent,
          type: "activityUpdated",
          activity: preview ? `${toolName}: ${preview}` : `${toolName} done`
        });
        ctx.sendResponse(clientId, ACK$3);
        break;
      }
      case "pre_approval_request": {
        const approvalCommand = extractApprovalCommand(payload);
        if (approvalCommand) {
          this.approvalSessionByCommand.set(approvalCommand, { sessionId, timestamp: now });
        }
        const permissionRequest = buildPermissionRequest(sessionId, payload);
        ctx.playSoundEvent("approvalNeeded");
        ctx.emitEvent({
          ...baseEvent,
          type: "permissionRequested",
          permissionRequest
        });
        ctx.sendResponse(clientId, ACK$3);
        ctx.setPendingPermission(sessionId, clientId, tool, {
          approvalMode: "terminalNative",
          disconnectPolicy: "preserveOnDisconnect",
          responseChannelClosedAt: now
        });
        break;
      }
      case "post_approval_response": {
        const approvalCommand = extractApprovalCommand(payload);
        if (approvalCommand) {
          this.approvalSessionByCommand.set(approvalCommand, { sessionId, timestamp: now });
        }
        ctx.clearStalePendingInteraction(sessionId);
        ctx.emitEvent({
          ...baseEvent,
          type: "activityUpdated",
          activity: summarizeApprovalResponse(payload)
        });
        ctx.sendResponse(clientId, ACK$3);
        break;
      }
      case "subagent_stop": {
        const stopChildSessionId = readFirstString(payload, ["child_session_id", "child_id"]);
        const mappedParent = stopChildSessionId ? this.subagentParentByChildSession.get(stopChildSessionId)?.parentSessionId : void 0;
        const targetSessionId = mappedParent || sessionId;
        if (stopChildSessionId) {
          this.subagentParentByChildSession.delete(stopChildSessionId);
        }
        ctx.emitEvent({
          ...baseEvent,
          sessionId: targetSessionId,
          type: "subagentStopped",
          subAgentInfo: buildSubagentInfo(payload, now)
        });
        ctx.sendResponse(clientId, ACK$3);
        break;
      }
      case "subagent_start": {
        const startChildSessionId = readFirstString(payload, ["child_session_id", "child_id"]);
        const mappedAgentId = extractSubagentId(payload) || startChildSessionId || crypto.randomUUID();
        if (startChildSessionId) {
          this.subagentParentByChildSession.set(startChildSessionId, {
            parentSessionId: sessionId,
            agentId: mappedAgentId,
            timestamp: now
          });
        }
        ctx.emitEvent({
          ...baseEvent,
          type: "subagentStarted",
          subAgentInfo: {
            ...buildSubagentInfo(payload, now),
            agentId: mappedAgentId
          }
        });
        ctx.sendResponse(clientId, ACK$3);
        break;
      }
      case "on_session_finalize": {
        ctx.clearStalePendingInteraction(sessionId);
        this.clearSessionTracking(sessionId);
        ctx.emitEvent({
          ...baseEvent,
          type: "sessionDeleted"
        });
        ctx.sendResponse(clientId, ACK$3);
        break;
      }
      case "on_session_end": {
        ctx.clearStalePendingInteraction(sessionId);
        const completed = readBoolean(payload, "completed");
        const interrupted = readBoolean(payload, "interrupted");
        if (completed !== true) {
          ctx.emitEvent({
            ...baseEvent,
            type: "sessionCompleted",
            summary: readFirstString(payload, ["summary", "message", "reason"]),
            lastAssistantMessage: this.latestAssistantBySession.get(sessionId),
            latestUserPrompt: this.latestPromptBySession.get(sessionId),
            isInterrupt: interrupted === true,
            isSessionEnd: false
          });
        }
        ctx.sendResponse(clientId, ACK$3);
        break;
      }
      default:
        ctx.sendResponse(clientId, ACK$3);
        break;
    }
  }
  isBlockingEvent() {
    return false;
  }
}
const ACK$2 = { type: "acknowledged" };
function toolRiskLevel(toolName) {
  const readOnly = /* @__PURE__ */ new Set(["Read", "Glob", "Grep", "LS", "Task"]);
  const high = /* @__PURE__ */ new Set(["Bash", "RunCommand", "WebSearch", "WebFetch"]);
  if (readOnly.has(toolName)) return "low";
  if (high.has(toolName)) return "high";
  return "medium";
}
function extractResponsePreview(raw) {
  if (typeof raw === "string") return raw.trim().slice(0, 80);
  if (raw && typeof raw === "object") {
    const obj = raw;
    const text = typeof obj.stdout === "string" && obj.stdout.trim() || typeof obj.output === "string" && obj.output.trim() || "";
    return text.replace(/\n/g, " ").slice(0, 80);
  }
  return "";
}
function summarizeToolInput(payload) {
  const toolName = payload.tool_name || "unknown";
  const raw = payload.tool_input;
  if (raw && typeof raw === "object") {
    const input = raw;
    const params = Object.entries(input).filter(([, v]) => v !== void 0 && v !== null && v !== "").map(([k, v]) => {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      const short = s.length > 60 ? s.slice(0, 57) + "..." : s;
      return `${k}: ${short}`;
    });
    if (params.length > 0) {
      const joined = params.join(", ");
      const maxLen = 120;
      const full = `${toolName}(${joined})`;
      return full.length > maxLen ? full.slice(0, maxLen - 3) + "..." : full;
    }
  }
  return `Using ${toolName}`;
}
function stripSystemReminders(raw) {
  const stripped = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
  return stripped.trim();
}
async function readLastAssistantMessage(transcriptPath) {
  try {
    const latestFile = path__namespace.join(transcriptPath, "latest.json");
    if (!fs__namespace.existsSync(latestFile)) return "";
    const latestData = JSON.parse(await promises.readFile(latestFile, "utf-8"));
    const checkpointId = latestData?.latest;
    if (!checkpointId) return "";
    const cpFile = path__namespace.join(transcriptPath, `${checkpointId}.json`);
    if (!fs__namespace.existsSync(cpFile)) return "";
    const cpData = JSON.parse(await promises.readFile(cpFile, "utf-8"));
    const messages = cpData?.checkpoint?.channel_values?.messages || [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg?.type !== "ai") continue;
      const content = msg.content;
      if (typeof content === "string" && content.trim()) {
        return content.trim();
      }
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === "object" && block.type === "text") {
            const text = block.text;
            if (typeof text === "string" && text.trim()) return text.trim();
          }
        }
      }
    }
  } catch {
    return "";
  }
  return "";
}
function stripThinkingPrefix(raw) {
  const lines = raw.split("\n");
  if (lines.length > 1 && lines[0].startsWith("{")) {
    try {
      const obj = JSON.parse(lines[0]);
      if (obj.type === "thinking") {
        return lines.slice(1).join("\n").trim();
      }
    } catch {
    }
  }
  return raw.trim();
}
class AidenAdapter {
  agentId = "aiden";
  latestPromptBySession = /* @__PURE__ */ new Map();
  transcriptPathBySession = /* @__PURE__ */ new Map();
  pendingSubagentDescriptions = /* @__PURE__ */ new Map();
  subagentParentByAgentId = /* @__PURE__ */ new Map();
  handleHook(clientId, payload, ctx) {
    const tool = this.agentId;
    const sessionId = payload.session_id || "aiden-unknown";
    const now = Date.now();
    const hookEvent = payload.hook_event_name;
    if (!hookEvent) {
      ctx.sendResponse(clientId, ACK$2);
      return;
    }
    const subAgent = payload.sub_agent;
    const topLevelAgentId = typeof payload.agent_id === "string" ? payload.agent_id : void 0;
    const isSubagentToolHook = hookEvent === "PreToolUse" || hookEvent === "PostToolUse";
    const subAgentId = subAgent?.id ?? (isSubagentToolHook && topLevelAgentId ? topLevelAgentId : void 0);
    if (subAgentId && hookEvent !== "SubagentStart" && hookEvent !== "SubagentStop") {
      const parentId = this.subagentParentByAgentId.get(subAgentId) ?? sessionId;
      const toolName = payload.tool_name || "Tool";
      let activity;
      if (hookEvent === "PostToolUse") {
        ctx.clearStalePendingInteraction(parentId);
        const preview = extractResponsePreview(payload.tool_output || payload.tool_response);
        activity = preview ? `${toolName}: ${preview}` : `${toolName} done`;
      } else {
        activity = summarizeToolInput(payload);
        if (toolName === "Bash") {
          const rawInput = payload.tool_input;
          if (rawInput && typeof rawInput === "object") {
            const input = rawInput;
            const cmd = typeof input.command === "string" && input.command || typeof input.cmd === "string" && input.cmd || "";
            if (cmd) activity = cmd;
          }
        }
      }
      ctx.emitEvent({
        type: "subagentToolActivity",
        sessionId: parentId,
        tool,
        timestamp: now,
        subAgentId,
        activity
      });
      ctx.sendResponse(clientId, ACK$2);
      return;
    }
    switch (hookEvent) {
      case "SessionStart": {
        const source = payload.source;
        if (source === "compact" || source === "clear") {
          ctx.updateJumpTarget(sessionId, tool);
          ctx.sendResponse(clientId, ACK$2);
          break;
        }
        const cwd = payload.cwd || "";
        const title = cwd ? cwd.split("/").pop() || "Aiden CLI" : "Aiden CLI";
        ctx.emitEvent({
          type: "sessionStarted",
          sessionId,
          tool,
          timestamp: now,
          title
        });
        ctx.updateJumpTarget(sessionId, tool);
        ctx.sendResponse(clientId, ACK$2);
        break;
      }
      case "UserPromptSubmit": {
        const rawPrompt = payload.prompt || "";
        const prompt = rawPrompt.trim() ? stripSystemReminders(rawPrompt) : "";
        if (prompt) this.latestPromptBySession.set(sessionId, prompt);
        const tp = payload.transcript_path;
        if (typeof tp === "string" && tp) this.transcriptPathBySession.set(sessionId, tp);
        const cwd = payload.cwd || "";
        const title = cwd ? cwd.split("/").pop() || "Aiden CLI" : "Aiden CLI";
        ctx.emitEvent({
          type: "sessionStarted",
          sessionId,
          tool,
          timestamp: now,
          title,
          summary: prompt?.slice(0, 120)
        });
        ctx.updateJumpTarget(sessionId, tool);
        ctx.playSoundEvent("sessionStart");
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: "Thinking...",
          latestUserPrompt: prompt?.slice(0, 120)
        });
        ctx.sendResponse(clientId, ACK$2);
        break;
      }
      case "PreToolUse": {
        ctx.clearStalePendingInteraction(sessionId);
        const toolName = payload.tool_name || "Tool";
        let activity = summarizeToolInput(payload);
        if (toolName === "Bash") {
          const rawInput = payload.tool_input;
          if (rawInput && typeof rawInput === "object") {
            const input = rawInput;
            const cmd = typeof input.command === "string" && input.command || typeof input.cmd === "string" && input.cmd || "";
            if (cmd) activity = cmd;
          }
        }
        if (toolName === "AskUserQuestion") {
          const toolInput = payload.tool_input;
          if (toolInput && Array.isArray(toolInput.questions) && toolInput.questions.length > 0) {
            ctx.playSoundEvent("approvalNeeded");
            ctx.emitEvent({
              type: "activityUpdated",
              sessionId,
              tool,
              timestamp: now,
              activity: i18n.k2249756269({}, "由于 Code Agent 限制，请在终端中回答问题")
            });
            ctx.emitEvent({
              type: "questionAsked",
              sessionId,
              tool,
              timestamp: now
            });
            ctx.sendResponse(clientId, ACK$2);
            ctx.setPendingQuestion(sessionId, clientId, tool, { disconnectPolicy: "preserveOnDisconnect" });
            break;
          }
        }
        if (toolName === "Task") {
          const toolInput = payload.tool_input;
          const desc = toolInput?.description || "";
          if (desc) {
            const q = this.pendingSubagentDescriptions.get(sessionId) ?? [];
            q.push(desc);
            this.pendingSubagentDescriptions.set(sessionId, q);
          }
        }
        ctx.emitEvent({
          type: "toolUseStarted",
          sessionId,
          tool,
          timestamp: now,
          activity
        });
        ctx.sendResponse(clientId, ACK$2);
        break;
      }
      case "PermissionRequest": {
        const reqToolName = payload.tool_name || "unknown";
        const toolInputText = payload.permission_request_summary || summarizeToolInput(payload);
        const permId = crypto.randomUUID();
        const permissionRequest = {
          id: permId,
          sessionId,
          toolName: reqToolName,
          toolInput: toolInputText,
          riskLevel: toolRiskLevel(reqToolName),
          approvalMode: "terminalNative"
        };
        ctx.playSoundEvent("approvalNeeded");
        ctx.emitEvent({
          type: "permissionRequested",
          sessionId,
          tool,
          timestamp: now,
          permissionRequest
        });
        ctx.sendResponse(clientId, ACK$2);
        ctx.setPendingPermission(sessionId, clientId, tool, {
          approvalMode: "terminalNative",
          disconnectPolicy: "preserveOnDisconnect",
          responseChannelClosedAt: now
        });
        break;
      }
      case "PostToolUse": {
        ctx.clearStalePendingInteraction(sessionId);
        const toolName = payload.tool_name || "Tool";
        const rawOutput = payload.tool_output || payload.tool_response || payload.error;
        const preview = extractResponsePreview(rawOutput);
        const activity = preview ? `${toolName}: ${preview}` : `${toolName} done`;
        ctx.emitEvent({
          type: "toolUseCompleted",
          sessionId,
          tool,
          timestamp: now,
          toolName
        });
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity
        });
        ctx.sendResponse(clientId, ACK$2);
        break;
      }
      case "Notification": {
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: payload.message || payload.notification_type || "Notification"
        });
        ctx.sendResponse(clientId, ACK$2);
        break;
      }
      case "SubagentStart": {
        const agentType = payload.agent_type || "Subagent";
        const agentId = payload.agent_id || "";
        if (agentId) {
          this.subagentParentByAgentId.set(agentId, sessionId);
        }
        const q = this.pendingSubagentDescriptions.get(sessionId) ?? [];
        const taskDescription = q.shift();
        if (q.length === 0) this.pendingSubagentDescriptions.delete(sessionId);
        const transcriptPath = payload.agent_transcript_path || void 0;
        const info = {
          agentId: agentId || payload.subagent_id || agentType,
          agentType,
          taskDescription: taskDescription || void 0,
          transcriptPath,
          startedAt: now
        };
        ctx.emitEvent({
          type: "subagentStarted",
          sessionId,
          tool,
          timestamp: now,
          subAgentInfo: info
        });
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: `${agentType}: ${taskDescription || "running"}`.slice(0, 120)
        });
        ctx.sendResponse(clientId, ACK$2);
        break;
      }
      case "SubagentStop": {
        const agentId = subAgent?.id || payload.agent_id || "";
        const agentType = subAgent?.type || payload.agent_type || void 0;
        const rawLastMsg = payload.last_assistant_message || "";
        const lastAssistantMsg = stripThinkingPrefix(rawLastMsg);
        if (agentId) {
          this.subagentParentByAgentId.delete(agentId);
        }
        const info = {
          agentId: agentId || payload.subagent_id || agentType || "Subagent",
          agentType,
          startedAt: now,
          lastToolActivity: lastAssistantMsg.slice(0, 200) || void 0
        };
        ctx.emitEvent({
          type: "subagentStopped",
          sessionId,
          tool,
          timestamp: now,
          subAgentInfo: info
        });
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: lastAssistantMsg ? `${agentType || "Subagent"}: ${lastAssistantMsg.slice(0, 80)}` : `${agentType || "Subagent"} done`
        });
        ctx.sendResponse(clientId, ACK$2);
        break;
      }
      case "Stop": {
        ctx.clearStalePendingInteraction(sessionId);
        const transcriptPath = this.transcriptPathBySession.get(sessionId) || (typeof payload.transcript_path === "string" ? payload.transcript_path : "");
        const latestPrompt = this.latestPromptBySession.get(sessionId) || "";
        this.pendingSubagentDescriptions.delete(sessionId);
        for (const [agentId, parentId] of this.subagentParentByAgentId) {
          if (parentId === sessionId) {
            this.subagentParentByAgentId.delete(agentId);
          }
        }
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: ""
        });
        const emitCompleted = (lastMsg) => {
          const assistantMsg = lastMsg || i18n.k2627975638({}, "由于 Code Agent 限制，请在终端中查看对应执行结果");
          ctx.emitEvent({
            type: "sessionCompleted",
            sessionId,
            tool,
            timestamp: now,
            summary: lastMsg.slice(0, 120) || "Turn completed",
            lastAssistantMessage: assistantMsg,
            latestUserPrompt: latestPrompt || void 0,
            isSessionEnd: false
          });
          ctx.playSoundEvent("taskComplete");
        };
        log.debug("aidenAdapter transcriptPath", transcriptPath);
        if (transcriptPath) {
          readLastAssistantMessage(transcriptPath).then(emitCompleted);
        } else {
          emitCompleted("");
        }
        ctx.sendResponse(clientId, ACK$2);
        break;
      }
      case "SessionEnd": {
        this.latestPromptBySession.delete(sessionId);
        this.transcriptPathBySession.delete(sessionId);
        this.pendingSubagentDescriptions.delete(sessionId);
        for (const [agentId, parentId] of this.subagentParentByAgentId) {
          if (parentId === sessionId) {
            this.subagentParentByAgentId.delete(agentId);
          }
        }
        ctx.clearStalePendingInteraction(sessionId);
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: ""
        });
        ctx.emitEvent({
          type: "sessionCompleted",
          sessionId,
          tool,
          timestamp: now,
          isSessionEnd: true,
          summary: "Session ended"
        });
        ctx.sendResponse(clientId, ACK$2);
        break;
      }
      case "PreCompact": {
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: "Compacting conversation..."
        });
        ctx.sendResponse(clientId, ACK$2);
        break;
      }
      default:
        ctx.sendResponse(clientId, ACK$2);
    }
  }
  isBlockingEvent(payload) {
    return payload.hook_event_name === "PermissionRequest";
  }
}
const ACK$1 = { type: "acknowledged" };
const TRAEX_PERMISSION_MODE_VALUES = [
  "default",
  "auto",
  "acceptEdits",
  "plan",
  "dontAsk",
  "bypassPermissions"
];
const TRAEX_PERMISSION_MODES = new Set(TRAEX_PERMISSION_MODE_VALUES);
class TraexCliAdapter {
  agentId = "traex";
  confirmedSessions = /* @__PURE__ */ new Set();
  titleBySession = /* @__PURE__ */ new Map();
  /** 子会话 ID → 父会话 ID */
  parentSessionMap = /* @__PURE__ */ new Map();
  handleHook(clientId, payload, ctx) {
    const tool = this.agentId;
    const sessionId = payload.session_id;
    const now = Date.now();
    if (!sessionId) {
      log.warn("[TraexCliAdapter] Skip hook without session_id, event=%s", payload.hook_event_name);
      ctx.sendResponse(clientId, ACK$1);
      return;
    }
    const eventName = payload.hook_event_name;
    switch (eventName) {
      case "SessionStart": {
        const cwd = payload.cwd || "";
        const project = cwd ? path.basename(cwd) : "";
        const parentId = this.parentSessionMap.get(sessionId);
        const isNew = !this.titleBySession.has(sessionId);
        if (isNew) {
          this.titleBySession.set(sessionId, project || "TRAE CLI 2.0 session");
        }
        ctx.emitEvent({
          type: "sessionStarted",
          sessionId,
          tool,
          timestamp: now,
          title: isNew ? this.titleBySession.get(sessionId) : void 0,
          parentSessionId: parentId
        });
        this.updateJumpTarget(sessionId, tool, payload, ctx);
        ctx.sendResponse(clientId, ACK$1);
        break;
      }
      case "UserPromptSubmit": {
        const sub = payload.user_prompt_submit;
        const prompt = payload.prompt || sub?.prompt || "";
        const cwd = payload.cwd || sub?.cwd || "";
        const project = cwd ? path.basename(cwd) : "";
        this.confirmedSessions.add(sessionId);
        const preview = prompt.length > 80 ? prompt.slice(0, 80) + "…" : prompt;
        const currentTitle = this.titleBySession.get(sessionId) ?? "";
        const alreadyHasPromptTitle = currentTitle.includes(" · ") || !project && currentTitle.length > 0 && currentTitle !== "TRAE CLI 2.0 session";
        let updatedTitle;
        if (!alreadyHasPromptTitle && preview) {
          const title = project ? `${project} · ${preview}` : preview;
          this.titleBySession.set(sessionId, title);
          updatedTitle = title;
        }
        const parentId = this.parentSessionMap.get(sessionId);
        ctx.emitEvent({
          type: "sessionStarted",
          sessionId,
          tool,
          timestamp: now,
          title: updatedTitle,
          latestUserPrompt: prompt || void 0,
          parentSessionId: parentId
        });
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: preview ? `Prompt: ${preview}` : "Processing prompt...",
          latestUserPrompt: prompt || void 0
        });
        ctx.playSoundEvent("sessionStart");
        this.updateJumpTarget(sessionId, tool, payload, ctx);
        ctx.sendResponse(clientId, ACK$1);
        break;
      }
      case "PreToolUse": {
        ctx.clearStalePendingInteraction(sessionId);
        const toolName = payload.tool_name || "tool";
        const toolInput = payload.tool_input;
        const activity = this.summarizeToolUse(toolName, toolInput);
        ctx.emitEvent({
          type: "toolUseStarted",
          sessionId,
          tool,
          timestamp: now,
          toolName,
          activity
        });
        const parentId = this.parentSessionMap.get(sessionId);
        if (parentId) {
          ctx.emitEvent({
            type: "subagentToolActivity",
            sessionId: parentId,
            tool,
            timestamp: now,
            subAgentId: sessionId,
            activity
          });
        }
        this.updateJumpTarget(sessionId, tool, payload, ctx);
        ctx.sendResponse(clientId, ACK$1);
        break;
      }
      case "PermissionRequest": {
        const permissionMode = parseTraexPermissionMode(payload.permission_mode);
        if (permissionMode === "bypassPermissions" || permissionMode === "auto") {
          ctx.sendResponse(clientId, ACK$1);
          break;
        }
        const approvalMode = ctx.getApprovalMode("traex");
        const reqToolName = payload.tool_name || "unknown";
        const rawInput = payload.tool_input;
        const command = rawInput?.command;
        const filePath = rawInput?.file_path;
        const toolInputText = command || filePath || this.summarizeToolUse(reqToolName, rawInput);
        ctx.clearStalePendingInteraction(sessionId);
        const permissionRequest = {
          id: crypto.randomUUID(),
          sessionId,
          toolName: reqToolName,
          toolInput: toolInputText,
          riskLevel: this.toolRiskLevel(reqToolName),
          approvalMode
        };
        ctx.playSoundEvent("approvalNeeded");
        ctx.emitEvent({
          type: "permissionRequested",
          sessionId,
          tool,
          timestamp: now,
          permissionRequest
        });
        if (approvalMode === "bridge") {
          ctx.setPendingPermission(sessionId, clientId, tool, {
            approvalMode: "bridge",
            disconnectPolicy: "resolveOnDisconnect"
          });
        } else {
          ctx.sendResponse(clientId, ACK$1);
          ctx.setPendingPermission(sessionId, clientId, tool, {
            approvalMode: "terminalNative",
            disconnectPolicy: "preserveOnDisconnect",
            responseChannelClosedAt: Date.now()
          });
        }
        this.updateJumpTarget(sessionId, tool, payload, ctx);
        break;
      }
      case "PostToolUse": {
        ctx.clearStalePendingInteraction(sessionId);
        ctx.emitEvent({
          type: "permissionResolved",
          sessionId,
          tool,
          timestamp: now
        });
        const toolName = payload.tool_name || "Tool";
        const rawResponse = payload.tool_response;
        const preview = this.extractResponsePreview(rawResponse);
        const activityLine = preview ? `${toolName}: ${preview}` : `${toolName} done`;
        ctx.emitEvent({
          type: "toolUseCompleted",
          sessionId,
          tool,
          timestamp: now,
          toolName
        });
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: activityLine
        });
        const parentId = this.parentSessionMap.get(sessionId);
        if (parentId) {
          ctx.emitEvent({
            type: "subagentToolActivity",
            sessionId: parentId,
            tool,
            timestamp: now,
            subAgentId: sessionId,
            activity: activityLine
          });
        }
        this.updateJumpTarget(sessionId, tool, payload, ctx);
        ctx.sendResponse(clientId, ACK$1);
        break;
      }
      case "Notification": {
        const notificationType = payload.notification_type;
        const message = payload.message;
        if (notificationType === "idle_prompt") {
          ctx.clearStalePendingInteraction(sessionId);
          ctx.emitEvent({
            type: "activityUpdated",
            sessionId,
            tool,
            timestamp: now,
            activity: ""
          });
          ctx.emitEvent({
            type: "sessionCompleted",
            sessionId,
            tool,
            timestamp: now,
            // NOTE: 此处 isInterrupt: true 并非表示「会话被用户打断」，而是用于门控跳过
            // ISLAND_PRESENT_SURFACE 弹出（idle_prompt 代表 turn 正常结束进入 REPL 等待态，
            // 无需再弹 surface）。若后续需要区分「真正中断」与「idle turn 结束」，
            // 应引入独立字段（如 isIdleTurnEnd），此处需同步调整。
            isInterrupt: true,
            isSessionEnd: false
          });
        } else {
          ctx.emitEvent({
            type: "activityUpdated",
            sessionId,
            tool,
            timestamp: now,
            activity: message || notificationType || "Notification"
          });
        }
        ctx.sendResponse(clientId, ACK$1);
        break;
      }
      case "SubagentStart": {
        const childId = payload.agent_id;
        if (childId) {
          this.parentSessionMap.set(childId, sessionId);
          const info = {
            agentId: childId,
            startedAt: now
          };
          ctx.emitEvent({
            type: "subagentStarted",
            sessionId,
            tool,
            timestamp: now,
            subAgentInfo: info
          });
        }
        ctx.sendResponse(clientId, ACK$1);
        break;
      }
      case "SubagentStop": {
        const childId = payload.agent_id;
        if (childId) {
          const info = {
            agentId: childId,
            startedAt: 0
          };
          ctx.emitEvent({
            type: "subagentStopped",
            sessionId,
            tool,
            timestamp: now,
            subAgentInfo: info
          });
          this.parentSessionMap.delete(childId);
        }
        ctx.sendResponse(clientId, ACK$1);
        break;
      }
      case "Stop": {
        ctx.clearStalePendingInteraction(sessionId);
        const parentId = this.parentSessionMap.get(sessionId);
        if (parentId) {
          ctx.emitEvent({
            type: "subagentStopped",
            sessionId: parentId,
            tool,
            timestamp: now,
            subAgentInfo: {
              agentId: sessionId,
              startedAt: 0
            }
          });
          ctx.emitEvent({
            type: "sessionCompleted",
            sessionId,
            tool,
            timestamp: now,
            isInterrupt: true,
            isSessionEnd: true
          });
          this.parentSessionMap.delete(sessionId);
          this.confirmedSessions.delete(sessionId);
          this.titleBySession.delete(sessionId);
          ctx.sendResponse(clientId, ACK$1);
          break;
        }
        const isConfirmed = this.confirmedSessions.has(sessionId);
        if (!isConfirmed) {
          ctx.emitEvent({
            type: "sessionCompleted",
            sessionId,
            tool,
            timestamp: now,
            isInterrupt: true,
            isSessionEnd: true
          });
          this.titleBySession.delete(sessionId);
          ctx.sendResponse(clientId, ACK$1);
          break;
        }
        this.updateJumpTarget(sessionId, tool, payload, ctx);
        const lastAssistantMessage = payload.last_assistant_message || payload.response;
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: ""
        });
        ctx.emitEvent({
          type: "sessionCompleted",
          sessionId,
          tool,
          timestamp: now,
          lastAssistantMessage,
          isInterrupt: payload.is_interrupt,
          isSessionEnd: false
        });
        ctx.playSoundEvent("taskComplete");
        ctx.sendResponse(clientId, ACK$1);
        break;
      }
      case "SessionEnd": {
        ctx.clearStalePendingInteraction(sessionId);
        const parentId = this.parentSessionMap.get(sessionId);
        if (parentId) {
          ctx.emitEvent({
            type: "subagentStopped",
            sessionId: parentId,
            tool,
            timestamp: now,
            subAgentInfo: {
              agentId: sessionId,
              startedAt: 0
            }
          });
          this.parentSessionMap.delete(sessionId);
        }
        for (const [childId, parentId2] of this.parentSessionMap) {
          if (parentId2 === sessionId) {
            this.parentSessionMap.delete(childId);
          }
        }
        this.updateJumpTarget(sessionId, tool, payload, ctx);
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: ""
        });
        ctx.emitEvent({
          type: "sessionCompleted",
          sessionId,
          tool,
          timestamp: now,
          isSessionEnd: true
        });
        this.confirmedSessions.delete(sessionId);
        this.titleBySession.delete(sessionId);
        ctx.sendResponse(clientId, ACK$1);
        break;
      }
      default:
        ctx.sendResponse(clientId, ACK$1);
    }
  }
  isBlockingEvent(payload) {
    return payload.hook_event_name === "PermissionRequest";
  }
  /** 对齐 CodexAdapter.updateJumpTarget：每个事件都刷新 jumpTarget，保证跳转可用 */
  updateJumpTarget(sessionId, tool, payload, ctx) {
    const raw = payload.terminal_app;
    const terminalApp = typeof raw === "string" ? raw.trim() : "";
    ctx.updateJumpTarget(sessionId, tool, {
      terminal_app: terminalApp || "TRAE CLI 2.0"
    });
  }
  summarizeToolUse(toolName, input) {
    if (!input) return `Using ${toolName}`;
    const command = input.command;
    if (command) return `${toolName}: ${command.slice(0, 120)}`;
    const filePath = input.file_path;
    if (filePath) return `${toolName}: ${filePath}`;
    const desc = input.description;
    if (desc) return `${toolName}: ${desc.slice(0, 120)}`;
    return `Using ${toolName}`;
  }
  extractResponsePreview(raw) {
    if (typeof raw === "string") return raw.trim().replace(/\n/g, " ").slice(0, 80);
    if (raw && typeof raw === "object") {
      const obj = raw;
      const text = typeof obj.stdout === "string" && obj.stdout.trim() || typeof obj.output === "string" && obj.output.trim() || "";
      return text.replace(/\n/g, " ").slice(0, 80);
    }
    return "";
  }
  toolRiskLevel(toolName) {
    const readOnly = /* @__PURE__ */ new Set(["Read", "Glob", "Grep", "LS", "Task"]);
    const high = /* @__PURE__ */ new Set(["Bash", "WebSearch", "WebFetch", "Agent"]);
    if (readOnly.has(toolName)) return "low";
    if (high.has(toolName)) return "high";
    return "medium";
  }
}
function parseTraexPermissionMode(value) {
  return typeof value === "string" && TRAEX_PERMISSION_MODES.has(value) ? value : void 0;
}
module.exports = {
  collectAndReportTokens,
  parseClaudeTokens,
  parseCodexTokens,
  GeminiAdapter,
  HermesAdapter,
  AidenAdapter,
  TraexCliAdapter,
  reportTokenUsage,
  getHermesCumulativeTokens,
  diffHermesCumulativeTokens
};
