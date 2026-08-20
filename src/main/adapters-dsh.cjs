"use strict";

const path = require("node:path");
const ACK = { type: "acknowledged" };

class DeepSeekHarnessAdapter {
  agentId = "dsh";
  latestPromptBySession = new Map();
  handleHook(clientId, payload, ctx) {
    const sessionId = payload.session_id;
    const now = Date.now();
    if (!sessionId) return ctx.sendResponse(clientId, ACK);
    const tool = "dsh";
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
    }
    ctx.sendResponse(clientId, ACK);
  }
  isBlockingEvent() { return false; }
}

module.exports = { DeepSeekHarnessAdapter };
