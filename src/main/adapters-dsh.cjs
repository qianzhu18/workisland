"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const ACK = { type: "acknowledged" };

class DeepSeekHarnessAdapter {
  agentId = "dsh";
  latestPromptBySession = new Map();
  handleHook(clientId, payload, ctx) {
    const sessionId = payload.session_id;
    const now = Date.now();
    if (!sessionId) return ctx.sendResponse(clientId, ACK);
    const tool = "dsh";
    if (typeof payload.dsh_url === "string" && payload.dsh_url.startsWith("http://127.0.0.1:")) {
      ctx.updateJumpTarget(sessionId, tool, { terminal_app: "dsh", url: payload.dsh_url });
    }
    if (payload.hook_event_name === "SessionStart") {
      ctx.emitEvent({ type: "sessionStarted", sessionId, tool, timestamp: now, title: path.basename(payload.cwd || "DeepSeek Harness") });
    } else if (payload.hook_event_name === "UserPromptSubmit") {
      const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
      this.latestPromptBySession.set(sessionId, prompt);
      ctx.emitEvent({ type: "sessionStarted", sessionId, tool, timestamp: now, title: path.basename(payload.cwd || "DeepSeek Harness"), latestUserPrompt: prompt.slice(0, 120) });
      ctx.emitEvent({ type: "activityUpdated", sessionId, tool, timestamp: now, activity: "Thinking...", latestUserPrompt: prompt.slice(0, 120) });
    } else if (payload.hook_event_name === "PreToolUse") {
      ctx.emitEvent({ type: "toolUseStarted", sessionId, tool, timestamp: now, activity: payload.tool_name || "Running" });
    } else if (payload.hook_event_name === "Stop") {
      ctx.emitEvent({ type: "activityUpdated", sessionId, tool, timestamp: now, activity: "" });
      ctx.emitEvent({ type: "sessionCompleted", sessionId, tool, timestamp: now, latestUserPrompt: this.latestPromptBySession.get(sessionId), isSessionEnd: false });
    } else if (payload.hook_event_name === "Notification") {
      ctx.emitEvent({ type: "activityUpdated", sessionId, tool, timestamp: now, activity: payload.message || "DeepSeek Harness needs attention" });
    } else if (payload.hook_event_name === "PermissionRequest") {
      const permissionRequest = {
        id: crypto.randomUUID(),
        sessionId,
        toolName: payload.tool_name || "DeepSeek Harness",
        toolInput: payload.reason || payload.tool_name || "DeepSeek Harness 请求执行操作",
        riskLevel: "high",
        approvalMode: "bridge"
      };
      ctx.playSoundEvent("approvalNeeded");
      ctx.emitEvent({ type: "permissionRequested", sessionId, tool, timestamp: now, permissionRequest });
      ctx.setPendingPermission(sessionId, clientId, tool, {
        approvalMode: "bridge",
        disconnectPolicy: "resolveOnDisconnect"
      }, payload);
      return;
    }
    ctx.sendResponse(clientId, ACK);
  }
  isBlockingEvent(payload) { return payload.hook_event_name === "PermissionRequest"; }
}

module.exports = { DeepSeekHarnessAdapter };
