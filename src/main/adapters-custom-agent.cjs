"use strict";
const path = require("node:path");
const ACK = { type: "acknowledged" };
class CustomAgentAdapter {
  constructor(connection) { this.connection = connection; this.agentId = connection.source; }
  latestPrompt = new Map();
  handleHook(clientId, payload, ctx) {
    const sessionId = payload.session_id;
    if (!sessionId) return ctx.sendResponse(clientId, ACK);
    const event = Object.entries(this.connection.eventMap).find(([, external]) => external === payload.hook_event_name)?.[0];
    const tool = this.agentId; const timestamp = Date.now();
    if (event === "SessionStart") ctx.emitEvent({ type: "sessionStarted", sessionId, tool, timestamp, title: path.basename(payload.cwd || this.connection.label) });
    if (event === "UserPromptSubmit") {
      const prompt = String(payload.prompt || ""); this.latestPrompt.set(sessionId, prompt);
      ctx.emitEvent({ type: "sessionStarted", sessionId, tool, timestamp, title: path.basename(payload.cwd || this.connection.label), latestUserPrompt: prompt.slice(0, 120) });
      ctx.emitEvent({ type: "activityUpdated", sessionId, tool, timestamp, activity: payload.activity || "Thinking...", latestUserPrompt: prompt.slice(0, 120) });
    }
    if (event === "PreToolUse") ctx.emitEvent({ type: "toolUseStarted", sessionId, tool, timestamp, activity: payload.activity || payload.tool_name || "Running" });
    if (event === "PostToolUse") ctx.emitEvent({ type: "activityUpdated", sessionId, tool, timestamp, activity: payload.activity || "Action completed" });
    if (event === "Stop") {
      ctx.emitEvent({ type: "activityUpdated", sessionId, tool, timestamp, activity: "" });
      ctx.emitEvent({ type: "sessionCompleted", sessionId, tool, timestamp, latestUserPrompt: this.latestPrompt.get(sessionId), lastAssistantMessage: payload.last_assistant_message, isSessionEnd: false });
    }
    if (event === "Notification") ctx.emitEvent({ type: "activityUpdated", sessionId, tool, timestamp, activity: payload.message || "Needs attention" });
    ctx.sendResponse(clientId, ACK);
  }
  isBlockingEvent() { return false; }
}
module.exports = { CustomAgentAdapter };
