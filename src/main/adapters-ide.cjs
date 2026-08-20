"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const log = require("electron-log");
const { i18n } = require("./i18n.cjs");
const { findLastMatchingLineSync } = require("./adapters-cli.cjs");

const ACK$b = { type: "acknowledged" };
const HOOK_EVENT_NAME_MAP = {
  userpromptsubmit: "user_prompt_submit",
  pretooluse: "pre_tool_use",
  posttooluse: "post_tool_use",
  posttoolusefailure: "post_tool_use_failure",
  permissionrequest: "permission_request",
  stop: "stop",
  sessionstart: "session_start",
  sessionend: "session_end",
  subagentstart: "subagent_start",
  subagentstop: "subagent_stop",
  notification: "notification"
};
function normalizeEventType(payload) {
  const eventType = payload.event_type;
  if (eventType) return eventType;
  const hookName = payload.hook_event_name;
  if (!hookName) return void 0;
  return HOOK_EVENT_NAME_MAP[hookName.toLowerCase()] ?? hookName.toLowerCase();
}
function summarizeToolUse$1(toolName, input) {
  if (!input) return `Using ${toolName}`;
  const params = Object.entries(input).filter(([, v]) => v !== void 0 && v !== null && v !== "").map(([k, v]) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    const short = s.length > 60 ? s.slice(0, 57) + "..." : s;
    return `${k}: ${short}`;
  });
  if (params.length === 0) return `Using ${toolName}`;
  const joined = params.join(", ");
  const maxLen = 120;
  const full = `${toolName}(${joined})`;
  return full.length > maxLen ? full.slice(0, maxLen - 3) + "..." : full;
}
function extractResponsePreview$4(raw) {
  if (typeof raw === "string") return raw.trim().slice(0, 80);
  if (raw && typeof raw === "object") {
    const obj = raw;
    const text = typeof obj.stdout === "string" && obj.stdout.trim() || typeof obj.output === "string" && obj.output.trim() || "";
    return text.replace(/\n/g, " ").slice(0, 80);
  }
  return "";
}
function toolRiskLevel$3(toolName) {
  const readOnly = /* @__PURE__ */ new Set(["Read", "Glob", "Grep", "LS", "Task"]);
  const high = /* @__PURE__ */ new Set(["Bash", "WebSearch", "WebFetch", "Agent"]);
  if (readOnly.has(toolName)) return "low";
  if (high.has(toolName)) return "high";
  return "medium";
}
class CocoAdapter {
  agentId = "coco";
  // 被 coco hook 覆盖过的 sessionId 集合。TraeHookAdapter 据此跳过同一 session 的重复事件，
  // 避免 Trae IDE 内嵌终端跑 TRAE CLI 时两套 hook 同时触发导致双重音效。
  static hookCoveredSessions = /* @__PURE__ */ new Set();
  static COVERED_SESSIONS_HIGH_WATER = 200;
  knownSessions = /* @__PURE__ */ new Set();
  // PreToolUse(Agent) 缓存 description，供后续 subagent_start 使用（subagent_start payload 不含 description）
  pendingSubagentDescriptions = /* @__PURE__ */ new Map();
  handleHook(clientId, payload, ctx) {
    const tool = this.agentId;
    const sessionId = payload.session_id || `coco-${process.pid}-${Date.now()}`;
    const now = Date.now();
    const eventType = normalizeEventType(payload);
    if (payload.session_id) {
      CocoAdapter.hookCoveredSessions.add(sessionId);
    }
    if (CocoAdapter.hookCoveredSessions.size > CocoAdapter.COVERED_SESSIONS_HIGH_WATER) {
      const keep = Math.floor(CocoAdapter.COVERED_SESSIONS_HIGH_WATER / 2);
      const entries = [...CocoAdapter.hookCoveredSessions];
      CocoAdapter.hookCoveredSessions = new Set(entries.slice(entries.length - keep));
    }
    switch (eventType) {
      case "session_start": {
        const cwd = payload.cwd;
        const project = cwd ? path.basename(cwd) : "";
        if (!this.knownSessions.has(sessionId)) this.knownSessions.add(sessionId);
        ctx.emitEvent({
          type: "sessionStarted",
          sessionId,
          tool,
          timestamp: now,
          title: project || "TRAE CLI session"
        });
        ctx.updateJumpTarget(sessionId, tool);
        ctx.sendResponse(clientId, ACK$b);
        break;
      }
      case "user_prompt_submit": {
        const sub = payload.user_prompt_submit;
        const prompt = sub?.prompt;
        const cwd = payload.cwd;
        const project = cwd ? path.basename(cwd) : "";
        const isNew = !this.knownSessions.has(sessionId);
        if (isNew) {
          this.knownSessions.add(sessionId);
        }
        ctx.emitEvent({
          type: "sessionStarted",
          sessionId,
          tool,
          timestamp: now,
          title: isNew ? project || "TRAE CLI session" : void 0,
          summary: isNew ? prompt?.slice(0, 120) : void 0
        });
        ctx.playSoundEvent("sessionStart");
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: "Thinking...",
          latestUserPrompt: prompt?.slice(0, 120)
        });
        ctx.updateJumpTarget(sessionId, tool);
        ctx.sendResponse(clientId, ACK$b);
        break;
      }
      case "pre_tool_use": {
        ctx.clearStalePendingInteraction(sessionId);
        const pre = payload.pre_tool_use;
        const toolName = pre?.tool_name ?? "tool";
        const toolInput = pre?.tool_input;
        if (toolName === "AskUserQuestion" && toolInput) {
          if (toolInput.questions.length > 0) {
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
            ctx.sendResponse(clientId, ACK$b);
            ctx.setPendingQuestion(sessionId, clientId, tool);
            break;
          }
        }
        const activity = summarizeToolUse$1(toolName, toolInput);
        if (toolName === "Agent") {
          const description = toolInput?.description;
          if (description) {
            const queue = this.pendingSubagentDescriptions.get(sessionId) ?? [];
            queue.push(description);
            this.pendingSubagentDescriptions.set(sessionId, queue);
          }
        }
        ctx.emitEvent({
          type: "toolUseStarted",
          sessionId,
          tool,
          timestamp: now,
          activity
        });
        ctx.sendResponse(clientId, ACK$b);
        break;
      }
      case "permission_request": {
        const approvalMode = ctx.getApprovalMode("coco");
        const reqToolName = payload.tool_name || "unknown";
        const tool_input = payload.tool_input;
        const toolInputText = tool_input?.command || tool_input?.file_path || summarizeToolUse$1(reqToolName, tool_input);
        const permissionRequest = {
          id: crypto.randomUUID(),
          sessionId,
          toolName: reqToolName,
          toolInput: toolInputText,
          riskLevel: toolRiskLevel$3(reqToolName),
          approvalMode
        };
        ctx.playSoundEvent("approvalNeeded");
        ctx.emitEvent({
          type: "permissionRequested",
          sessionId,
          tool,
          timestamp: now,
          permissionRequest,
          activity: summarizeToolUse$1(reqToolName, tool_input)
        });
        if (approvalMode === "bridge") {
          ctx.setPendingPermission(sessionId, clientId, tool, {
            approvalMode: "bridge",
            disconnectPolicy: "resolveOnDisconnect"
          });
        } else {
          ctx.sendResponse(clientId, ACK$b);
          ctx.setPendingPermission(sessionId, clientId, tool, {
            approvalMode: "terminalNative",
            disconnectPolicy: "preserveOnDisconnect",
            responseChannelClosedAt: Date.now()
          });
        }
        break;
      }
      case "post_tool_use": {
        ctx.clearStalePendingInteraction(sessionId);
        ctx.emitEvent({
          type: "permissionResolved",
          sessionId,
          tool,
          timestamp: now
        });
        const post = payload.post_tool_use;
        const toolName = post?.tool_name ?? payload.tool_name ?? "Tool";
        ctx.emitEvent({
          type: "toolUseCompleted",
          sessionId,
          tool,
          timestamp: now,
          toolName
        });
        const rawResponse = post?.tool_response ?? payload.tool_response;
        const preview = extractResponsePreview$4(rawResponse);
        const activity = preview ? `${toolName}: ${preview}` : `${toolName} done`;
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity
        });
        ctx.sendResponse(clientId, ACK$b);
        break;
      }
      case "stop": {
        ctx.clearStalePendingInteraction(sessionId);
        this.pendingSubagentDescriptions.delete(sessionId);
        ctx.updateJumpTarget(sessionId, tool);
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
          isInterrupt: payload.is_interrupt,
          lastAssistantMessage: payload.systemMessage || i18n.k2627975638({}, "由于 Code Agent 限制，请在终端中查看对应执行结果"),
          isSessionEnd: false
        });
        ctx.playSoundEvent("taskComplete");
        ctx.sendResponse(clientId, ACK$b);
        break;
      }
      case "session_end": {
        ctx.clearStalePendingInteraction(sessionId);
        ctx.updateJumpTarget(sessionId, tool);
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
        ctx.sendResponse(clientId, ACK$b);
        break;
      }
      case "subagent_stop": {
        const agentId = payload.agent_id || crypto.randomUUID();
        const agentType = payload.agent_type || void 0;
        const info = {
          agentId,
          agentType,
          startedAt: 0
        };
        ctx.emitEvent({
          type: "subagentStopped",
          sessionId,
          tool,
          timestamp: now,
          subAgentInfo: info
        });
        ctx.sendResponse(clientId, ACK$b);
        break;
      }
      case "subagent_start": {
        const agentId = payload.agent_id || crypto.randomUUID();
        const agentType = payload.agent_type || void 0;
        const descQueue = this.pendingSubagentDescriptions.get(sessionId);
        const description = payload.description || descQueue?.shift();
        const info = {
          agentId,
          agentType,
          taskDescription: description,
          startedAt: now
        };
        ctx.emitEvent({
          type: "subagentStarted",
          sessionId,
          tool,
          timestamp: now,
          subAgentInfo: info
        });
        ctx.sendResponse(clientId, ACK$b);
        break;
      }
      case "post_tool_use_failure": {
        ctx.clearStalePendingInteraction(sessionId);
        ctx.emitEvent({
          type: "permissionResolved",
          sessionId,
          tool,
          timestamp: now
        });
        const failedToolName = payload.tool_name ?? "Tool";
        ctx.emitEvent({
          type: "toolUseCompleted",
          sessionId,
          tool,
          timestamp: now,
          toolName: failedToolName
        });
        const errorMsg = payload.error ?? "";
        const activity = errorMsg ? `${failedToolName} failed: ${errorMsg.slice(0, 80)}` : `${failedToolName} failed`;
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity
        });
        ctx.sendResponse(clientId, ACK$b);
        break;
      }
      case "notification": {
        const notificationType = payload.notification_type;
        const message = payload.message;
        if (notificationType === "idle_prompt") {
          ctx.clearStalePendingInteraction(sessionId);
          this.pendingSubagentDescriptions.delete(sessionId);
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
        ctx.sendResponse(clientId, ACK$b);
        break;
      }
      default:
        ctx.sendResponse(clientId, ACK$b);
    }
  }
  isBlockingEvent(payload) {
    const eventType = normalizeEventType(payload);
    return eventType === "permission_request";
  }
}
const ACK$a = { type: "acknowledged" };
function summarizeCursorToolUse(toolName, payload) {
  const input = payload.tool_input;
  if (!input) {
    const command = payload.command;
    const filePath = payload.file_path;
    const hint = command ?? filePath;
    if (hint) {
      const short = hint.length > 80 ? hint.slice(0, 77) + "..." : hint;
      return `${toolName}(${short})`;
    }
    return `Using ${toolName}`;
  }
  const params = Object.entries(input).filter(([, v]) => v !== void 0 && v !== null && v !== "").map(([k, v]) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    const short = s.length > 60 ? s.slice(0, 57) + "..." : s;
    return `${k}: ${short}`;
  });
  if (params.length === 0) return `Using ${toolName}`;
  const joined = params.join(", ");
  const maxLen = 120;
  const full = `${toolName}(${joined})`;
  return full.length > maxLen ? full.slice(0, maxLen - 3) + "..." : full;
}
function resolveCursorSessionId(payload) {
  const sessionId = payload.session_id;
  const conversationId = payload.conversation_id;
  return sessionId || conversationId || `cursor-${crypto.randomUUID()}`;
}
function resolveCursorTitle(payload) {
  const wsRoot = firstWorkspaceRoot(payload);
  const cwd = payload.cwd;
  const project = wsRoot ? path.basename(wsRoot) : cwd ? path.basename(cwd) : "";
  return project || "Cursor session";
}
function isCursorUserHooksRunnerDirectory(dir) {
  try {
    return path.resolve(dir) === path.join(os.homedir(), ".cursor");
  } catch {
    return false;
  }
}
function firstWorkspaceRoot(payload) {
  const roots = payload.workspace_roots;
  if (!Array.isArray(roots)) return void 0;
  for (const r of roots) {
    if (typeof r === "string") {
      const t = r.trim();
      if (t) return t;
    }
  }
  return void 0;
}
function resolveCursorJumpCwd(payload) {
  const fromRoots = firstWorkspaceRoot(payload);
  if (fromRoots) return fromRoots;
  const c = payload.cwd;
  if (typeof c === "string") {
    const t = c.trim();
    if (t && !isCursorUserHooksRunnerDirectory(t)) return t;
  }
  return void 0;
}
class CursorAdapter {
  agentId = "cursor";
  autoApprove = false;
  knownSessions = /* @__PURE__ */ new Set();
  latestPromptBySession = /* @__PURE__ */ new Map();
  handleHook(clientId, payload, ctx) {
    const tool = this.agentId;
    const sessionId = resolveCursorSessionId(payload);
    const now = Date.now();
    this.tryUpdateJumpTarget(sessionId, tool, payload, ctx);
    switch (payload.hook_event_name) {
      case "sessionStart": {
        const isNew = !this.knownSessions.has(sessionId);
        if (isNew) this.knownSessions.add(sessionId);
        ctx.emitEvent({
          type: "sessionStarted",
          sessionId,
          tool,
          timestamp: now,
          title: resolveCursorTitle(payload)
        });
        ctx.sendResponse(clientId, ACK$a);
        break;
      }
      case "sessionEnd": {
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
        this.latestPromptBySession.delete(sessionId);
        this.knownSessions.delete(sessionId);
        ctx.sendResponse(clientId, ACK$a);
        break;
      }
      case "beforeSubmitPrompt": {
        const prompt = payload.prompt;
        if (prompt) this.latestPromptBySession.set(sessionId, prompt);
        const isNew = !this.knownSessions.has(sessionId);
        if (isNew) this.knownSessions.add(sessionId);
        ctx.emitEvent({
          type: "sessionStarted",
          sessionId,
          tool,
          timestamp: now,
          title: resolveCursorTitle(payload),
          summary: isNew ? prompt?.slice(0, 120) : void 0
        });
        ctx.playSoundEvent("sessionStart");
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: "Thinking...",
          latestUserPrompt: prompt?.slice(0, 120)
        });
        ctx.sendResponse(clientId, ACK$a);
        break;
      }
      case "beforeShellExecution": {
        ctx.clearStalePendingInteraction(sessionId);
        const activity = summarizeCursorToolUse("Shell", payload);
        ctx.emitEvent({
          type: "toolUseStarted",
          sessionId,
          tool,
          timestamp: now,
          activity,
          toolName: "Shell"
        });
        ctx.sendResponse(clientId, ACK$a);
        break;
      }
      case "afterShellExecution": {
        ctx.clearStalePendingInteraction(sessionId);
        ctx.emitEvent({
          type: "toolUseCompleted",
          sessionId,
          tool,
          timestamp: now,
          toolName: "Shell"
        });
        ctx.sendResponse(clientId, ACK$a);
        break;
      }
      case "beforeMCPExecution": {
        const serverName = payload.server;
        const toolName = payload.tool_name;
        const label = serverName ? `MCP: ${serverName}${toolName ? ` → ${toolName}` : ""}` : toolName || "MCP";
        const activity = summarizeCursorToolUse(label, payload);
        ctx.clearStalePendingInteraction(sessionId);
        ctx.emitEvent({
          type: "toolUseStarted",
          sessionId,
          tool,
          timestamp: now,
          activity,
          toolName: label
        });
        ctx.sendResponse(clientId, ACK$a);
        break;
      }
      case "afterMCPExecution": {
        ctx.clearStalePendingInteraction(sessionId);
        const serverName = payload.server;
        const toolName = payload.tool_name;
        const label = serverName ? `MCP: ${serverName}${toolName ? ` → ${toolName}` : ""}` : toolName || "MCP";
        ctx.emitEvent({
          type: "toolUseCompleted",
          sessionId,
          tool,
          timestamp: now,
          toolName: label
        });
        ctx.sendResponse(clientId, ACK$a);
        break;
      }
      case "preToolUse": {
        const toolName = payload.tool_name || "Tool";
        const activity = summarizeCursorToolUse(toolName, payload);
        ctx.emitEvent({
          type: "toolUseStarted",
          sessionId,
          tool,
          timestamp: now,
          activity
        });
        ctx.sendResponse(clientId, ACK$a);
        break;
      }
      case "postToolUse": {
        ctx.emitEvent({
          type: "toolUseCompleted",
          sessionId,
          tool,
          timestamp: now
        });
        ctx.sendResponse(clientId, ACK$a);
        break;
      }
      case "beforeReadFile": {
        const filePath = payload.file_path;
        const activity = filePath ? `ReadFile(${filePath})` : "Using ReadFile";
        ctx.emitEvent({
          type: "toolUseStarted",
          sessionId,
          tool,
          timestamp: now,
          activity
        });
        ctx.sendResponse(clientId, ACK$a);
        break;
      }
      case "afterFileEdit": {
        const filePath = payload.file_path;
        ctx.emitEvent({
          type: "toolUseCompleted",
          sessionId,
          tool,
          timestamp: now
        });
        if (filePath) {
          ctx.emitEvent({
            type: "activityUpdated",
            sessionId,
            tool,
            timestamp: now,
            activity: `Edited: ${filePath}`
          });
        }
        ctx.sendResponse(clientId, ACK$a);
        break;
      }
      case "afterAgentResponse": {
        const text = payload.text;
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: "Agent responded"
        });
        if (text) {
          const latestPrompt = this.latestPromptBySession.get(sessionId);
          ctx.emitEvent({
            type: "sessionCompleted",
            sessionId,
            tool,
            timestamp: now,
            lastAssistantMessage: text,
            latestUserPrompt: latestPrompt,
            isSessionEnd: false
          });
        }
        ctx.sendResponse(clientId, ACK$a);
        break;
      }
      case "afterAgentThought": {
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: "Agent thinking..."
        });
        ctx.sendResponse(clientId, ACK$a);
        break;
      }
      case "stop": {
        ctx.clearStalePendingInteraction(sessionId);
        const text = payload.text;
        const status = payload.status;
        const latestPrompt = this.latestPromptBySession.get(sessionId);
        const isError = status && ["error", "timeout"].includes(status);
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
          lastAssistantMessage: text,
          latestUserPrompt: latestPrompt,
          isInterrupt: payload.is_interrupt,
          isSessionEnd: false
        });
        ctx.playSoundEvent(isError ? "taskError" : "taskComplete");
        ctx.sendResponse(clientId, ACK$a);
        break;
      }
      default:
        ctx.sendResponse(clientId, ACK$a);
    }
  }
  isBlockingEvent(payload) {
    if (this.autoApprove) return false;
    return payload.hook_event_name === "beforeShellExecution" || payload.hook_event_name === "beforeMCPExecution";
  }
  tryUpdateJumpTarget(sessionId, tool, payload, ctx) {
    const terminalApp = payload.terminal_app;
    if (!terminalApp) return;
    ctx.updateJumpTarget(sessionId, tool, {
      cwd: resolveCursorJumpCwd(payload)
    });
  }
}
const ACK$9 = { type: "acknowledged" };
class OpenCodeAdapter {
  agentId = "opencode";
  latestPromptBySession = /* @__PURE__ */ new Map();
  latestAssistantBySession = /* @__PURE__ */ new Map();
  knownSessions = /* @__PURE__ */ new Set();
  // 按终端信息分组，每个终端只保留最新的会话
  terminalToLatestSessionId = /* @__PURE__ */ new Map();
  sessionToTerminalKey = /* @__PURE__ */ new Map();
  shouldApplyTerminalLimit(payload) {
    const terminalSessionId = payload.terminal_session_id;
    const terminalTty = payload.terminal_tty;
    return !!terminalSessionId || !!terminalTty;
  }
  getTerminalKey(payload) {
    const terminalSessionId = payload.terminal_session_id;
    if (terminalSessionId) return `session:${terminalSessionId}`;
    const terminalTty = payload.terminal_tty;
    if (terminalTty) return `tty:${terminalTty}`;
    const terminalApp = payload.terminal_app;
    if (terminalApp) return `app:${terminalApp}`;
    return "unknown";
  }
  handleHook(clientId, payload, ctx) {
    const tool = this.agentId;
    const sessionId = payload.session_id;
    const now = Date.now();
    log.info("[OpenCodeAdapter]", payload);
    const agentId = payload.agent_id;
    if (agentId) {
      ctx.sendResponse(clientId, ACK$9);
      return;
    }
    switch (payload.hook_event_name) {
      case "SessionStart": {
        const terminalKey = this.getTerminalKey(payload);
        if (this.shouldApplyTerminalLimit(payload)) {
          const previousSessionId = this.terminalToLatestSessionId.get(terminalKey);
          if (previousSessionId && previousSessionId !== sessionId) {
            log.info("[OpenCodeAdapter] ending previous session in same terminal:", previousSessionId);
            ctx.emitEvent({
              type: "sessionCompleted",
              sessionId: previousSessionId,
              tool,
              timestamp: now,
              lastAssistantMessage: this.latestAssistantBySession.get(previousSessionId),
              latestUserPrompt: this.latestPromptBySession.get(previousSessionId),
              isSessionEnd: true
            });
            this.latestPromptBySession.delete(previousSessionId);
            this.latestAssistantBySession.delete(previousSessionId);
            this.knownSessions.delete(previousSessionId);
            this.sessionToTerminalKey.delete(previousSessionId);
          }
        }
        this.terminalToLatestSessionId.set(terminalKey, sessionId);
        this.sessionToTerminalKey.set(sessionId, terminalKey);
        const cwd = payload.cwd || "";
        const project = cwd && cwd !== "." ? path.basename(cwd) : "";
        const { session_title = "" } = payload;
        ctx.emitEvent({
          type: "sessionStarted",
          sessionId,
          tool,
          timestamp: now,
          title: session_title ? session_title : project || "OpenCode session"
        });
        ctx.updateJumpTarget(sessionId, tool);
        ctx.sendResponse(clientId, ACK$9);
        break;
      }
      case "SessionEnd": {
        ctx.clearStalePendingInteraction(sessionId);
        ctx.updateJumpTarget(sessionId, tool);
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
          lastAssistantMessage: payload.last_assistant_message ?? this.latestAssistantBySession.get(sessionId),
          latestUserPrompt: this.latestPromptBySession.get(sessionId),
          isSessionEnd: true
        });
        this.latestPromptBySession.delete(sessionId);
        this.latestAssistantBySession.delete(sessionId);
        this.knownSessions.delete(sessionId);
        if (this.shouldApplyTerminalLimit(payload)) {
          const terminalKey = this.sessionToTerminalKey.get(sessionId);
          if (terminalKey && this.terminalToLatestSessionId.get(terminalKey) === sessionId) {
            this.terminalToLatestSessionId.delete(terminalKey);
          }
        }
        this.sessionToTerminalKey.delete(sessionId);
        ctx.sendResponse(clientId, ACK$9);
        break;
      }
      case "UserPromptSubmit": {
        const prompt = payload.prompt || "";
        if (prompt) this.latestPromptBySession.set(sessionId, prompt);
        this.latestAssistantBySession.delete(sessionId);
        const isNew = !this.knownSessions.has(sessionId);
        if (isNew) this.knownSessions.add(sessionId);
        ctx.emitEvent({
          type: "sessionStarted",
          sessionId,
          tool,
          timestamp: now,
          summary: prompt ? prompt.slice(0, 120) : void 0
        });
        ctx.playSoundEvent("sessionStart");
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: "Thinking...",
          latestUserPrompt: prompt ? prompt.slice(0, 120) : void 0
        });
        ctx.sendResponse(clientId, ACK$9);
        break;
      }
      case "AssistantMessageUpdate": {
        const assistantText = payload.assistant_message_preview || "";
        const { session_title = "" } = payload;
        if (assistantText) {
          this.latestAssistantBySession.set(sessionId, assistantText);
          if (session_title) {
            ctx.emitEvent({
              type: "activityUpdated",
              sessionId,
              tool,
              timestamp: now,
              activity: assistantText,
              title: session_title
            });
          } else {
            ctx.emitEvent({
              type: "activityUpdated",
              sessionId,
              tool,
              timestamp: now,
              activity: assistantText
            });
          }
        }
        ctx.sendResponse(clientId, ACK$9);
        break;
      }
      case "PreToolUse": {
        const toolName = payload.tool_name;
        ctx.emitEvent({
          type: "toolUseStarted",
          sessionId,
          tool,
          timestamp: now,
          toolName,
          activity: toolName ? `Using ${toolName}` : "Running tool..."
        });
        ctx.sendResponse(clientId, ACK$9);
        break;
      }
      case "PostToolUse": {
        const toolName = payload.tool_name;
        if (!toolName) {
          ctx.clearStalePendingInteraction(sessionId);
        }
        const assistantText = this.latestAssistantBySession.get(sessionId);
        ctx.emitEvent({
          type: "toolUseCompleted",
          sessionId,
          tool,
          timestamp: now,
          toolName
        });
        if (assistantText) {
          ctx.emitEvent({
            type: "activityUpdated",
            sessionId,
            tool,
            timestamp: now,
            activity: assistantText
          });
        }
        ctx.sendResponse(clientId, ACK$9);
        break;
      }
      case "PermissionRequest": {
        const permId = crypto.randomUUID();
        const permissionRequest = {
          id: permId,
          sessionId,
          toolName: payload.tool_name || "unknown",
          toolInput: payload.permission_description || payload.tool_name || "",
          riskLevel: "medium"
        };
        ctx.playSoundEvent("approvalNeeded");
        ctx.emitEvent({
          type: "permissionRequested",
          sessionId,
          tool,
          timestamp: now,
          permissionRequest
        });
        ctx.setPendingPermission(sessionId, clientId, tool);
        break;
      }
      case "QuestionAsked": {
        const toolInput = payload.tool_input;
        const rawQuestions = toolInput?.questions;
        const questions = rawQuestions && rawQuestions.length > 0 ? rawQuestions.map((q, qIdx) => ({
          id: `q${qIdx}`,
          question: q.question || `Question ${qIdx + 1}`,
          type: q.multiple ? "multiple" : "single",
          choices: (q.options ?? []).map((opt, cIdx) => ({
            id: `c${qIdx}-${cIdx}`,
            label: opt.label ?? `Option ${cIdx + 1}`
          }))
        })) : [
          {
            id: "q0",
            question: payload.question_text || "OpenCode has a question",
            type: "single",
            choices: []
          }
        ];
        const questionPrompt = {
          id: crypto.randomUUID(),
          sessionId,
          questions
        };
        ctx.playSoundEvent("approvalNeeded");
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
      case "Stop": {
        ctx.updateJumpTarget(sessionId, tool);
        ctx.emitEvent({
          type: "sessionCompleted",
          sessionId,
          tool,
          timestamp: now,
          lastAssistantMessage: payload.last_assistant_message ?? this.latestAssistantBySession.get(sessionId),
          latestUserPrompt: this.latestPromptBySession.get(sessionId),
          isSessionEnd: false
        });
        ctx.playSoundEvent("taskComplete");
        ctx.sendResponse(clientId, ACK$9);
        break;
      }
      default:
        ctx.sendResponse(clientId, ACK$9);
    }
  }
  isBlockingEvent(payload) {
    return payload.hook_event_name === "PermissionRequest" || payload.hook_event_name === "QuestionAsked";
  }
}
const ACK$8 = { type: "acknowledged" };
const SARA_PROMPT_TITLE_MAX = 28;
function normalizeInlineText(text) {
  return text.replace(/\s+/g, " ").trim();
}
function buildPromptTitle(prompt) {
  const normalized = normalizeInlineText(prompt);
  if (!normalized) return void 0;
  if (normalized.length <= SARA_PROMPT_TITLE_MAX) return normalized;
  return `${normalized.slice(0, SARA_PROMPT_TITLE_MAX)}...`;
}
class SaraAdapter {
  agentId = "sara";
  latestPromptBySession = /* @__PURE__ */ new Map();
  latestAssistantBySession = /* @__PURE__ */ new Map();
  knownSessions = /* @__PURE__ */ new Set();
  explicitTitleBySession = /* @__PURE__ */ new Map();
  promptTitleBySession = /* @__PURE__ */ new Map();
  // 按终端信息分组，每个终端只保留最新的会话
  terminalToLatestSessionId = /* @__PURE__ */ new Map();
  sessionToTerminalKey = /* @__PURE__ */ new Map();
  shouldApplyTerminalLimit(payload) {
    const terminalSessionId = payload.terminal_session_id;
    const terminalTty = payload.terminal_tty;
    return !!terminalSessionId || !!terminalTty;
  }
  getTerminalKey(payload) {
    const terminalSessionId = payload.terminal_session_id;
    if (terminalSessionId) return `session:${terminalSessionId}`;
    const terminalTty = payload.terminal_tty;
    if (terminalTty) return `tty:${terminalTty}`;
    const terminalApp = payload.terminal_app;
    if (terminalApp) return `app:${terminalApp}`;
    return "unknown";
  }
  handleHook(clientId, payload, ctx) {
    const tool = this.agentId;
    const sessionId = payload.session_id;
    const now = Date.now();
    log.info("[SaraAdapter]", payload);
    const agentId = payload.agent_id;
    if (agentId) {
      ctx.sendResponse(clientId, ACK$8);
      return;
    }
    switch (payload.hook_event_name) {
      case "SessionStart": {
        const terminalKey = this.getTerminalKey(payload);
        if (this.shouldApplyTerminalLimit(payload)) {
          const previousSessionId = this.terminalToLatestSessionId.get(terminalKey);
          if (previousSessionId && previousSessionId !== sessionId) {
            log.info("[SaraAdapter] ending previous session in same terminal:", previousSessionId);
            ctx.emitEvent({
              type: "sessionCompleted",
              sessionId: previousSessionId,
              tool,
              timestamp: now,
              lastAssistantMessage: this.latestAssistantBySession.get(previousSessionId),
              latestUserPrompt: this.latestPromptBySession.get(previousSessionId),
              isSessionEnd: true
            });
            this.latestPromptBySession.delete(previousSessionId);
            this.latestAssistantBySession.delete(previousSessionId);
            this.knownSessions.delete(previousSessionId);
            this.explicitTitleBySession.delete(previousSessionId);
            this.promptTitleBySession.delete(previousSessionId);
            this.sessionToTerminalKey.delete(previousSessionId);
          }
        }
        this.terminalToLatestSessionId.set(terminalKey, sessionId);
        this.sessionToTerminalKey.set(sessionId, terminalKey);
        const { session_title = "" } = payload;
        const explicitTitle = typeof session_title === "string" ? session_title.trim() : "";
        if (explicitTitle) {
          this.explicitTitleBySession.set(sessionId, explicitTitle);
          this.promptTitleBySession.delete(sessionId);
        } else {
          this.explicitTitleBySession.delete(sessionId);
        }
        ctx.emitEvent({
          type: "sessionStarted",
          sessionId,
          tool,
          timestamp: now,
          title: explicitTitle || "Sara CLI session"
        });
        ctx.updateJumpTarget(sessionId, tool);
        ctx.sendResponse(clientId, ACK$8);
        break;
      }
      case "SessionEnd": {
        log.info("[SaraAdapter] SessionEnd received", {
          sessionId,
          hookEventName: payload.hook_event_name,
          terminalSessionId: payload.terminal_session_id,
          terminalTty: payload.terminal_tty
        });
        ctx.clearStalePendingInteraction(sessionId);
        ctx.updateJumpTarget(sessionId, tool);
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
          lastAssistantMessage: payload.last_assistant_message ?? this.latestAssistantBySession.get(sessionId),
          latestUserPrompt: this.latestPromptBySession.get(sessionId),
          isSessionEnd: true
        });
        this.latestPromptBySession.delete(sessionId);
        this.latestAssistantBySession.delete(sessionId);
        this.knownSessions.delete(sessionId);
        this.explicitTitleBySession.delete(sessionId);
        this.promptTitleBySession.delete(sessionId);
        if (this.shouldApplyTerminalLimit(payload)) {
          const terminalKey = this.sessionToTerminalKey.get(sessionId);
          if (terminalKey && this.terminalToLatestSessionId.get(terminalKey) === sessionId) {
            this.terminalToLatestSessionId.delete(terminalKey);
          }
        }
        this.sessionToTerminalKey.delete(sessionId);
        ctx.sendResponse(clientId, ACK$8);
        break;
      }
      case "UserPromptSubmit": {
        const prompt = payload.prompt || "";
        if (prompt) this.latestPromptBySession.set(sessionId, prompt);
        this.latestAssistantBySession.delete(sessionId);
        const payloadTitle = typeof payload.session_title === "string" ? payload.session_title.trim() : "";
        if (payloadTitle) {
          this.explicitTitleBySession.set(sessionId, payloadTitle);
          this.promptTitleBySession.delete(sessionId);
        }
        const isNew = !this.knownSessions.has(sessionId);
        if (isNew) this.knownSessions.add(sessionId);
        const promptPreview = prompt ? prompt.slice(0, 120) : void 0;
        const explicitTitle = this.explicitTitleBySession.get(sessionId);
        let fallbackTitle;
        if (explicitTitle) {
          fallbackTitle = explicitTitle;
        } else {
          const rememberedPromptTitle = this.promptTitleBySession.get(sessionId);
          if (rememberedPromptTitle) {
            fallbackTitle = void 0;
          } else {
            const promptTitle = buildPromptTitle(prompt);
            if (promptTitle) {
              this.promptTitleBySession.set(sessionId, promptTitle);
              fallbackTitle = promptTitle;
            }
          }
        }
        ctx.emitEvent({
          type: "sessionStarted",
          sessionId,
          tool,
          timestamp: now,
          title: fallbackTitle,
          summary: promptPreview
        });
        ctx.playSoundEvent("sessionStart");
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: "Thinking...",
          latestUserPrompt: promptPreview
        });
        ctx.sendResponse(clientId, ACK$8);
        break;
      }
      case "AssistantMessageUpdate": {
        const assistantText = payload.assistant_message_preview || "";
        const { session_title = "" } = payload;
        const explicitTitle = typeof session_title === "string" ? session_title.trim() : "";
        if (explicitTitle) {
          this.explicitTitleBySession.set(sessionId, explicitTitle);
          this.promptTitleBySession.delete(sessionId);
        }
        if (assistantText) {
          this.latestAssistantBySession.set(sessionId, assistantText);
          if (explicitTitle) {
            ctx.emitEvent({
              type: "activityUpdated",
              sessionId,
              tool,
              timestamp: now,
              activity: assistantText,
              title: explicitTitle
            });
          } else {
            ctx.emitEvent({
              type: "activityUpdated",
              sessionId,
              tool,
              timestamp: now,
              activity: assistantText
            });
          }
        }
        ctx.sendResponse(clientId, ACK$8);
        break;
      }
      case "PreToolUse": {
        const toolName = payload.tool_name;
        ctx.emitEvent({
          type: "toolUseStarted",
          sessionId,
          tool,
          timestamp: now,
          toolName,
          activity: toolName ? `Using ${toolName}` : "Running tool..."
        });
        ctx.sendResponse(clientId, ACK$8);
        break;
      }
      case "PostToolUse": {
        const toolName = payload.tool_name;
        if (!toolName) {
          ctx.clearStalePendingInteraction(sessionId);
        }
        const assistantText = this.latestAssistantBySession.get(sessionId);
        ctx.emitEvent({
          type: "toolUseCompleted",
          sessionId,
          tool,
          timestamp: now,
          toolName
        });
        if (assistantText) {
          ctx.emitEvent({
            type: "activityUpdated",
            sessionId,
            tool,
            timestamp: now,
            activity: assistantText
          });
        }
        ctx.sendResponse(clientId, ACK$8);
        break;
      }
      case "PermissionRequest": {
        const permId = crypto.randomUUID();
        const permissionRequest = {
          id: permId,
          sessionId,
          toolName: payload.tool_name || "unknown",
          toolInput: payload.permission_description || payload.tool_name || "",
          riskLevel: "medium"
        };
        ctx.playSoundEvent("approvalNeeded");
        ctx.emitEvent({
          type: "permissionRequested",
          sessionId,
          tool,
          timestamp: now,
          permissionRequest
        });
        ctx.setPendingPermission(sessionId, clientId, tool);
        break;
      }
      case "QuestionAsked": {
        const toolInput = payload.tool_input;
        const rawQuestions = toolInput?.questions;
        const questions = rawQuestions && rawQuestions.length > 0 ? rawQuestions.map((q, qIdx) => ({
          id: `q${qIdx}`,
          question: q.question || `Question ${qIdx + 1}`,
          type: q.multiple ? "multiple" : "single",
          choices: (q.options ?? []).map((opt, cIdx) => ({
            id: `c${qIdx}-${cIdx}`,
            label: opt.label ?? `Option ${cIdx + 1}`
          }))
        })) : [
          {
            id: "q0",
            question: payload.question_text || "Sara has a question",
            type: "single",
            choices: []
          }
        ];
        const questionPrompt = {
          id: crypto.randomUUID(),
          sessionId,
          questions
        };
        ctx.playSoundEvent("approvalNeeded");
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
      case "Stop": {
        ctx.updateJumpTarget(sessionId, tool);
        ctx.emitEvent({
          type: "sessionCompleted",
          sessionId,
          tool,
          timestamp: now,
          lastAssistantMessage: payload.last_assistant_message ?? this.latestAssistantBySession.get(sessionId),
          latestUserPrompt: this.latestPromptBySession.get(sessionId),
          isSessionEnd: false
        });
        ctx.playSoundEvent("taskComplete");
        ctx.sendResponse(clientId, ACK$8);
        break;
      }
      default:
        ctx.sendResponse(clientId, ACK$8);
    }
  }
  isBlockingEvent(payload) {
    return payload.hook_event_name === "PermissionRequest" || payload.hook_event_name === "QuestionAsked";
  }
}
const ACK$7 = { type: "acknowledged" };
const FALLBACK_SESSION_TITLE = "Trae Agent Session";
function summarizeToolUse(toolName, payload) {
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
function extractResponsePreview$3(raw) {
  if (typeof raw === "string") return raw.trim().slice(0, 80);
  if (raw && typeof raw === "object") {
    const obj = raw;
    const text = typeof obj.stdout === "string" && obj.stdout.trim() || typeof obj.output === "string" && obj.output.trim() || "";
    return text.replace(/\n/g, " ").slice(0, 80);
  }
  return "";
}
function inferTitleFromWorkspace(payload) {
  const cwd = typeof payload.cwd === "string" ? payload.cwd.trim() : "";
  if (cwd && cwd !== "." && cwd !== "./") return path.basename(cwd);
  const roots = Array.isArray(payload.workspace_roots) ? payload.workspace_roots : [];
  const fallbackRoot = roots.find((item) => typeof item === "string" && item.trim() !== "");
  const workspacePath = fallbackRoot?.trim() || "";
  return workspacePath ? `workspace: ${path.basename(workspacePath)}` : "";
}
const AUTO_TRIGGERED_PROMPT_PREFIXES = [
  "The code review diffs have been split into individual files"
];
const MAX_SILENT_SESSIONS = 100;
function shouldSuppressIslandSession(payload, isRemote) {
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  const promptPreview = typeof payload.prompt_preview === "string" ? payload.prompt_preview.trim() : "";
  if (AUTO_TRIGGERED_PROMPT_PREFIXES.some((prefix) => prompt.startsWith(prefix) || promptPreview.startsWith(prefix))) {
    return true;
  }
  if (!isRemote) return false;
  const toolInput = payload.tool_input;
  if (!toolInput || typeof toolInput !== "object") return false;
  const input = toolInput;
  const informationRequest = typeof input.information_request === "string" ? input.information_request.trim() : "";
  if (informationRequest === "Find recent code changes or diff files in the workspace related to agent review.") {
    return true;
  }
  const pattern = typeof input.pattern === "string" ? input.pattern.trim() : "";
  if (pattern === "/tmp/**/changed_file_tree.json") {
    return true;
  }
  const path2 = typeof input.path === "string" ? input.path.trim() : "";
  if (path2.includes("/trae-cn/agent-review") || path2.includes("/trae/agent-review")) {
    return true;
  }
  return false;
}
class TraeHookAdapter {
  agentId = "trae";
  // 已知会话集合，用于区分新旧会话
  knownSessions = /* @__PURE__ */ new Set();
  // 命中过滤规则的静默 session，保留最近 100 个，后续所有 hook 都直接忽略不上岛
  silentSessions = /* @__PURE__ */ new Set();
  // 每个会话最新的用户 prompt 缓存，供 Stop 事件引用
  latestPromptBySession = /* @__PURE__ */ new Map();
  // 已发出 permissionRequested 但尚未 resolve 的会话集合
  pendingApproval = /* @__PURE__ */ new Set();
  handleHook(clientId, payload, ctx) {
    const tool = payload._source || this.agentId;
    const sessionId = payload.session_id;
    const now = Date.now();
    if (sessionId && this.silentSessions.has(sessionId)) {
      ctx.sendResponse(clientId, ACK$7);
      return;
    }
    if (shouldSuppressIslandSession(payload, ctx.isRemote === true)) {
      this.rememberSilentSession(sessionId);
      this.resolveApprovalIfPending(sessionId, tool, ctx);
      this.removeIgnoredSessionFromIsland(sessionId, tool, ctx, now);
      ctx.sendResponse(clientId, ACK$7);
      return;
    }
    if (sessionId && CocoAdapter.hookCoveredSessions.has(sessionId)) {
      ctx.sendResponse(clientId, ACK$7);
      return;
    }
    switch (payload.hook_event_name) {
      case "SessionStart": {
        const title = inferTitleFromWorkspace(payload) || FALLBACK_SESSION_TITLE;
        this.knownSessions.add(sessionId);
        ctx.emitEvent({
          type: "sessionStarted",
          sessionId,
          tool,
          timestamp: now,
          title
        });
        ctx.updateJumpTarget(sessionId, tool);
        ctx.sendResponse(clientId, ACK$7);
        break;
      }
      case "UserPromptSubmit": {
        const prompt = payload.prompt || payload.prompt_preview || "";
        if (prompt) this.latestPromptBySession.set(sessionId, prompt);
        const isNew = !this.knownSessions.has(sessionId);
        if (isNew) this.knownSessions.add(sessionId);
        const title = inferTitleFromWorkspace(payload) || FALLBACK_SESSION_TITLE;
        ctx.emitEvent({
          type: "sessionStarted",
          sessionId,
          tool,
          timestamp: now,
          title,
          latestUserPrompt: prompt?.slice(0, 120)
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
        ctx.sendResponse(clientId, ACK$7);
        break;
      }
      case "PreToolUse": {
        this.maybeEmitTitleFixup(sessionId, tool, now, payload, ctx);
        const toolName = payload.tool_name || "Tool";
        const activity = summarizeToolUse(toolName, payload);
        ctx.emitEvent({
          type: "toolUseStarted",
          sessionId,
          tool,
          timestamp: now,
          activity
        });
        ctx.sendResponse(clientId, ACK$7);
        break;
      }
      case "PostToolUse": {
        this.maybeEmitTitleFixup(sessionId, tool, now, payload, ctx);
        this.resolveApprovalIfPending(sessionId, tool, ctx);
        ctx.clearStalePendingInteraction(sessionId);
        const toolName = payload.tool_name || "Tool";
        const preview = extractResponsePreview$3(payload.tool_response);
        const activity = preview ? `${toolName}: ${preview}` : `${toolName} done`;
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity
        });
        ctx.sendResponse(clientId, ACK$7);
        break;
      }
      case "Stop": {
        this.resolveApprovalIfPending(sessionId, tool, ctx);
        ctx.updateJumpTarget(sessionId, tool);
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool,
          timestamp: now,
          activity: ""
        });
        const lastAssistantMessage = payload.text_content ?? payload.last_assistant_message;
        ctx.emitEvent({
          type: "sessionCompleted",
          sessionId,
          tool,
          timestamp: now,
          lastAssistantMessage,
          latestUserPrompt: this.latestPromptBySession.get(sessionId),
          isSessionEnd: false
        });
        ctx.playSoundEvent("taskComplete");
        ctx.sendResponse(clientId, ACK$7);
        break;
      }
      case "Notification": {
        const notificationType = payload.notification_type;
        const message = payload.message;
        if (notificationType === "permission_prompt") {
          this.pendingApproval.add(sessionId);
          ctx.emitEvent({
            type: "permissionRequested",
            sessionId,
            tool,
            timestamp: now,
            permissionRequest: {
              id: `trae-notif-${sessionId}-${now}`,
              sessionId,
              toolName: "Trae",
              toolInput: message || i18n.k1613623663({}, "由于 Code Agent 限制，请在 Trae 中确认操作"),
              riskLevel: "medium",
              approvalMode: "terminalNative"
            }
          });
          ctx.setPendingPermission(sessionId, clientId, tool, {
            approvalMode: "terminalNative",
            disconnectPolicy: "preserveOnDisconnect",
            responseChannelClosedAt: Date.now()
          });
          ctx.playSoundEvent("approvalNeeded");
        } else if (notificationType === "ask_user_question") {
          ctx.emitEvent({
            type: "activityUpdated",
            sessionId,
            tool,
            timestamp: now,
            activity: i18n.k3494688136({}, "由于 Code Agent 限制，请在 Trae 中回答问题")
          });
          ctx.emitEvent({
            type: "questionAsked",
            sessionId,
            tool,
            timestamp: now
          });
          ctx.setPendingQuestion(sessionId, clientId, tool);
          ctx.playSoundEvent("approvalNeeded");
        } else if (notificationType === "document_review") {
          ctx.emitEvent({
            type: "activityUpdated",
            sessionId,
            tool,
            timestamp: now,
            activity: i18n.k2102958132({}, "由于 Code Agent 限制，请在 Trae 中审阅文档")
          });
          ctx.emitEvent({
            type: "questionAsked",
            sessionId,
            tool,
            timestamp: now
          });
          ctx.setPendingQuestion(sessionId, clientId, tool);
          ctx.playSoundEvent("approvalNeeded");
        }
        ctx.sendResponse(clientId, ACK$7);
        break;
      }
      default:
        ctx.sendResponse(clientId, ACK$7);
    }
  }
  // Trae 目前没有 PermissionRequest hook，所有事件均为非阻塞
  isBlockingEvent(_payload) {
    return false;
  }
  /** 运行中会话如果错过启动事件，用工具事件里携带的 cwd/workspace_roots 补一次标题。 */
  maybeEmitTitleFixup(sessionId, tool, timestamp, payload, ctx) {
    if (!sessionId) return;
    const currentTitle = ctx.getSessionTitle?.(sessionId)?.trim();
    if (currentTitle && currentTitle !== FALLBACK_SESSION_TITLE) return;
    const title = inferTitleFromWorkspace(payload);
    if (!title) return;
    ctx.emitEvent({
      type: "traeIdeTitleUpdated",
      sessionId,
      tool,
      timestamp,
      title
    });
  }
  /** 如果已经发出过 permissionRequested，则发 permissionResolved 清除审批态 */
  resolveApprovalIfPending(sessionId, tool, ctx) {
    if (this.pendingApproval.has(sessionId)) {
      this.pendingApproval.delete(sessionId);
      ctx.emitEvent({
        type: "permissionResolved",
        sessionId,
        tool,
        timestamp: Date.now()
      });
    }
  }
  /** 把命中过滤规则的 session 记入最近 100 个静默集合，后续所有 hook 都直接忽略。 */
  rememberSilentSession(sessionId) {
    if (!sessionId) return;
    this.silentSessions.delete(sessionId);
    this.silentSessions.add(sessionId);
    while (this.silentSessions.size > MAX_SILENT_SESSIONS) {
      const oldestSessionId = this.silentSessions.values().next().value;
      if (!oldestSessionId) break;
      this.silentSessions.delete(oldestSessionId);
    }
  }
  /** 命中过滤规则后，立刻把该 session 从岛上删除，并清理本地缓存状态。 */
  removeIgnoredSessionFromIsland(sessionId, tool, ctx, timestamp) {
    if (!sessionId) return;
    this.knownSessions.delete(sessionId);
    this.latestPromptBySession.delete(sessionId);
    this.pendingApproval.delete(sessionId);
    ctx.emitEvent({
      type: "sessionDeleted",
      sessionId,
      tool,
      timestamp
    });
  }
}
const ACK$6 = { type: "acknowledged" };
function stripCwd$1(filePath, cwd) {
  if (!cwd) return filePath;
  const prefix = cwd.endsWith("/") ? cwd : cwd + "/";
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
}
function extractResponsePreview$2(raw) {
  if (typeof raw === "string") return raw.trim().slice(0, 80);
  if (raw && typeof raw === "object") {
    const obj = raw;
    const text = typeof obj.stdout === "string" && obj.stdout.trim() || typeof obj.output === "string" && obj.output.trim() || "";
    return text.replace(/\n/g, " ").slice(0, 80);
  }
  return "";
}
function summarizeToolInput$3(payload) {
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
function buildCodeDiffFromToolInput(toolName, payload) {
  const rawInput = payload.tool_input;
  if (!rawInput || typeof rawInput !== "object") return [];
  const input = rawInput;
  const cwd = typeof payload.cwd === "string" ? payload.cwd : "";
  if (toolName === "StrReplaceFile") {
    const filePath = typeof input.path === "string" ? input.path : "";
    const edit = input.edit;
    if (!filePath || !edit) return [];
    const oldContent = typeof edit.old === "string" ? edit.old : "";
    const newContent = typeof edit.new === "string" ? edit.new : "";
    if (!oldContent && !newContent) return [];
    return [{ fileName: stripCwd$1(filePath, cwd), oldContent, newContent }];
  }
  if (toolName === "WriteFile") {
    const filePath = typeof input.path === "string" ? input.path : "";
    const content = typeof input.content === "string" ? input.content : "";
    if (!filePath || !content) return [];
    return [{ fileName: stripCwd$1(filePath, cwd), oldContent: "", newContent: content }];
  }
  return [];
}
function buildQuestionPrompt$1(payload, sessionId) {
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
function toolRiskLevel$2(toolName) {
  const high = /* @__PURE__ */ new Set([
    "ExitPlanMode",
    "EnterPlanMode",
    "AskUserQuestion",
    "Shell",
    "WriteFile",
    "StrReplaceFile",
    "TaskStop",
    "MCPTool",
    "PluginTool"
  ]);
  if (high.has(toolName)) return "high";
  return "low";
}
class KimiAdapter {
  agentId = "kimi";
  // 细粒度管理：记录每个 sessionId 下正在等待原生审批的 tool_call_id 集合
  activeNativeApprovals = /* @__PURE__ */ new Map();
  handleHook(clientId, payload, ctx) {
    const eventName = payload.hook_event_name;
    if (!eventName) {
      ctx.sendResponse(clientId, ACK$6);
      return;
    }
    const sessionId = payload.session_id || "kimi-unknown";
    const timestamp = Date.now();
    if (eventName !== "SessionStart") {
      ctx.updateJumpTarget(sessionId, "kimi");
    }
    const baseEvent = {
      sessionId,
      tool: "kimi",
      timestamp,
      remoteHost: typeof payload._hostname === "string" ? payload._hostname : void 0
    };
    switch (eventName) {
      case "SessionStart":
        ctx.sendResponse(clientId, ACK$6);
        break;
      case "SessionEnd":
        this.activeNativeApprovals.delete(sessionId);
        ctx.clearStalePendingInteraction(sessionId);
        ctx.emitEvent({
          ...baseEvent,
          type: "activityUpdated",
          activity: ""
        });
        ctx.emitEvent({
          ...baseEvent,
          type: "sessionCompleted",
          isSessionEnd: true,
          summary: `Session ended (${payload.reason || "unknown"})`
        });
        ctx.sendResponse(clientId, ACK$6);
        break;
      case "UserPromptSubmit": {
        const prompt = typeof payload.prompt === "string" && payload.prompt.trim() !== "" ? payload.prompt : "";
        ctx.emitEvent({
          ...baseEvent,
          type: "sessionStarted",
          title: payload.cwd?.split("/").pop() || "Kimi Code CLI",
          latestUserPrompt: prompt,
          summary: prompt.slice(0, 120),
          isSessionEnd: false
          // 显式重置结束状态
        });
        ctx.updateJumpTarget(sessionId, "kimi");
        ctx.playSoundEvent("sessionStart");
        ctx.emitEvent({
          ...baseEvent,
          type: "activityUpdated",
          activity: "Thinking...",
          latestUserPrompt: prompt
        });
        ctx.sendResponse(clientId, ACK$6);
        break;
      }
      case "Stop":
        this.activeNativeApprovals.delete(sessionId);
        ctx.clearStalePendingInteraction(sessionId);
        ctx.emitEvent({
          ...baseEvent,
          type: "activityUpdated",
          activity: ""
        });
        ctx.emitEvent({
          ...baseEvent,
          type: "sessionCompleted",
          summary: "Turn completed",
          isSessionEnd: false
        });
        ctx.playSoundEvent("taskComplete");
        ctx.sendResponse(clientId, ACK$6);
        break;
      case "StopFailure":
        this.activeNativeApprovals.delete(sessionId);
        ctx.clearStalePendingInteraction(sessionId);
        ctx.emitEvent({
          ...baseEvent,
          type: "activityUpdated",
          activity: ""
        });
        ctx.emitEvent({
          ...baseEvent,
          type: "sessionCompleted",
          error: payload.error_type || "Error",
          errorDetail: payload.error_message || "Turn failed",
          isSessionEnd: false
        });
        ctx.playSoundEvent("taskError");
        ctx.sendResponse(clientId, ACK$6);
        break;
      case "PreToolUse": {
        const toolName = payload.tool_name || "unknown";
        let activity = summarizeToolInput$3(payload);
        if (toolName === "Shell") {
          const rawInput = payload.tool_input;
          if (rawInput && typeof rawInput === "object") {
            const input = rawInput;
            if (typeof input.command === "string") {
              activity = input.command;
            }
          }
        }
        ctx.emitEvent({
          ...baseEvent,
          type: "toolUseStarted",
          toolName,
          activity
        });
        const risk = toolRiskLevel$2(toolName);
        if (risk === "low") {
          ctx.sendResponse(clientId, ACK$6);
          break;
        }
        if (toolName === "AskUserQuestion") {
          const questionPrompt = buildQuestionPrompt$1(payload, sessionId);
          if (!questionPrompt) {
            log.warn(`[KimiAdapter] AskUserQuestion missing questions, fallback to ACK. session=${sessionId}`);
            ctx.sendResponse(clientId, ACK$6);
            break;
          }
          if (questionPrompt) {
            ctx.playSoundEvent("approvalNeeded");
            ctx.emitEvent({
              ...baseEvent,
              type: "questionAsked",
              questionPrompt
            });
            ctx.sendResponse(clientId, ACK$6);
            ctx.setPendingQuestion(
              sessionId,
              clientId,
              "kimi",
              { disconnectPolicy: "preserveOnDisconnect" },
              payload
            );
            const toolCallId = payload.tool_call_id || `fallback-${timestamp}`;
            let pendingSet = this.activeNativeApprovals.get(sessionId);
            if (!pendingSet) {
              pendingSet = /* @__PURE__ */ new Set();
              this.activeNativeApprovals.set(sessionId, pendingSet);
            }
            pendingSet.add(toolCallId);
            break;
          }
        }
        const mode = "terminalNative";
        const codeDiff = buildCodeDiffFromToolInput(toolName, payload);
        const req = {
          id: payload.tool_call_id || `kimi-${timestamp}`,
          sessionId,
          toolName,
          toolInput: activity,
          riskLevel: risk,
          approvalMode: mode,
          ...codeDiff.length > 0 && { codeDiff }
        };
        ctx.playSoundEvent("approvalNeeded");
        ctx.emitEvent({
          ...baseEvent,
          type: "permissionRequested",
          permissionRequest: req
        });
        {
          ctx.sendResponse(clientId, ACK$6);
          ctx.setPendingPermission(
            sessionId,
            clientId,
            "kimi",
            { disconnectPolicy: "preserveOnDisconnect", approvalMode: mode },
            payload
          );
          const toolCallId = payload.tool_call_id || `fallback-${timestamp}`;
          let pendingSet = this.activeNativeApprovals.get(sessionId);
          if (!pendingSet) {
            pendingSet = /* @__PURE__ */ new Set();
            this.activeNativeApprovals.set(sessionId, pendingSet);
          }
          pendingSet.add(toolCallId);
        }
        break;
      }
      case "PostToolUse":
      case "PostToolUseFailure": {
        const toolName = payload.tool_name || "unknown";
        const toolCallId = payload.tool_call_id || "";
        const pendingSet = this.activeNativeApprovals.get(sessionId);
        const isNativeApproval = toolRiskLevel$2(toolName) === "high";
        if (isNativeApproval && toolCallId && pendingSet?.has(toolCallId)) {
          pendingSet.delete(toolCallId);
          if (pendingSet.size === 0) {
            this.activeNativeApprovals.delete(sessionId);
            ctx.clearStalePendingInteraction(sessionId);
          }
        } else {
          if (!pendingSet || pendingSet.size === 0) {
            ctx.clearStalePendingInteraction(sessionId);
          }
        }
        const rawOutput = payload.tool_output || payload.error;
        const preview = extractResponsePreview$2(rawOutput);
        const activity = preview ? `${toolName}: ${preview}` : `${toolName} done`;
        ctx.emitEvent({
          ...baseEvent,
          type: "toolUseCompleted",
          toolName,
          activity: preview || void 0
        });
        ctx.emitEvent({
          ...baseEvent,
          type: "activityUpdated",
          activity
        });
        ctx.sendResponse(clientId, ACK$6);
        break;
      }
      case "SubagentStart": {
        const agentName = payload.agent_name || "Subagent";
        const prompt = payload.prompt || "";
        const subInfo = {
          agentId: agentName,
          agentType: "Kimi Subagent",
          taskDescription: prompt,
          startedAt: timestamp
        };
        ctx.emitEvent({
          ...baseEvent,
          type: "subagentStarted",
          subAgentInfo: subInfo
        });
        ctx.sendResponse(clientId, ACK$6);
        break;
      }
      case "SubagentStop": {
        const agentName = payload.agent_name || "Subagent";
        const responseStr = payload.response || "";
        const subInfo = {
          agentId: agentName,
          startedAt: timestamp,
          lastToolActivity: responseStr
        };
        ctx.emitEvent({
          ...baseEvent,
          type: "subagentStopped",
          subAgentInfo: subInfo
        });
        ctx.sendResponse(clientId, ACK$6);
        break;
      }
      case "Notification":
        ctx.sendResponse(clientId, ACK$6);
        break;
      case "PreCompact":
      case "PostCompact":
        ctx.sendResponse(clientId, ACK$6);
        break;
      default:
        ctx.sendResponse(clientId, ACK$6);
        break;
    }
  }
  isBlockingEvent(payload) {
    return payload.hook_event_name === "PreToolUse" && toolRiskLevel$2(payload.tool_name || "unknown") === "high";
  }
}
const ACK$5 = { type: "acknowledged" };
function readLastAssistantMessage$1(transcriptPath) {
  if (!transcriptPath) return void 0;
  try {
    return findLastMatchingLineSync(transcriptPath, (line) => {
      try {
        const obj = JSON.parse(line);
        if (obj.type === "assistant.message" && typeof obj.data?.content === "string") {
          return obj.data.content;
        }
      } catch {
      }
      return void 0;
    });
  } catch {
    return void 0;
  }
}
function extractToolName(payload) {
  return payload.toolName || payload.tool_name || "unknown";
}
function getRawToolArgs(payload) {
  return payload.toolArgs ?? payload.tool_args;
}
function parseToolArgs(payload) {
  const raw = getRawToolArgs(payload);
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
function normalizeToolName$1(rawToolName) {
  const toolName = rawToolName.trim().toLowerCase();
  const names = {
    ask_user: "AskUser",
    report_intent: "ReportIntent",
    view: "View",
    glob: "Glob",
    grep: "Grep",
    rg: "Grep",
    bash: "Bash",
    powershell: "PowerShell",
    create: "Create",
    edit: "Edit",
    apply_batch: "Edit",
    apply_patch: "Edit",
    task: "Task",
    skill: "Skill",
    web_fetch: "WebFetch",
    read_bash: "ReadBash",
    read_powershell: "ReadPowerShell",
    write_bash: "WriteBash",
    write_powershell: "WritePowerShell",
    stop_bash: "StopBash",
    stop_powershell: "StopPowerShell",
    list_bash: "ListBash",
    list_powershell: "ListPowerShell",
    read_agent: "ReadAgent",
    list_agents: "ListAgents"
  };
  return names[toolName] ?? rawToolName ?? "unknown";
}
function pickString$4(obj, keys) {
  if (!obj) return "";
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}
function pickNestedPath(args) {
  if (!args) return "";
  for (const key of ["edits", "operations", "changes", "files", "batch"]) {
    const items = args[key];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const path2 = pickString$4(item, ["path", "file_path"]);
      if (path2) return path2;
    }
  }
  return "";
}
function summarizeToolInput$2(toolName, args) {
  const normalized = normalizeToolName$1(toolName);
  switch (normalized) {
    case "Bash":
    case "PowerShell":
      return pickString$4(args, ["command", "description"]);
    case "View":
    case "Glob":
    case "Create":
    case "Edit":
      return pickString$4(args, ["path", "file_path", "description"]) || pickNestedPath(args);
    case "Grep":
      return pickString$4(args, ["pattern", "query", "regex", "description"]);
    case "ReportIntent":
      return pickString$4(args, ["intent", "description"]);
    case "WebFetch":
      return pickString$4(args, ["url", "description"]);
    case "Task":
    case "Skill":
      return pickString$4(args, ["description", "task", "name"]);
    default:
      return pickString$4(args, ["command", "path", "file_path", "pattern", "description", "intent"]);
  }
}
function summarizeToolActivity(toolName, args) {
  const normalized = normalizeToolName$1(toolName);
  const input = summarizeToolInput$2(toolName, args);
  if (!input) return `Using ${normalized}`;
  if (normalized === "Bash" || normalized === "PowerShell") {
    return `${normalized}: ${input}`;
  }
  if (normalized === "ReportIntent") {
    return `Intent: ${input}`;
  }
  if (normalized === "Grep") {
    return `Searching ${input}`;
  }
  return `${normalized}(${input})`;
}
function stripCwd(filePath, cwd) {
  if (!cwd) return filePath;
  const prefix = cwd.endsWith("/") ? cwd : cwd + "/";
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
}
function extractFilePathFromPatchHeader(line) {
  return line.replace(/^\*\*\* (?:Update|Add) File:\s*/, "").replace(/\s+\(renamed from .+\)$/, "").trim();
}
function appendPatchChunk(diffs, fileName, oldLines, newLines) {
  if (!fileName) return;
  diffs.push({
    fileName,
    oldContent: oldLines.join("\n"),
    newContent: newLines.join("\n")
  });
}
function buildCodeDiffFromPatch(rawPatch, cwd) {
  if (!rawPatch.includes("*** Begin Patch")) return [];
  const diffs = [];
  const lines = rawPatch.split("\n");
  let currentFile = "";
  let oldLines = [];
  let newLines = [];
  let mode = "";
  const flush = () => {
    if (!currentFile) return;
    appendPatchChunk(diffs, stripCwd(currentFile, cwd), oldLines, newLines);
    currentFile = "";
    oldLines = [];
    newLines = [];
    mode = "";
  };
  for (const line of lines) {
    if (line.startsWith("*** Update File: ")) {
      flush();
      currentFile = extractFilePathFromPatchHeader(line);
      mode = "update";
      continue;
    }
    if (line.startsWith("*** Add File: ")) {
      flush();
      currentFile = extractFilePathFromPatchHeader(line);
      mode = "add";
      continue;
    }
    if (line === "*** End Patch" || line === "*** End of File") {
      continue;
    }
    if (!currentFile) continue;
    if (line.startsWith("@@")) continue;
    if (mode === "add") {
      if (line.startsWith("+")) newLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith(" ")) {
      const content = line.slice(1);
      oldLines.push(content);
      newLines.push(content);
      continue;
    }
    if (line.startsWith("-")) {
      oldLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith("+")) {
      newLines.push(line.slice(1));
    }
  }
  flush();
  return diffs;
}
const CONTEXT_LINES = 2;
function addFileContext(filePath, oldString, newString) {
  try {
    const fileContent = fs.readFileSync(filePath, "utf-8");
    const idx = oldString ? fileContent.indexOf(oldString) : -1;
    if (idx === -1) return { oldContent: oldString, newContent: newString };
    const lines = fileContent.split("\n");
    const beforeLen = fileContent.slice(0, idx).split("\n").length - 1;
    const matchLineCount = oldString.split("\n").length;
    const startLine = Math.max(0, beforeLen - CONTEXT_LINES);
    const endLine = Math.min(lines.length, beforeLen + matchLineCount + CONTEXT_LINES);
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
function extractDiffEntry(entry, cwd) {
  const filePath = pickString$4(entry, ["path", "file_path"]);
  if (!filePath) return null;
  const oldString = pickString$4(entry, ["old_string", "oldString", "old", "before"]);
  const newString = pickString$4(entry, ["new_string", "newString", "new", "after", "content", "replacement"]);
  if (!oldString && !newString) return null;
  const { oldContent, newContent } = addFileContext(filePath, oldString, newString);
  return {
    fileName: stripCwd(filePath, cwd),
    oldContent,
    newContent
  };
}
function buildCodeDiffFromToolArgs(toolName, args, cwd) {
  if (!args) return [];
  const normalized = normalizeToolName$1(toolName);
  if (normalized === "Create") {
    const filePath = pickString$4(args, ["path", "file_path"]);
    const content = pickString$4(args, ["content", "new_string", "newString"]);
    if (!filePath || !content) return [];
    return [{ fileName: stripCwd(filePath, cwd), oldContent: "", newContent: content }];
  }
  if (normalized === "Edit") {
    const topLevel = extractDiffEntry(args, cwd);
    if (topLevel) return [topLevel];
    for (const key of ["edits", "operations", "changes", "files", "batch"]) {
      const items = args[key];
      if (!Array.isArray(items)) continue;
      const diffs = items.filter((item) => !!item && typeof item === "object").map((item) => extractDiffEntry(item, cwd)).filter((item) => item !== null);
      if (diffs.length > 0) return diffs;
    }
  }
  return [];
}
function summarizePatchInput(rawPatch, cwd) {
  const diffs = buildCodeDiffFromPatch(rawPatch, cwd);
  if (diffs.length === 0) return "";
  return diffs.map((diff2) => diff2.fileName).join(", ");
}
function toolRiskLevel$1(toolName) {
  const normalized = normalizeToolName$1(toolName);
  const readOnly = /* @__PURE__ */ new Set([
    "View",
    "Glob",
    "Grep",
    "ReadBash",
    "ReadPowerShell",
    "ListBash",
    "ListPowerShell",
    "ReadAgent",
    "ListAgents",
    "ReportIntent",
    "Bash",
    "PowerShell"
  ]);
  const high = /* @__PURE__ */ new Set([
    "WriteBash",
    "WritePowerShell",
    "StopBash",
    "StopPowerShell",
    "WebFetch",
    "Task",
    "Skill"
  ]);
  if (readOnly.has(normalized)) return "low";
  if (high.has(normalized)) return "high";
  return "medium";
}
function shouldBridgeApproval(toolName) {
  return toolRiskLevel$1(toolName) !== "low";
}
function buildPermissionRequest$1(sessionId, toolName, toolInput, codeDiff, approvalMode) {
  return {
    id: crypto.randomUUID(),
    sessionId,
    toolName: normalizeToolName$1(toolName),
    toolInput,
    riskLevel: toolRiskLevel$1(toolName),
    approvalMode,
    ...codeDiff.length > 0 ? { codeDiff } : {}
  };
}
function buildAskUserQuestionPrompt(payload, sessionId) {
  const raw = payload.toolArgs || payload.tool_args;
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    const question = typeof parsed.question === "string" ? parsed.question : "";
    if (!question) return null;
    const rawChoices = Array.isArray(parsed.choices) ? parsed.choices : [];
    const choices = rawChoices.map((c) => ({
      id: crypto.randomUUID(),
      label: typeof c === "string" ? c : String(c)
    }));
    return {
      id: crypto.randomUUID(),
      sessionId,
      questions: [
        {
          id: crypto.randomUUID(),
          question,
          type: "single",
          choices
        }
      ]
    };
  } catch {
    return null;
  }
}
class CopilotCliAdapter {
  agentId = "copilot-cli";
  /** 缓存每个 session 最新的用户 prompt，供 agentStop 时填入 CompletionCard 标题 */
  latestPromptBySession = /* @__PURE__ */ new Map();
  handleHook(clientId, payload, ctx) {
    const eventName = payload.hook_event_name || payload.event_type || "";
    if (!eventName) {
      ctx.sendResponse(clientId, ACK$5);
      return;
    }
    const sessionId = payload.session_id || payload.sessionId || `copilot-cli-${payload.cwd || "unknown"}`;
    const timestamp = Date.now();
    const baseEvent = {
      sessionId,
      tool: "copilot-cli",
      timestamp,
      remoteHost: typeof payload._hostname === "string" ? payload._hostname : void 0
    };
    if (eventName !== "sessionStart") {
      ctx.updateJumpTarget(sessionId, "copilot-cli");
    }
    switch (eventName) {
      case "sessionStart": {
        const cwd = payload.cwd || "";
        const title = cwd.split("/").pop() || "GitHub Copilot CLI";
        const prompt = payload.initialPrompt || "";
        if (prompt) this.latestPromptBySession.set(sessionId, prompt);
        ctx.emitEvent({
          ...baseEvent,
          type: "sessionStarted",
          title,
          latestUserPrompt: prompt,
          summary: prompt.slice(0, 120),
          isSessionEnd: false
        });
        ctx.updateJumpTarget(sessionId, "copilot-cli");
        ctx.playSoundEvent("sessionStart");
        ctx.emitEvent({
          ...baseEvent,
          type: "activityUpdated",
          activity: "Thinking...",
          latestUserPrompt: prompt
        });
        ctx.sendResponse(clientId, ACK$5);
        break;
      }
      case "sessionEnd": {
        ctx.clearStalePendingInteraction(sessionId);
        ctx.emitEvent({
          ...baseEvent,
          type: "activityUpdated",
          activity: ""
        });
        const reason = payload.reason || "unknown";
        const isError = reason === "error" || reason === "timeout";
        ctx.emitEvent({
          ...baseEvent,
          type: "sessionCompleted",
          isSessionEnd: true,
          summary: `Session ended (${reason})`,
          ...isError ? { error: reason } : {}
        });
        if (isError) {
          ctx.playSoundEvent("taskError");
        }
        this.latestPromptBySession.delete(sessionId);
        ctx.sendResponse(clientId, ACK$5);
        break;
      }
      case "userPromptSubmitted": {
        const prompt = payload.prompt || "";
        const cwd = payload.cwd || "";
        const title = cwd.split("/").pop() || "GitHub Copilot CLI";
        if (prompt) this.latestPromptBySession.set(sessionId, prompt);
        ctx.emitEvent({
          ...baseEvent,
          type: "sessionStarted",
          title,
          latestUserPrompt: prompt,
          summary: prompt.slice(0, 120),
          isSessionEnd: false
        });
        ctx.updateJumpTarget(sessionId, "copilot-cli");
        ctx.emitEvent({
          ...baseEvent,
          type: "activityUpdated",
          activity: "Thinking...",
          latestUserPrompt: prompt
        });
        ctx.sendResponse(clientId, ACK$5);
        break;
      }
      case "preToolUse": {
        const rawToolName = extractToolName(payload);
        if (rawToolName === "ask_user" || rawToolName === "AskUserQuestion" || rawToolName === "AskUserQuestions") {
          const questionPrompt = buildAskUserQuestionPrompt(payload, sessionId);
          if (questionPrompt) {
            ctx.playSoundEvent("approvalNeeded");
            ctx.emitEvent({
              ...baseEvent,
              type: "questionAsked",
              questionPrompt
            });
            ctx.sendResponse(clientId, ACK$5);
            ctx.setPendingQuestion(sessionId, clientId, "copilot-cli", { disconnectPolicy: "preserveOnDisconnect" });
            break;
          }
          ctx.sendResponse(clientId, ACK$5);
          break;
        }
        const rawArgs = getRawToolArgs(payload);
        const args = parseToolArgs(payload);
        const normalizedToolName = normalizeToolName$1(rawToolName);
        const cwd = payload.cwd || "";
        const patchInput = typeof rawArgs === "string" && normalizedToolName === "Edit" ? summarizePatchInput(rawArgs, cwd) : "";
        const activity = patchInput ? `${normalizedToolName}(${patchInput})` : summarizeToolActivity(rawToolName, args);
        const permissionInput = patchInput || summarizeToolInput$2(rawToolName, args) || activity;
        const codeDiff = typeof rawArgs === "string" && normalizedToolName === "Edit" ? buildCodeDiffFromPatch(rawArgs, cwd) : buildCodeDiffFromToolArgs(rawToolName, args, cwd);
        const approvalMode = ctx.getApprovalMode("copilot-cli");
        ctx.emitEvent({
          ...baseEvent,
          type: "toolUseStarted",
          toolName: normalizedToolName,
          activity
        });
        if (!shouldBridgeApproval(rawToolName)) {
          ctx.sendResponse(clientId, {
            type: "hookDirective",
            directive: { permissionDecision: "allow" }
          });
          break;
        }
        ctx.playSoundEvent("approvalNeeded");
        ctx.emitEvent({
          ...baseEvent,
          type: "permissionRequested",
          permissionRequest: buildPermissionRequest$1(sessionId, rawToolName, permissionInput, codeDiff, approvalMode)
        });
        if (approvalMode === "bridge") {
          ctx.setPendingPermission(
            sessionId,
            clientId,
            "copilot-cli",
            { disconnectPolicy: "resolveOnDisconnect", approvalMode: "bridge" },
            payload
          );
        } else {
          ctx.sendResponse(clientId, ACK$5);
          ctx.setPendingPermission(
            sessionId,
            clientId,
            "copilot-cli",
            {
              disconnectPolicy: "preserveOnDisconnect",
              approvalMode: "terminalNative",
              responseChannelClosedAt: Date.now()
            },
            payload
          );
        }
        break;
      }
      case "postToolUse": {
        ctx.clearStalePendingInteraction(sessionId);
        const toolName = extractToolName(payload);
        const result = payload.toolResult;
        const resultType = result?.resultType || "";
        const preview = typeof result?.textResultForLlm === "string" ? result.textResultForLlm.slice(0, 80).replace(/\n/g, " ") : "";
        const activity = preview ? `${toolName}: ${preview}` : `${toolName} done`;
        ctx.emitEvent({
          ...baseEvent,
          type: "toolUseCompleted",
          toolName,
          activity: preview || void 0
        });
        ctx.emitEvent({
          ...baseEvent,
          type: "activityUpdated",
          activity
        });
        if (resultType === "failure") {
          ctx.playSoundEvent("taskError");
        }
        ctx.sendResponse(clientId, ACK$5);
        break;
      }
      case "agentStop": {
        ctx.clearStalePendingInteraction(sessionId);
        ctx.emitEvent({
          ...baseEvent,
          type: "activityUpdated",
          activity: ""
        });
        const transcriptPath = payload.transcriptPath;
        const lastAssistantMessage = readLastAssistantMessage$1(transcriptPath);
        ctx.emitEvent({
          ...baseEvent,
          type: "sessionCompleted",
          summary: lastAssistantMessage?.slice(0, 120) || "Turn completed",
          latestUserPrompt: this.latestPromptBySession.get(sessionId),
          lastAssistantMessage,
          isSessionEnd: false
        });
        ctx.playSoundEvent("taskComplete");
        ctx.sendResponse(clientId, ACK$5);
        break;
      }
      case "subagentStop": {
        ctx.emitEvent({
          ...baseEvent,
          type: "activityUpdated",
          activity: ""
        });
        ctx.sendResponse(clientId, ACK$5);
        break;
      }
      case "errorOccurred": {
        ctx.clearStalePendingInteraction(sessionId);
        const err = payload.error;
        const errMsg = err?.message || "Unknown error";
        const errName = err?.name || "Error";
        ctx.emitEvent({
          ...baseEvent,
          type: "activityUpdated",
          activity: ""
        });
        ctx.emitEvent({
          ...baseEvent,
          type: "sessionCompleted",
          error: errName,
          errorDetail: errMsg,
          isSessionEnd: false
        });
        ctx.playSoundEvent("taskError");
        ctx.sendResponse(clientId, ACK$5);
        break;
      }
      default:
        ctx.sendResponse(clientId, ACK$5);
        break;
    }
  }
  isBlockingEvent(payload) {
    const eventName = payload.hook_event_name || payload.event_type || "";
    return eventName === "preToolUse";
  }
}
class TraeWorkHookAdapter extends TraeHookAdapter {
  agentId = "traework";
}
module.exports = {
  CocoAdapter,
  CursorAdapter,
  OpenCodeAdapter,
  SaraAdapter,
  TraeHookAdapter,
  TraeWorkHookAdapter,
  KimiAdapter,
  CopilotCliAdapter
};
