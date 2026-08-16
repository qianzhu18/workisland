"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const promises = require("node:fs/promises");
const string_decoder = require("node:string_decoder");
const log = require("electron-log");

const MAX_SCAN_BYTES = 64 * 1024;
function readClaudeTranscriptTitle(transcriptPath) {
  if (!transcriptPath) return null;
  let fd = -1;
  try {
    const stat = fs.statSync(transcriptPath);
    if (stat.size === 0) return null;
    fd = fs.openSync(transcriptPath, "r");
    const headLen = Math.min(stat.size, MAX_SCAN_BYTES);
    const headBuf = Buffer.alloc(headLen);
    fs.readSync(fd, headBuf, 0, headLen, 0);
    let tailBuf = null;
    if (stat.size > MAX_SCAN_BYTES) {
      const tailOffset = Math.max(0, stat.size - MAX_SCAN_BYTES);
      const tailLen = stat.size - tailOffset;
      tailBuf = Buffer.alloc(tailLen);
      fs.readSync(fd, tailBuf, 0, tailLen, tailOffset);
    }
    const result = {};
    scanRegion(headBuf.toString("utf8"), result);
    if (tailBuf) scanRegion(tailBuf.toString("utf8"), result);
    if (!result.customTitle && !result.aiTitle) return null;
    return result;
  } catch (err) {
    log.debug?.(
      "[ClaudeTitleReader] read failed:",
      transcriptPath,
      err.message
    );
    return null;
  } finally {
    if (fd >= 0) {
      try {
        fs.closeSync(fd);
      } catch {
      }
    }
  }
}
function scanRegion(text, out) {
  const lines = text.split("\n");
  for (const line of lines) {
    if (!line) continue;
    if (!line.includes('"custom-title"') && !line.includes('"ai-title"')) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const obj = parsed;
    if (obj.type === "custom-title") {
      const title = trimmedTitle(obj.customTitle);
      if (title) out.customTitle = title;
    } else if (obj.type === "ai-title") {
      const title = trimmedTitle(obj.aiTitle);
      if (title) out.aiTitle = title;
    }
  }
}
function trimmedTitle(value) {
  if (typeof value !== "string") return void 0;
  const trimmed = value.trim();
  return trimmed ? trimmed : void 0;
}
function resolveClaudeSessionTitle(transcriptTitle, project, fallback = "Claude session") {
  return transcriptTitle?.customTitle || transcriptTitle?.aiTitle || project || fallback;
}
const ACK$d = { type: "acknowledged" };
function summarizeClaudeToolUse(toolName, payload) {
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
function toolRiskLevel$5(toolName) {
  const readOnly = /* @__PURE__ */ new Set(["Read", "Glob", "Grep", "LS", "Task"]);
  const high = /* @__PURE__ */ new Set(["Bash", "WebSearch", "WebFetch", "Agent"]);
  if (readOnly.has(toolName)) return "low";
  if (high.has(toolName)) return "high";
  return "medium";
}
function extractResponsePreview$5(raw) {
  if (typeof raw === "string") return raw.trim().slice(0, 80);
  if (raw && typeof raw === "object") {
    const obj = raw;
    const text = typeof obj.stdout === "string" && obj.stdout.trim() || typeof obj.output === "string" && obj.output.trim() || "";
    return text.replace(/\n/g, " ").slice(0, 80);
  }
  return "";
}
function summarizeToolInput$5(payload) {
  const toolName = payload.tool_name || "unknown";
  return summarizeClaudeToolUse(toolName, payload);
}
function stripCwd$2(filePath, cwd) {
  if (!cwd) return filePath;
  const prefix = cwd.endsWith("/") ? cwd : cwd + "/";
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
}
function stripIdeContextTags(raw) {
  if (!raw) return raw;
  let s = raw;
  const block = /^<(ide_[a-z_]+)>[\s\S]*?<\/\1>\s*/;
  while (block.test(s)) {
    s = s.replace(block, "");
  }
  const cleaned = s.trimStart();
  return cleaned || raw;
}
function resolveClaudeSubAgentId(payload) {
  const topLevelAgentId = typeof payload.agent_id === "string" && payload.agent_id.length > 0 ? payload.agent_id : void 0;
  const subAgent = payload.sub_agent;
  return topLevelAgentId ?? subAgent?.id;
}
function resolveClaudeSubAgentType(payload) {
  const topLevelAgentType = typeof payload.agent_type === "string" && payload.agent_type.length > 0 ? payload.agent_type : void 0;
  const subAgent = payload.sub_agent;
  return topLevelAgentType ?? subAgent?.type;
}
function readRalphLoopState(cwd, sessionId) {
  if (!cwd) return null;
  try {
    const filePath = path.join(cwd, ".claude", "ralph-loop.local.md");
    const raw = fs.readFileSync(filePath, "utf-8");
    const m = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return null;
    const fm = m[1];
    const get = (key) => {
      const re = new RegExp(`^${key}:\\s*(.*)$`, "m");
      const mm = fm.match(re);
      if (!mm) return void 0;
      let v = mm[1].trim();
      if (v.startsWith('"') && v.endsWith('"') || v.startsWith("'") && v.endsWith("'")) {
        v = v.slice(1, -1);
      }
      return v;
    };
    if (get("active") !== "true") return null;
    const stateSession = get("session_id") || "";
    if (!sessionId || !stateSession || stateSession && stateSession !== sessionId) return null;
    const iteration = Number(get("iteration") ?? "0");
    const maxIterations = Number(get("max_iterations") ?? "0");
    const promiseRaw = get("completion_promise");
    const completionPromise = promiseRaw && promiseRaw !== "null" ? promiseRaw : null;
    return {
      active: true,
      iteration: Number.isFinite(iteration) ? iteration : 0,
      maxIterations: Number.isFinite(maxIterations) ? maxIterations : 0,
      completionPromise
    };
  } catch {
    return null;
  }
}
const CONTEXT_LINES$1 = 2;
function addFileContext$1(filePath, oldString, newString) {
  try {
    const fileContent = fs.readFileSync(filePath, "utf-8");
    const idx = fileContent.indexOf(oldString);
    if (idx === -1) return { oldContent: oldString, newContent: newString };
    const lines = fileContent.split("\n");
    const beforeLen = fileContent.slice(0, idx).split("\n").length - 1;
    const matchLineCount = oldString.split("\n").length;
    const startLine = Math.max(0, beforeLen - CONTEXT_LINES$1);
    const endLine = Math.min(lines.length, beforeLen + matchLineCount + CONTEXT_LINES$1);
    const contextLines = lines.slice(startLine, endLine);
    const oldContent = contextLines.join("\n");
    const replaced = [...lines];
    replaced.splice(beforeLen, matchLineCount, ...newString.split("\n"));
    const newEndLine = Math.min(
      replaced.length,
      startLine + contextLines.length - matchLineCount + newString.split("\n").length
    );
    const newContent = replaced.slice(startLine, newEndLine).join("\n");
    return { oldContent, newContent };
  } catch {
    return { oldContent: oldString, newContent: newString };
  }
}
function buildCodeDiffFromToolInput$1(toolName, payload) {
  const rawInput = payload.tool_input;
  if (!rawInput || typeof rawInput !== "object") return [];
  const input = rawInput;
  const cwd = typeof payload.cwd === "string" ? payload.cwd : "";
  if (toolName === "Edit") {
    const filePath = typeof input.file_path === "string" ? input.file_path : "";
    const oldString = typeof input.old_string === "string" ? input.old_string : "";
    const newString = typeof input.new_string === "string" ? input.new_string : "";
    if (!filePath || !oldString && !newString) return [];
    const { oldContent, newContent } = addFileContext$1(filePath, oldString, newString);
    return [{ fileName: stripCwd$2(filePath, cwd), oldContent, newContent }];
  }
  if (toolName === "Write") {
    const filePath = typeof input.file_path === "string" ? input.file_path : "";
    const content = typeof input.content === "string" ? input.content : "";
    if (!filePath || !content) return [];
    return [{ fileName: stripCwd$2(filePath, cwd), oldContent: "", newContent: content }];
  }
  if (toolName === "MultiEdit") {
    const filePath = typeof input.file_path === "string" ? input.file_path : "";
    const edits = Array.isArray(input.edits) ? input.edits : [];
    if (!filePath || edits.length === 0) return [];
    const displayName = stripCwd$2(filePath, cwd);
    return edits.filter((e) => typeof e.old_string === "string" || typeof e.new_string === "string").map((e) => {
      const oldStr = typeof e.old_string === "string" ? e.old_string : "";
      const newStr = typeof e.new_string === "string" ? e.new_string : "";
      const { oldContent, newContent } = addFileContext$1(filePath, oldStr, newStr);
      return { fileName: displayName, oldContent, newContent };
    });
  }
  return [];
}
function buildQuestionPrompt$2(payload, sessionId) {
  const rawInput = payload.tool_input;
  if (!rawInput || typeof rawInput !== "object") return null;
  const inputObj = rawInput;
  const rawQuestions = inputObj.questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) return null;
  const questions = rawQuestions.map((q, qIndex) => {
    const qObj = q && typeof q === "object" ? q : {};
    const options = Array.isArray(qObj.options) ? qObj.options : [];
    return {
      id: `q${qIndex}`,
      question: String(qObj.question || ""),
      type: qObj.multiSelect ? "multiple" : "single",
      choices: options.map((opt, cIndex) => ({
        id: `c${qIndex}-${cIndex}`,
        label: String(opt.label || `Option ${cIndex + 1}`)
      }))
    };
  });
  return { id: crypto.randomUUID(), sessionId, questions };
}

const CLAUDE_ATTENTION_NOTIFICATIONS = new Set([
  "permission_prompt",
  "elicitation_dialog",
  "idle_prompt"
]);

class ClaudeAdapter {
  agentId = "claude";
  knownSessions = /* @__PURE__ */ new Set();
  latestPromptBySession = /* @__PURE__ */ new Map();
  /** 并行多个 Task 时按 FIFO 与 SubagentStart 顺序对齐描述（单键 Map 会互相覆盖） */
  pendingAgentDescriptions = /* @__PURE__ */ new Map();
  /** 子 Agent id → 父 session_id，用于子进程 PreToolUse 写入父会话的 SubagentInfo */
  subagentParentByAgentId = /* @__PURE__ */ new Map();
  /**
   * 子进程 PreToolUse/PostToolUse 可能早于父进程的 SubagentStart 到达；彼时 SessionState
   * 中尚无对应 activeSubagent，subagentToolActivity 会被丢弃。此处缓存最新一行，在
   * SubagentStart 补发（见 handleHook 中 SubagentStart 分支）。
   */
  pendingSubagentToolLine = /* @__PURE__ */ new Map();
  /** Avoid duplicate audio when Claude emits Stop and idle_prompt for one turn. */
  recentSoundBySession = /* @__PURE__ */ new Map();
  playSoundOnce(sessionId, eventId, ctx, timestamp) {
    const key = `${sessionId}:${eventId}`;
    const previous = this.recentSoundBySession.get(key) ?? 0;
    if (timestamp - previous < 1500) return;
    this.recentSoundBySession.set(key, timestamp);
    ctx.playSoundEvent(eventId);
  }
  handleHook(clientId, payload, ctx) {
    const tool = this.agentId;
    const sessionId = payload.session_id;
    const now = Date.now();
    const hookEvent = payload.hook_event_name;
    // 对齐 CodexAdapter.updateJumpTarget：每个事件都刷新 jumpTarget。
    // 原先只在 SessionStart / UserPromptSubmit 时设置，一旦会话被 sweep 清掉、
    // 再由后续工具事件重建，重建出来的会话就永远没有 jumpTarget —— 点击无法跳转，
    // 且 PidWatcher 与桌面 App 存活探测都以 jumpTarget 为前提，会话也不会自动停止。
    if (sessionId) ctx.updateJumpTarget?.(sessionId, tool);
    const subAgentId = resolveClaudeSubAgentId(payload);
    if (subAgentId && hookEvent !== "SubagentStart" && hookEvent !== "SubagentStop") {
      const parentId = this.subagentParentByAgentId.get(subAgentId) ?? sessionId;
      const toolName = payload.tool_name || "Tool";
      let activity;
      if (hookEvent === "PostToolUse") {
        const preview = extractResponsePreview$5(payload.tool_response);
        activity = preview ? `${toolName}: ${preview}` : `${toolName} done`;
      } else if (hookEvent === "PostToolUseFailure") {
        const error = payload.error || "";
        activity = error ? `${toolName} failed: ${error.slice(0, 80)}` : `${toolName} failed`;
      } else {
        activity = summarizeClaudeToolUse(toolName, payload);
      }
      this.pendingSubagentToolLine.set(subAgentId, { parentId, line: activity });
      ctx.emitEvent({
        type: "subagentToolActivity",
        sessionId: parentId,
        tool,
        timestamp: now,
        subAgentId,
        activity
      });
      if (hookEvent === "PostToolUseFailure") {
        ctx.emitEvent({
          type: "subagentStopped",
          sessionId: parentId,
          tool,
          timestamp: now,
          subAgentInfo: { agentId: subAgentId, startedAt: 0 }
        });
        this.subagentParentByAgentId.delete(subAgentId);
        this.pendingSubagentToolLine.delete(subAgentId);
      }
      ctx.sendResponse(clientId, ACK$d);
      return;
    }
    switch (payload.hook_event_name) {
      case "SessionStart": {
        const source = payload.source;
        if (source === "compact" || source === "clear") {
          ctx.updateJumpTarget(sessionId, tool);
          ctx.sendResponse(clientId, ACK$d);
          break;
        }
        const cwd = payload.cwd || "";
        const project = cwd ? path.basename(cwd) : "";
        const transcriptPath = payload.transcript_path;
        const transcriptTitle = transcriptPath ? readClaudeTranscriptTitle(transcriptPath) : null;
        const title = resolveClaudeSessionTitle(transcriptTitle, project);
        const isNew = !this.knownSessions.has(sessionId);
        if (isNew) this.knownSessions.add(sessionId);
        ctx.emitEvent({
          type: "sessionStarted",
          sessionId,
          tool,
          timestamp: now,
          title
        });
        ctx.updateJumpTarget(sessionId, tool);
        ctx.sendResponse(clientId, ACK$d);
        break;
      }
      case "UserPromptSubmit": {
        const rawPrompt = payload.prompt || payload.prompt_preview || "";
        const prompt = stripIdeContextTags(rawPrompt);
        if (prompt) this.latestPromptBySession.set(sessionId, prompt);
        const isNew = !this.knownSessions.has(sessionId);
        if (isNew) this.knownSessions.add(sessionId);
        const cwd = payload.cwd || "";
        const project = cwd ? path.basename(cwd) : "";
        const transcriptPath = payload.transcript_path;
        const transcriptTitle = transcriptPath ? readClaudeTranscriptTitle(transcriptPath) : null;
        const title = resolveClaudeSessionTitle(transcriptTitle, project);
        ctx.emitEvent({
          type: "sessionStarted",
          sessionId,
          tool,
          timestamp: now,
          title,
          summary: isNew ? prompt?.slice(0, 120) : void 0
        });
        ctx.updateJumpTarget(sessionId, tool);
        this.playSoundOnce(sessionId, "sessionStart", ctx, now);
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: "Thinking...",
          latestUserPrompt: prompt?.slice(0, 120)
        });
        if (transcriptPath) {
          ctx.attachClaudeTranscriptWatcher(sessionId, transcriptPath);
        }
        ctx.sendResponse(clientId, ACK$d);
        break;
      }
      case "PreToolUse": {
        ctx.clearStalePendingInteraction(sessionId);
        const toolName = payload.tool_name || "Tool";
        const activity = summarizeClaudeToolUse(toolName, payload);
        if (toolName === "Agent" || toolName === "Task") {
          const rawInput = payload.tool_input;
          const desc = rawInput?.description;
          if (desc) {
            const q = this.pendingAgentDescriptions.get(sessionId) ?? [];
            q.push(desc);
            this.pendingAgentDescriptions.set(sessionId, q);
          }
        }
        ctx.emitEvent({
          type: "toolUseStarted",
          sessionId,
          tool,
          timestamp: now,
          activity
        });
        ctx.sendResponse(clientId, ACK$d);
        break;
      }
      case "PermissionRequest": {
        const reqToolName = payload.tool_name || "unknown";
        let permissionSuggestions = payload.permission_suggestions ?? void 0;
        if (reqToolName !== "ExitPlanMode" && (!permissionSuggestions || permissionSuggestions.length === 0)) {
          permissionSuggestions = [
            {
              type: "addRules",
              rules: [{ toolName: reqToolName }],
              behavior: "allow",
              destination: "session"
            }
          ];
          payload.permission_suggestions = permissionSuggestions;
        }
        if (reqToolName === "AskUserQuestion") {
          const questionPrompt = buildQuestionPrompt$2(payload, sessionId);
          if (questionPrompt) {
            this.playSoundOnce(sessionId, "approvalNeeded", ctx, now);
            ctx.emitEvent({
              type: "questionAsked",
              sessionId,
              tool,
              timestamp: now,
              questionPrompt
            });
            ctx.setPendingQuestion(sessionId, clientId, tool, void 0, payload);
            break;
          }
        }
        const permId = crypto.randomUUID();
        let toolInputText;
        if (reqToolName === "ExitPlanMode") {
          const rawInput = payload.tool_input;
          const inputObj = rawInput && typeof rawInput === "object" ? rawInput : {};
          toolInputText = typeof inputObj.plan === "string" ? inputObj.plan : reqToolName;
        } else {
          toolInputText = payload.permission_request_summary || summarizeToolInput$5(payload);
        }
        const codeDiff = buildCodeDiffFromToolInput$1(reqToolName, payload);
        const permissionRequest = {
          id: permId,
          sessionId,
          toolName: reqToolName,
          toolInput: toolInputText,
          riskLevel: toolRiskLevel$5(reqToolName),
          ...codeDiff.length > 0 && { codeDiff },
          ...permissionSuggestions && permissionSuggestions.length > 0 && {
            permissionSuggestions
          }
        };
        this.playSoundOnce(sessionId, "approvalNeeded", ctx, now);
        ctx.emitEvent({
          type: "permissionRequested",
          sessionId,
          tool,
          timestamp: now,
          permissionRequest
        });
        ctx.setPendingPermission(sessionId, clientId, tool, void 0, payload);
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
        ctx.emitEvent({
          type: "toolUseCompleted",
          sessionId,
          tool,
          timestamp: now,
          toolName
        });
        const preview = extractResponsePreview$5(payload.tool_response);
        const activity = preview ? `${toolName}: ${preview}` : `${toolName} done`;
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity
        });
        ctx.sendResponse(clientId, ACK$d);
        break;
      }
      case "PostToolUseFailure": {
        ctx.clearStalePendingInteraction(sessionId);
        ctx.emitEvent({
          type: "permissionResolved",
          sessionId,
          tool,
          timestamp: now
        });
        const toolName = payload.tool_name || "Tool";
        ctx.emitEvent({
          type: "toolUseCompleted",
          sessionId,
          tool,
          timestamp: now,
          toolName
        });
        const error = payload.error || "";
        const failActivity = error ? `${toolName} failed: ${error.slice(0, 80)}` : `${toolName} failed`;
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: failActivity
        });
        ctx.sendResponse(clientId, ACK$d);
        break;
      }
      case "Notification": {
        const notificationType = String(payload.notification_type ?? "").toLowerCase();
        log.info(
          "[ClaudeAdapter] Notification session=%s type=%s title=%s message=%s",
          sessionId,
          notificationType,
          payload.title ?? "",
          payload.message ?? ""
        );
        if (CLAUDE_ATTENTION_NOTIFICATIONS.has(notificationType)) {
          const soundEvent = notificationType === "idle_prompt" ? "taskComplete" : "approvalNeeded";
          this.playSoundOnce(sessionId, soundEvent, ctx, now);
        }
        ctx.sendResponse(clientId, ACK$d);
        break;
      }
      case "SubagentStart": {
        const agentId = resolveClaudeSubAgentId(payload) ?? crypto.randomUUID();
        const agentType = resolveClaudeSubAgentType(payload);
        const transcriptPath = void 0;
        this.subagentParentByAgentId.set(agentId, sessionId);
        const q = this.pendingAgentDescriptions.get(sessionId) ?? [];
        const taskDescription = q.shift();
        if (q.length === 0) this.pendingAgentDescriptions.delete(sessionId);
        const info = { agentId, agentType, taskDescription, transcriptPath, startedAt: now };
        ctx.emitEvent({ type: "subagentStarted", sessionId, tool, timestamp: now, subAgentInfo: info });
        const buffered = this.pendingSubagentToolLine.get(agentId);
        if (buffered) {
          ctx.emitEvent({
            type: "subagentToolActivity",
            sessionId: buffered.parentId,
            tool,
            timestamp: now,
            subAgentId: agentId,
            activity: buffered.line
          });
        }
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: agentType ? `Starting ${agentType} subagent` : "Starting subagent"
        });
        ctx.sendResponse(clientId, ACK$d);
        break;
      }
      case "SubagentStop": {
        const agentId = resolveClaudeSubAgentId(payload) ?? "";
        const agentType = resolveClaudeSubAgentType(payload);
        this.subagentParentByAgentId.delete(agentId);
        this.pendingSubagentToolLine.delete(agentId);
        ctx.emitEvent({
          type: "subagentStopped",
          sessionId,
          tool,
          timestamp: now,
          subAgentInfo: { agentId, agentType, startedAt: 0 },
          activity: agentType ? `Finished ${agentType} subagent` : "Finished subagent"
        });
        ctx.sendResponse(clientId, ACK$d);
        break;
      }
      case "Stop": {
        ctx.clearStalePendingInteraction(sessionId);
        ctx.updateJumpTarget(sessionId, tool);
        const ralphLoopState = readRalphLoopState(payload.cwd, sessionId);
        const isInterrupt = payload.is_interrupt ?? false;
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
          lastAssistantMessage: payload.last_assistant_message,
          latestUserPrompt: this.latestPromptBySession.get(sessionId),
          isInterrupt,
          isSessionEnd: false,
          isRalphLoopIteration: ralphLoopState ? true : false
        });
        ctx.detachClaudeTranscriptWatcher(sessionId);
        if (!ralphLoopState) {
          this.playSoundOnce(sessionId, "taskComplete", ctx, now);
        }
        ctx.sendResponse(clientId, ACK$d);
        break;
      }
      case "StopFailure": {
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
          isSessionEnd: false,
          error: payload.error,
          errorDetail: payload.error_details
        });
        ctx.detachClaudeTranscriptWatcher(sessionId);
        this.playSoundOnce(sessionId, "taskError", ctx, now);
        ctx.sendResponse(clientId, ACK$d);
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
        ctx.detachClaudeTranscriptWatcher(sessionId);
        this.latestPromptBySession.delete(sessionId);
        this.pendingAgentDescriptions.delete(sessionId);
        for (const key of this.recentSoundBySession.keys()) {
          if (key.startsWith(`${sessionId}:`)) this.recentSoundBySession.delete(key);
        }
        for (const [subId, parentId] of this.subagentParentByAgentId) {
          if (parentId === sessionId) {
            this.subagentParentByAgentId.delete(subId);
            this.pendingSubagentToolLine.delete(subId);
          }
        }
        ctx.sendResponse(clientId, ACK$d);
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
        ctx.sendResponse(clientId, ACK$d);
        break;
      }
      default:
        ctx.sendResponse(clientId, ACK$d);
    }
  }
  isBlockingEvent(payload) {
    return payload.hook_event_name === "PermissionRequest";
  }
}
const NEWLINE_BYTE = 10;
const CARRIAGE_RETURN_BYTE = 13;
const READ_CHUNK_BYTES = 64 * 1024;
function decodeLine(buf) {
  const end = buf.length > 0 && buf[buf.length - 1] === CARRIAGE_RETURN_BYTE ? buf.length - 1 : buf.length;
  return buf.subarray(0, end).toString("utf8");
}
function stripTrailingCarriageReturn(line) {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}
function readFirstLineSync(filePath) {
  let fd = -1;
  try {
    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(READ_CHUNK_BYTES);
    const decoder = new string_decoder.StringDecoder("utf8");
    let line = "";
    let hasRawBytes = false;
    while (true) {
      const bytesRead = fs.readSync(fd, buf, 0, buf.length, null);
      if (bytesRead <= 0) break;
      const chunk = buf.subarray(0, bytesRead);
      const newlineIdx = chunk.indexOf(NEWLINE_BYTE);
      if (newlineIdx >= 0) {
        if (newlineIdx > 0) {
          hasRawBytes = true;
          line += decoder.write(chunk.subarray(0, newlineIdx));
        }
        line += decoder.end();
        return hasRawBytes ? stripTrailingCarriageReturn(line) : void 0;
      }
      hasRawBytes = true;
      line += decoder.write(chunk);
    }
    if (!hasRawBytes) return void 0;
    line += decoder.end();
    return stripTrailingCarriageReturn(line);
  } finally {
    if (fd >= 0) fs.closeSync(fd);
  }
}
async function readFirstLine(filePath) {
  const fd = await promises.open(filePath, "r");
  try {
    const buf = Buffer.alloc(READ_CHUNK_BYTES);
    const decoder = new string_decoder.StringDecoder("utf8");
    let line = "";
    let hasRawBytes = false;
    while (true) {
      const { bytesRead } = await fd.read(buf, 0, buf.length, null);
      if (bytesRead <= 0) break;
      const chunk = buf.subarray(0, bytesRead);
      const newlineIdx = chunk.indexOf(NEWLINE_BYTE);
      if (newlineIdx >= 0) {
        if (newlineIdx > 0) {
          hasRawBytes = true;
          line += decoder.write(chunk.subarray(0, newlineIdx));
        }
        line += decoder.end();
        return hasRawBytes ? stripTrailingCarriageReturn(line) : void 0;
      }
      hasRawBytes = true;
      line += decoder.write(chunk);
    }
    if (!hasRawBytes) return void 0;
    line += decoder.end();
    return stripTrailingCarriageReturn(line);
  } finally {
    await fd.close();
  }
}
function findFirstMatchingLineSync(filePath, matcher) {
  let fd = -1;
  try {
    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(READ_CHUNK_BYTES);
    let pending = Buffer.alloc(0);
    while (true) {
      const bytesRead = fs.readSync(fd, buf, 0, buf.length, null);
      if (bytesRead <= 0) break;
      const chunk = buf.subarray(0, bytesRead);
      const combined = pending.length > 0 ? Buffer.concat([pending, chunk]) : chunk;
      let start = 0;
      for (let i = 0; i < combined.length; i++) {
        if (combined[i] !== NEWLINE_BYTE) continue;
        const lineBuf = combined.subarray(start, i);
        start = i + 1;
        if (lineBuf.length === 0) continue;
        const matched = matcher(decodeLine(lineBuf));
        if (matched !== void 0) return matched;
      }
      pending = Buffer.from(combined.subarray(start));
    }
    if (pending.length === 0) return void 0;
    return matcher(decodeLine(pending));
  } finally {
    if (fd >= 0) fs.closeSync(fd);
  }
}
function findLastMatchingLineSync(filePath, matcher) {
  let fd = -1;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size <= 0) return void 0;
    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(READ_CHUNK_BYTES);
    let position = stat.size;
    let trailing = Buffer.alloc(0);
    while (position > 0) {
      const readLength = Math.min(buf.length, position);
      position -= readLength;
      const bytesRead = fs.readSync(fd, buf, 0, readLength, position);
      if (bytesRead <= 0) break;
      const chunk = buf.subarray(0, bytesRead);
      const combined = trailing.length > 0 ? Buffer.concat([chunk, trailing]) : chunk;
      let end = combined.length;
      for (let i = combined.length - 1; i >= 0; i--) {
        if (combined[i] !== NEWLINE_BYTE) continue;
        const lineBuf = combined.subarray(i + 1, end);
        end = i;
        if (lineBuf.length === 0) continue;
        const matched = matcher(decodeLine(lineBuf));
        if (matched !== void 0) return matched;
      }
      trailing = Buffer.from(combined.subarray(0, end));
    }
    if (trailing.length === 0) return void 0;
    return matcher(decodeLine(trailing));
  } finally {
    if (fd >= 0) fs.closeSync(fd);
  }
}
const CODEX_SOURCE_TO_TERMINAL_APP = {
  vscode: "VS Code",
  "vs-code": "VS Code",
  code: "VS Code",
  "visual-studio-code": "VS Code",
  "vscode-insiders": "VS Code Insiders",
  "vs-code-insiders": "VS Code Insiders",
  "code-insiders": "VS Code Insiders",
  cursor: "Cursor",
  windsurf: "Windsurf",
  antigravity: "Antigravity",
  trae: "Trae",
  "trae-dev": "Trae - Dev",
  "trae-cn": "Trae CN",
  traecn: "Trae CN",
  "trae-cn-alpha": "Trae CN - Alpha",
  "trae-cn-dev": "Trae CN - Dev"
};
function normalizeSourceValue(value) {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}
function mapSourceValue(value) {
  if (typeof value !== "string") return void 0;
  const key = normalizeSourceValue(value);
  return CODEX_SOURCE_TO_TERMINAL_APP[key];
}
function resolveCodexTerminalAppFromSessionMeta(meta) {
  const source = meta?.source;
  const direct = mapSourceValue(source);
  if (direct) return direct;
  if (!source || typeof source !== "object") return void 0;
  const objectSource = source;
  return mapSourceValue(objectSource.custom);
}
const ACK$c = { type: "acknowledged" };
function readLastUserPrompt(transcriptPath) {
  if (!transcriptPath) return void 0;
  try {
    const lastPrompt = findLastMatchingLineSync(transcriptPath, (line) => {
      try {
        const obj = JSON.parse(line);
        if (obj.type === "event_msg" && obj.payload?.type === "user_message" && typeof obj.payload.message === "string") {
          return obj.payload.message;
        }
      } catch {
      }
      return void 0;
    });
    return lastPrompt ? stripCodexIdeContextWrapper(lastPrompt) : lastPrompt;
  } catch {
    return void 0;
  }
}
function readApprovalPolicy(transcriptPath) {
  if (!transcriptPath) return void 0;
  try {
    return findFirstMatchingLineSync(transcriptPath, (line) => {
      try {
        const obj = JSON.parse(line);
        if (obj.type === "turn_context" && typeof obj.payload?.approval_policy === "string") {
          return obj.payload.approval_policy;
        }
      } catch {
      }
      return void 0;
    });
  } catch {
    return void 0;
  }
}
const CODEX_IDE_REQUEST_HEADER = "## My request for Codex:";
const CODEX_KNOWN_WRAPPER_PREFIXES = [
  "# Context from my IDE setup:",
  "# Files mentioned by the user:"
];
function stripCodexIdeContextWrapper(raw) {
  if (!raw) return raw;
  const head = raw.trimStart();
  if (!CODEX_KNOWN_WRAPPER_PREFIXES.some((p) => head.startsWith(p))) return raw;
  const idx = head.indexOf(CODEX_IDE_REQUEST_HEADER);
  if (idx === -1) return raw;
  const after = head.slice(idx + CODEX_IDE_REQUEST_HEADER.length);
  const cleaned = after.replace(/^[ \t]*\r?\n?/, "").trimEnd();
  return cleaned || raw;
}
function truncate$3(s, max = 80) {
  return s.length > max ? s.slice(0, max) + "…" : s;
}
const TITLE_AGENT_BODY = /short title for a task/i;
const USER_PROMPT_TAIL = "User prompt:";
function isCodexTitleGenerationUserPrompt(prompt) {
  if (!prompt) return false;
  const tail = prompt.lastIndexOf(USER_PROMPT_TAIL);
  if (tail === -1) return false;
  return TITLE_AGENT_BODY.test(prompt.slice(0, tail));
}
const AMBIENT_SUGGESTIONS_WORKER_HEADER = /^\s*Generate\s+\d+\s+to\s+\d+\s+ambient\s+suggestions\b/i;
const HYPERPERSONALIZED_SUGGESTIONS_WORKER_HEADER = /^\s*#\s*Overview\s+Generate\s+\d+\s+to\s+\d+\s+hyperpersonalized\s+suggestions\b/i;
const AMBIENT_SUGGESTIONS_REVIEWER_HEADER = /^\s*You\s+are\s+an\s+expert\s+at\s+upholding\s+safety\s+and\s+compliance\s+standards\s+for\s+Codex\s+ambient\s+suggestions\b/i;
const PR_METADATA_HEADER = /^\s*You\s+are\s+a\s+helpful\s+assistant\.\s*Generate\s+a\s+pull\s+request\s+title\s+and\s+body\b/i;
const SUMMARY_GENERATOR_HEADER = /^\s*You\s+are\s+writing\s+a\s+short\s+summary\s+of\s+a\s+final\s+assistant\s+message\b/i;
const COMMIT_MESSAGE_GENERATOR_HEADER = /^\s*Using\s+the\s+current\s+thread\s+context\s+and\s+the\s+diff\s+below,\s*generate\s+a\s+single-line\s+git\s+commit\s+message\b/i;
const COMMIT_PULL_REQUEST_MESSAGE_GENERATOR_HEADER = /^\s*Using\s+the\s+current\s+thread\s+context\s+and\s+the\s+commit\s+and\s+pull\s+request\s+contexts\s+below,\s*generate\s+one\s+git\s+commit\s+message\s+plus\s+one\s+pull\s+request\s+title\s+and\s+body\b/i;
const MEMORY_WRITING_AGENT_HEADER = /^\s*##\s+Memory\s+Writing\s+Agent\s*:/i;
const GUARDIAN_REVIEWER_HEADER = /^\s*You\s+are\s+judging\s+one\s+planned\s+coding-agent\s+action\b/i;
const AGENT_BOX_RUNTIME_HEADER = /##\s*GDPA\s+Agent\s+Box\s+Runtime\b/;
function isCodexInternalBackgroundSessionPrompt(prompt) {
  if (!prompt) return false;
  return isCodexTitleGenerationUserPrompt(prompt) || AMBIENT_SUGGESTIONS_WORKER_HEADER.test(prompt) || HYPERPERSONALIZED_SUGGESTIONS_WORKER_HEADER.test(prompt) || AMBIENT_SUGGESTIONS_REVIEWER_HEADER.test(prompt) || MEMORY_WRITING_AGENT_HEADER.test(prompt) || GUARDIAN_REVIEWER_HEADER.test(prompt) || PR_METADATA_HEADER.test(prompt) || SUMMARY_GENERATOR_HEADER.test(prompt) || COMMIT_MESSAGE_GENERATOR_HEADER.test(prompt) || COMMIT_PULL_REQUEST_MESSAGE_GENERATOR_HEADER.test(prompt) || AGENT_BOX_RUNTIME_HEADER.test(prompt);
}
function getCodexSourceObject(meta) {
  const src = meta?.source;
  if (!src || typeof src !== "object") return null;
  return src;
}
function getCodexSubagentObject(meta) {
  const src = getCodexSourceObject(meta);
  const sub = src?.subagent;
  if (!sub || typeof sub !== "object") return null;
  return sub;
}
function isCodexMemoryWritingSource(meta) {
  const src = getCodexSourceObject(meta);
  if (!src) return false;
  if (typeof src.internal === "string") return true;
  if (src.subagent === "memory_consolidation") return true;
  return false;
}
const GUARDIAN_REVIEWER_NAME = "guardian";
function isCodexGuardianReviewerSource(meta) {
  const sub = getCodexSubagentObject(meta);
  return sub?.other === GUARDIAN_REVIEWER_NAME;
}
const AGENT_JOB_PREFIX = "agent_job:";
function isCodexAgentJobSource(meta) {
  const sub = getCodexSubagentObject(meta);
  return typeof sub?.other === "string" && sub.other.startsWith(AGENT_JOB_PREFIX);
}
function isCodexSilentBackgroundSource(meta) {
  return isCodexMemoryWritingSource(meta) || isCodexGuardianReviewerSource(meta) || isCodexAgentJobSource(meta);
}
async function readTranscriptSessionMeta(transcriptPath, attempt = 0) {
  return new Promise((resolve) => {
    readFirstLine(transcriptPath).then((firstLine) => {
      if (!firstLine?.trim()) {
        if (attempt < 2) {
          const delay = 100 * Math.pow(2, attempt);
          setTimeout(() => {
            readTranscriptSessionMeta(transcriptPath, attempt + 1).then(resolve);
          }, delay);
          return;
        }
        resolve(null);
        return;
      }
      try {
        const obj = JSON.parse(firstLine);
        if (obj.type === "session_meta" && obj.payload) {
          resolve(obj.payload);
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      }
    }).catch(() => {
      if (attempt < 2) {
        const delay = 100 * Math.pow(2, attempt);
        setTimeout(() => {
          readTranscriptSessionMeta(transcriptPath, attempt + 1).then(resolve);
        }, delay);
        return;
      }
      resolve(null);
    });
  });
}
function readTranscriptSessionMetaSync(transcriptPath) {
  try {
    const firstLine = readFirstLineSync(transcriptPath);
    if (!firstLine?.trim()) return null;
    const obj = JSON.parse(firstLine);
    if (obj.type === "session_meta" && obj.payload) {
      return obj.payload;
    }
    return null;
  } catch {
    return null;
  }
}
function summarizeToolInput$4(payload) {
  const toolName = payload.tool_name || "unknown";
  const raw = payload.tool_input;
  if (raw) {
    if (raw.command) return String(raw.command);
    if (raw.file_path) return `${toolName}: ${raw.file_path}`;
    if (raw.description) return String(raw.description);
    return `[${toolName}] ${JSON.stringify(raw).slice(0, 200)}`;
  }
  return toolName;
}
function toolRiskLevel$4(toolName) {
  const readOnly = /* @__PURE__ */ new Set(["Read", "Glob", "Grep", "LS", "Task"]);
  const high = /* @__PURE__ */ new Set(["Bash", "WebSearch", "WebFetch", "Agent"]);
  if (readOnly.has(toolName)) return "low";
  if (high.has(toolName)) return "high";
  return "medium";
}
function parseQuestionsFromMessage(message) {
  const lines = message.split("\n");
  const items = [];
  let currentQuestion = "";
  let currentChoices = [];
  function flush() {
    if (!currentQuestion) return;
    items.push({
      id: crypto.randomUUID(),
      question: currentQuestion.trim(),
      type: "single",
      choices: currentChoices
    });
    currentQuestion = "";
    currentChoices = [];
  }
  for (const line of lines) {
    const trimmed = line.trim();
    const numbered = trimmed.match(/^\d+[\.\uff0e、]\s*(.+)/);
    if (numbered && trimmed.includes("？")) {
      flush();
      currentQuestion = numbered[1];
      continue;
    }
    const dashItem = trimmed.match(/^[-\u2022\uff0d]\s*(.+)/);
    if (dashItem && currentQuestion) {
      const text = dashItem[1].trim();
      if (text.startsWith("例如") || text.startsWith("如：")) {
        const examples = text.replace(/^例如[：:]?\s*/, "").replace(/^如[：:]?\s*/, "").split(/\s*[\/\uff0f、]\s*/).filter(Boolean);
        for (const ex of examples) {
          currentChoices.push({ id: crypto.randomUUID(), label: ex.trim() });
        }
      } else if (text.endsWith("？")) {
        flush();
        currentQuestion = text;
      } else {
        currentChoices.push({ id: crypto.randomUUID(), label: text });
      }
    }
  }
  flush();
  return items;
}
class CodexAdapter {
  agentId = "codex";
  // 缓存每个 session 当前用于展示的标题。
  titleBySession = /* @__PURE__ */ new Map();
  // 只有收到过用户 prompt 的 session，才算真实会话。
  // 没经过 UserPromptSubmit 的，多半是 Codex 自己开的内部子会话。
  confirmedSessions = /* @__PURE__ */ new Set();
  // 子 Agent session → 父 session 的映射（Codex 路径 C）
  parentSessionMap = /* @__PURE__ */ new Map();
  /**
   * Codex 内部 Agent 会话黑名单。
   * key = sessionId，value = "是否需要在 Stop 时补发 sessionCompleted 收掉孤儿 sessionStarted"。
   *
   * 三种登记路径与对应的 value：
   *   - SessionStart 同步 meta 命中 internal source：value=false（pristine，sessionStarted 从未发出）
   *   - SessionStart 异步 meta 命中：value=true（sessionStarted 已先发，需收尾）
   *   - UserPromptSubmit 命中（meta 慢到 / 文案兜底）：value=true（SessionStart 已先发，需收尾）
   *
   * 一经登记，所有后续 hook 事件由 handleHook 顶部早出逻辑直接 ACK，避免 Memory Writing Agent
   * 的文件编辑工具调用溢出到岛面板。Stop 早出按 value 决定是否补发 isInterrupt:true 的清理事件。
   *
   * 与 ambient_suggestions / 标题生成的差别：那两类只能靠 UserPromptSubmit 的 prompt 文案识别，
   * 都走 value=true 路径；Memory Writing Agent 在 SessionStart 阶段就能从 _session_meta.source 拿到
   * 协议级证据，常态走 value=false，避免任何 UI 抖动。
   */
  internalSessions = /* @__PURE__ */ new Map();
  /**
   * terminalNative 模式下「终端已批准过」的工具请求缓存。
   * 当后续 hook（PreToolUse/PostToolUse/Stop）到来清除了 terminalNative 的 pending permission 时，
   * 说明该请求已经在终端侧被批准。记住它以短路后续同 session 相同请求的重复
   * PermissionRequest（Codex remembered-approval bug 导致的冗余触发）。
   *
   * key = sessionId，value = 已被终端批准过的请求标识集合（toolName + toolInput hash）。
   * session 结束时（Stop）清理。
   */
  nativeApprovedRequests = /* @__PURE__ */ new Map();
  /**
   * 当前正在 pending 的 terminalNative PermissionRequest 的请求标识。
   * 在 clearStalePendingInteraction 清除 pending 时（即终端操作过），用此字段确认被批准的请求。
   *
   * key = sessionId，value = 请求标识（toolName + toolInput hash）。
   */
  pendingNativeRequestId = /* @__PURE__ */ new Map();
  /**
   * 生成请求标识，用于精确匹配相同的工具调用请求。
   * 避免把一次审批（如用户只批准了 `Bash: npm install`）扩大成同 session 后续所有
   * 同工具的 PermissionRequest 都被短路。
   */
  makeRequestId(toolName, toolInput) {
    const inputStr = typeof toolInput === "string" ? toolInput : JSON.stringify(toolInput);
    return `${toolName}:${inputStr.slice(0, 200)}`;
  }
  /**
   * 从 Codex request_user_input 的 PreToolUse payload 构造 QuestionPrompt。
   *
   * Codex 的 tool_input 有两种格式：
   * 1. 结构化: { questions: [{ id, question, options: [{ label, description }] }] }
   * 2. 纯文本: { message: "问题文本\n1. 选项A\n2. 选项B" }
   *
   * 优先解析结构化格式，回退到文本解析。
   */
  buildCodexQuestionPrompt(payload, sessionId) {
    const rawInput = payload.tool_input;
    if (!rawInput) return null;
    if (Array.isArray(rawInput.questions) && rawInput.questions.length > 0) {
      const questions2 = rawInput.questions.map(
        (q, qIndex) => {
          const options = Array.isArray(q.options) ? q.options : [];
          return {
            id: `q${qIndex}`,
            question: String(q.question || q.header || ""),
            type: "single",
            choices: options.map((opt, cIndex) => ({
              id: `c${qIndex}-${cIndex}`,
              label: String(opt.label || `Option ${cIndex + 1}`)
            }))
          };
        }
      );
      return { id: crypto.randomUUID(), sessionId, questions: questions2 };
    }
    const message = rawInput.message ?? rawInput.prompt ?? rawInput.description;
    if (!message) return null;
    const questions = parseQuestionsFromMessage(message);
    if (questions.length > 0) {
      return { id: crypto.randomUUID(), sessionId, questions };
    }
    return {
      id: crypto.randomUUID(),
      sessionId,
      questions: [{
        id: crypto.randomUUID(),
        question: message.slice(0, 500),
        type: "single",
        choices: []
      }]
    };
  }
  /**
   * 正在异步读取 transcript meta（SessionStart 异步分支）的 sessionId。
   *
   * 用途：防止 Stop 已经过完整生命周期之后才 resolve 的 async 回调把 sessionId 写进
   * `internalSessions`——那条目无人清理，长期累积会形成慢泄漏；并且 sessionId 万一被
   * 复用时，handleHook 顶部的早出 ACK 会把新会话所有事件静默吞掉，岛面板完全无感。
   *
   * 生命周期：
   *   - 进集：SessionStart 异步分支启动 readTranscriptSessionMeta 之前 add。
   *   - 出集：① async 回调命中（正常路径）；② 任意 Stop 路径在 case "Stop" 顶部统一 delete；
   *           ③ 早出 Stop 分支单独 delete（switch 之前的早出不会进 case "Stop"）。
   * 集合大小始终等于"在飞的异步 meta 读"个数，不会单调增长。
   */
  pendingMetaReads = /* @__PURE__ */ new Set();
  /**
   * 根据 session_meta 建立子 Agent 与父会话的关联并发出 subagentStarted。
   * 可在 SessionStart 与 UserPromptSubmit 中调用；已关联则短路。
   */
  linkSubagentFromSessionMeta(sessionId, meta, transcriptPath, ctx) {
    const threadSpawn = getCodexSubagentObject(meta)?.thread_spawn;
    const parentId = threadSpawn?.parent_thread_id;
    if (!parentId) return;
    const depth = threadSpawn?.depth ?? 1;
    if (depth > 1) return;
    const childId = parentId === sessionId ? meta.id : sessionId;
    if (!childId || childId === parentId) return;
    if (this.parentSessionMap.has(childId)) return;
    this.parentSessionMap.set(childId, parentId);
    ctx.emitEvent({
      type: "sessionStarted",
      sessionId: childId,
      tool: this.agentId,
      timestamp: Date.now(),
      parentSessionId: parentId
    });
    const nickname = meta.agent_nickname || threadSpawn?.agent_nickname;
    const info = {
      agentId: childId,
      agentType: nickname,
      transcriptPath,
      startedAt: Date.now()
    };
    ctx.emitEvent({
      type: "subagentStarted",
      sessionId: parentId,
      tool: this.agentId,
      timestamp: Date.now(),
      subAgentInfo: info
    });
  }
  /** 从 payload 的 _session_meta 或 transcript 首行解析父子关系（须在挂 latestUserPrompt 之前调用）。 */
  tryLinkSubagentFromPayload(sessionId, payload, ctx) {
    if (this.parentSessionMap.has(sessionId)) return;
    const inline = payload._session_meta;
    const transcriptPath = payload.transcript_path;
    const meta = inline || (transcriptPath ? readTranscriptSessionMetaSync(transcriptPath) : null);
    if (meta) {
      this.linkSubagentFromSessionMeta(sessionId, meta, transcriptPath, ctx);
    }
  }
  /**
   * Flux 重启或 Island 晚启动时，Codex 的 SessionStart/UserPromptSubmit 可能已经过去；
   * 后续 PermissionRequest / PostToolUse 仍会带 transcript_path。这里从 transcript 补回
   * 最新用户 prompt，让普通 running 态不要因为 prompt=false 被判为不可见。
   *
   * 返回 false 表示该事件属于 Codex 内部后台会话，调用方应 ACK 后静默跳过。
   */
  backfillPromptFromTranscriptIfNeeded(sessionId, payload, ctx, now) {
    if (this.confirmedSessions.has(sessionId) || this.internalSessions.has(sessionId) || this.parentSessionMap.has(sessionId)) {
      return true;
    }
    const transcriptPath = payload.transcript_path;
    if (!transcriptPath) return true;
    const inlineMeta = payload._session_meta;
    const meta = inlineMeta || readTranscriptSessionMetaSync(transcriptPath);
    if (isCodexSilentBackgroundSource(meta)) {
      this.internalSessions.set(sessionId, false);
      return false;
    }
    if (meta) {
      this.linkSubagentFromSessionMeta(sessionId, meta, transcriptPath, ctx);
      if (this.parentSessionMap.has(sessionId)) return true;
    }
    const prompt = readLastUserPrompt(transcriptPath);
    if (!prompt) return true;
    if (isCodexInternalBackgroundSessionPrompt(prompt)) {
      this.internalSessions.set(sessionId, false);
      return false;
    }
    this.confirmedSessions.add(sessionId);
    const preview = truncate$3(prompt);
    const cwd = payload.cwd || "";
    const project = cwd ? path.basename(cwd) : "";
    const title = project ? `${project} · ${preview}` : preview;
    this.titleBySession.set(sessionId, title);
    ctx.emitEvent({
      type: "sessionStarted",
      sessionId,
      tool: this.agentId,
      timestamp: now,
      title,
      latestUserPrompt: prompt
    });
    return true;
  }
  /**
   * 如果当前存在 terminalNative 的 pending permission，说明终端侧已经操作过了（后续 hook 到来
   * 意味着 Codex 已经执行了工具或停止了）。把该 session+requestId 记入 nativeApprovedRequests，
   * 用于短路后续同 session 相同请求的重复 PermissionRequest。
   */
  recordNativeApprovalIfPending(sessionId) {
    const pendingRequestId = this.pendingNativeRequestId.get(sessionId);
    if (!pendingRequestId) return;
    let approved = this.nativeApprovedRequests.get(sessionId);
    if (!approved) {
      approved = /* @__PURE__ */ new Set();
      this.nativeApprovedRequests.set(sessionId, approved);
    }
    approved.add(pendingRequestId);
    this.pendingNativeRequestId.delete(sessionId);
  }
  handleHook(clientId, payload, ctx) {
    const tool = this.agentId;
    const sessionId = payload.session_id;
    const now = Date.now();
    if (!sessionId) {
      log.warn(
        "[CodexAdapter] Skip hook without session_id, event=%s, payload=%s",
        payload.hook_event_name,
        payload
      );
      ctx.sendResponse(clientId, ACK$c);
      return;
    }
    if (this.internalSessions.has(sessionId)) {
      if (payload.hook_event_name === "Stop") {
        ctx.clearStalePendingInteraction(sessionId);
        this.pendingMetaReads.delete(sessionId);
        const hasOrphan = this.internalSessions.get(sessionId) === true;
        if (hasOrphan) {
          ctx.emitEvent({
            type: "sessionCompleted",
            sessionId,
            tool,
            timestamp: now,
            isInterrupt: true,
            isSessionEnd: true
          });
        }
        this.internalSessions.delete(sessionId);
        this.titleBySession.delete(sessionId);
      }
      ctx.sendResponse(clientId, ACK$c);
      return;
    }
    switch (payload.hook_event_name) {
      case "SessionStart": {
        const transcriptPath = payload.transcript_path;
        if (!transcriptPath) {
          this.internalSessions.set(sessionId, false);
          ctx.sendResponse(clientId, ACK$c);
          break;
        }
        const inlineMeta = payload._session_meta;
        const syncMeta = inlineMeta || readTranscriptSessionMetaSync(transcriptPath);
        if (isCodexSilentBackgroundSource(syncMeta)) {
          this.internalSessions.set(sessionId, false);
          ctx.sendResponse(clientId, ACK$c);
          break;
        }
        const cwd = payload.cwd || "";
        const project = cwd ? path.basename(cwd) : "";
        this.titleBySession.delete(sessionId);
        ctx.emitEvent({
          type: "sessionStarted",
          sessionId,
          tool,
          timestamp: now,
          title: payload.session_title || project || "Codex session"
        });
        this.updateJumpTarget(sessionId, tool, payload, ctx);
        if (syncMeta) {
          this.linkSubagentFromSessionMeta(
            sessionId,
            syncMeta,
            transcriptPath,
            ctx
          );
        } else {
          this.pendingMetaReads.add(sessionId);
          readTranscriptSessionMeta(transcriptPath).then((meta) => {
            if (!this.pendingMetaReads.has(sessionId)) return;
            this.pendingMetaReads.delete(sessionId);
            if (meta) {
              if (isCodexSilentBackgroundSource(meta)) {
                this.internalSessions.set(sessionId, true);
                return;
              }
              this.linkSubagentFromSessionMeta(
                sessionId,
                meta,
                transcriptPath,
                ctx
              );
            }
          });
        }
        ctx.sendResponse(clientId, ACK$c);
        break;
      }
      case "UserPromptSubmit": {
        const rawPrompt = payload.prompt || payload.prompt_preview || "";
        const prompt = stripCodexIdeContextWrapper(rawPrompt);
        const inlineMeta = payload._session_meta;
        const transcriptPath = payload.transcript_path;
        const meta = inlineMeta || (transcriptPath ? readTranscriptSessionMetaSync(transcriptPath) : null);
        if (isCodexSilentBackgroundSource(meta) || isCodexInternalBackgroundSessionPrompt(prompt)) {
          this.internalSessions.set(sessionId, true);
          ctx.sendResponse(clientId, ACK$c);
          break;
        }
        this.tryLinkSubagentFromPayload(sessionId, payload, ctx);
        this.confirmedSessions.add(sessionId);
        const preview = truncate$3(prompt);
        if (preview) {
          const isFirst = !this.titleBySession.has(sessionId);
          if (isFirst) {
            const cwd = payload.cwd || "";
            const project = cwd ? path.basename(cwd) : "";
            const title = project ? `${project} · ${preview}` : preview;
            this.titleBySession.set(sessionId, title);
          }
          ctx.emitEvent({
            type: "sessionStarted",
            sessionId,
            tool,
            timestamp: now,
            title: isFirst ? this.titleBySession.get(sessionId) : void 0,
            latestUserPrompt: prompt
          });
        }
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: preview ? `Prompt: ${preview}` : "Processing prompt..."
        });
        if (!this.parentSessionMap.has(sessionId)) {
          ctx.playSoundEvent("sessionStart");
        }
        this.updateJumpTarget(sessionId, tool, payload, ctx);
        ctx.sendResponse(clientId, ACK$c);
        break;
      }
      case "PreToolUse": {
        if (!this.backfillPromptFromTranscriptIfNeeded(sessionId, payload, ctx, now)) {
          ctx.sendResponse(clientId, ACK$c);
          break;
        }
        const agentId = payload.agent_id;
        if (!agentId) {
          this.recordNativeApprovalIfPending(sessionId);
          ctx.clearStalePendingInteraction(sessionId, true);
        }
        const toolName = payload.tool_name || "Bash";
        const inputSummary = summarizeToolInput$4(payload);
        const activityLine = `${toolName} ${inputSummary.slice(0, 120)}`.trim();
        ctx.emitEvent({
          type: "toolUseStarted",
          sessionId,
          tool,
          timestamp: now,
          toolName,
          activity: activityLine
        });
        const childSessionId = agentId || sessionId;
        const parentId = this.parentSessionMap.get(childSessionId);
        if (parentId) {
          ctx.emitEvent({
            type: "subagentToolActivity",
            sessionId: parentId,
            tool: this.agentId,
            timestamp: now,
            subAgentId: childSessionId,
            activity: activityLine
          });
        }
        if (toolName === "request_user_input") {
          const questionPrompt = this.buildCodexQuestionPrompt(payload, sessionId);
          if (questionPrompt) {
            ctx.playSoundEvent("approvalNeeded");
            ctx.emitEvent({
              type: "questionAsked",
              sessionId,
              tool,
              timestamp: now,
              questionPrompt
            });
            ctx.setPendingQuestion(sessionId, clientId, tool, {
              disconnectPolicy: "preserveOnDisconnect"
            });
          }
        }
        this.updateJumpTarget(sessionId, tool, payload, ctx);
        ctx.sendResponse(clientId, ACK$c);
        break;
      }
      case "PermissionRequest": {
        const permissionMode = typeof payload.permission_mode === "string" ? payload.permission_mode : void 0;
        if (!this.backfillPromptFromTranscriptIfNeeded(sessionId, payload, ctx, now)) {
          ctx.sendResponse(clientId, ACK$c);
          break;
        }
        if (permissionMode === "bypassPermissions") {
          this.updateJumpTarget(sessionId, tool, payload, ctx);
          ctx.sendResponse(clientId, ACK$c);
          break;
        }
        const transcriptPath = payload.transcript_path;
        const approvalPolicy = readApprovalPolicy(transcriptPath);
        if (approvalPolicy === "never") {
          this.updateJumpTarget(sessionId, tool, payload, ctx);
          ctx.sendResponse(clientId, ACK$c);
          break;
        }
        const reqToolName = payload.tool_name || "unknown";
        const rawInput = payload.tool_input;
        const requestId = this.makeRequestId(reqToolName, rawInput);
        const approved = this.nativeApprovedRequests.get(sessionId);
        if (approved?.has(requestId)) {
          this.updateJumpTarget(sessionId, tool, payload, ctx);
          ctx.sendResponse(clientId, ACK$c);
          break;
        }
        const approvalMode = ctx.getApprovalMode("codex");
        if (approvalMode === "autoReview") {
          this.updateJumpTarget(sessionId, tool, payload, ctx);
          ctx.sendResponse(clientId, ACK$c);
          break;
        }
        ctx.clearStalePendingInteraction(sessionId);
        const inputRecord = rawInput;
        const description = inputRecord?.description;
        const command = inputRecord?.command;
        const toolInputText = description || command || summarizeToolInput$4(payload);
        const permId = crypto.randomUUID();
        const permissionRequest = {
          id: permId,
          sessionId,
          toolName: reqToolName,
          toolInput: toolInputText,
          riskLevel: toolRiskLevel$4(reqToolName),
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
          ctx.sendResponse(clientId, ACK$c);
          ctx.setPendingPermission(sessionId, clientId, tool, {
            approvalMode: "terminalNative",
            disconnectPolicy: "preserveOnDisconnect",
            responseChannelClosedAt: Date.now()
          });
          this.pendingNativeRequestId.set(sessionId, requestId);
        }
        this.updateJumpTarget(sessionId, tool, payload, ctx);
        break;
      }
      case "PostToolUse": {
        if (!this.backfillPromptFromTranscriptIfNeeded(sessionId, payload, ctx, now)) {
          ctx.sendResponse(clientId, ACK$c);
          break;
        }
        const approvalMode = ctx.getApprovalMode("codex");
        this.recordNativeApprovalIfPending(sessionId);
        ctx.clearStalePendingInteraction(sessionId, true);
        const toolName = payload.tool_name || "unknown";
        if (toolName === "request_user_input") {
          ctx.emitEvent({
            type: "questionAnswered",
            sessionId,
            tool,
            timestamp: now
          });
        } else if (approvalMode !== "bridge") {
          ctx.emitEvent({
            type: "permissionResolved",
            sessionId,
            tool,
            timestamp: now
          });
        }
        const rawResponse = typeof payload.tool_response === "string" ? payload.tool_response.trim() : "";
        const preview = rawResponse.replace(/\n/g, " ").slice(0, 80);
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
            tool: this.agentId,
            timestamp: now,
            subAgentId: sessionId,
            activity: activityLine
          });
        }
        ctx.sendResponse(clientId, ACK$c);
        break;
      }
      case "Stop": {
        this.recordNativeApprovalIfPending(sessionId);
        ctx.clearStalePendingInteraction(sessionId);
        this.pendingMetaReads.delete(sessionId);
        if (!this.backfillPromptFromTranscriptIfNeeded(sessionId, payload, ctx, now)) {
          this.titleBySession.delete(sessionId);
          ctx.sendResponse(clientId, ACK$c);
          break;
        }
        const agentId = payload.agent_id;
        const childSessionId = agentId || sessionId;
        const parentId = this.parentSessionMap.get(childSessionId);
        if (parentId) {
          const assistantPreview2 = payload.assistant_message_preview;
          const lastAssistantMessage2 = payload.last_assistant_message;
          ctx.emitEvent({
            type: "subagentStopped",
            sessionId: parentId,
            tool,
            timestamp: now,
            subAgentInfo: {
              agentId: childSessionId,
              startedAt: 0
            }
          });
          ctx.emitEvent({
            type: "sessionCompleted",
            sessionId: childSessionId,
            tool,
            timestamp: now,
            summary: assistantPreview2,
            lastAssistantMessage: lastAssistantMessage2,
            isInterrupt: true,
            isSessionEnd: true
          });
          this.parentSessionMap.delete(childSessionId);
          this.titleBySession.delete(childSessionId);
          this.nativeApprovedRequests.delete(childSessionId);
          this.pendingNativeRequestId.delete(childSessionId);
          ctx.sendResponse(clientId, ACK$c);
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
            // 阻止弹出通知卡片
            isSessionEnd: true
            // 标记会话已结束，以便清理
          });
          this.titleBySession.delete(sessionId);
          this.nativeApprovedRequests.delete(sessionId);
          this.pendingNativeRequestId.delete(sessionId);
          ctx.sendResponse(clientId, ACK$c);
          break;
        }
        let lastPrompt;
        const raw = readLastUserPrompt(
          payload.transcript_path
        );
        if (raw) {
          lastPrompt = truncate$3(raw);
        }
        const isFirst = !this.titleBySession.has(sessionId);
        if (isFirst && lastPrompt) {
          const cwd = payload.cwd || "";
          const project = cwd ? path.basename(cwd) : "";
          const title = project ? `${project} · ${lastPrompt}` : lastPrompt;
          this.titleBySession.set(sessionId, title);
        }
        this.updateJumpTarget(sessionId, tool, payload, ctx);
        if (isFirst && lastPrompt) {
          ctx.emitEvent({
            type: "sessionStarted",
            sessionId,
            tool,
            timestamp: now - 1,
            title: this.titleBySession.get(sessionId)
          });
        }
        const lastAssistantMessage = payload.last_assistant_message;
        const assistantPreview = payload.assistant_message_preview;
        const hasQuestion = lastAssistantMessage && lastAssistantMessage.includes("？");
        if (hasQuestion) {
          const questions = parseQuestionsFromMessage(lastAssistantMessage);
          if (questions.length > 0) {
            const questionPrompt = {
              id: crypto.randomUUID(),
              sessionId,
              questions
            };
            ctx.emitEvent({
              type: "questionAsked",
              sessionId,
              tool,
              timestamp: now,
              questionPrompt
            });
          } else {
            ctx.emitEvent({
              type: "sessionCompleted",
              sessionId,
              tool,
              timestamp: now,
              summary: assistantPreview,
              lastAssistantMessage,
              latestUserPrompt: lastPrompt,
              isInterrupt: payload.is_interrupt,
              isSessionEnd: false
            });
          }
        } else {
          ctx.emitEvent({
            type: "sessionCompleted",
            sessionId,
            tool,
            timestamp: now,
            summary: assistantPreview,
            lastAssistantMessage,
            latestUserPrompt: lastPrompt,
            isInterrupt: payload.is_interrupt,
            isSessionEnd: false
          });
        }
        if (!this.parentSessionMap.has(sessionId)) {
          ctx.playSoundEvent("taskComplete");
        }
        this.confirmedSessions.delete(sessionId);
        this.titleBySession.delete(sessionId);
        this.nativeApprovedRequests.delete(sessionId);
        this.pendingNativeRequestId.delete(sessionId);
        ctx.sendResponse(clientId, ACK$c);
        break;
      }
      default:
        ctx.sendResponse(clientId, ACK$c);
    }
  }
  isBlockingEvent(payload) {
    const event = payload.hook_event_name;
    return event === "PermissionRequest";
  }
  updateJumpTarget(sessionId, tool, payload, ctx) {
    const raw = payload.terminal_app;
    const terminalApp = typeof raw === "string" ? raw.trim() : "";
    const metaTerminalApp = resolveCodexTerminalAppFromSessionMeta(
      payload._session_meta
    );
    ctx.updateJumpTarget(sessionId, tool, {
      terminal_app: terminalApp || metaTerminalApp || "Codex"
    });
  }
}
module.exports = { ClaudeAdapter, CodexAdapter, findLastMatchingLineSync };
