"use strict";

const ACK = Object.freeze({ type: "acknowledged" });

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function almaSessionId(payload, input) {
  return text(input.threadId)
    || text(asObject(input.context).threadId)
    || text(payload.session_id)
    || text(payload.conversation_id);
}

const METADATA_BLOCK = /<(context_from_earlier_conversation|managed_agent_profile|system-reminder|alma_notification)\b[^>]*>[\s\S]*?<\/\1>/gi;

function cleanAlmaPrompt(raw) {
  return String(raw || "")
    .replace(METADATA_BLOCK, " ")
    .replace(/\[Message sent-at:[^\]]*\]/g, " ")
    .replace(/\[This message arrived while you were busy[\s\S]*?\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMetadataText(value) {
  const raw = String(value || "").trim();
  if (!raw) return true;
  return cleanAlmaPrompt(raw).length === 0;
}

function promptText(input, payload) {
  const parts = Array.isArray(input.parts) ? input.parts : [];
  const fromParts = parts
    .filter((part) => part && part.type === "text" && typeof part.text === "string" && !isMetadataText(part.text))
    .map((part) => cleanAlmaPrompt(part.text))
    .filter(Boolean);
  if (fromParts.length > 0) return fromParts.join(" ");
  return cleanAlmaPrompt(text(input.content) || text(payload.prompt) || text(payload.user_prompt));
}

function summarizeTool(toolName, args) {
  const input = asObject(args);
  const detail = text(input.command) || text(input.file_path) || text(input.path) || text(input.query) || text(input.description);
  if (!detail) return `Using ${toolName}`;
  return `${toolName}: ${detail.replace(/\s+/g, " ").slice(0, 120)}`;
}

function previewText(value) {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!value || typeof value !== "object") return "";
  const nested = text(value.stdout) || text(value.output) || text(value.content) || text(value.message);
  return nested.replace(/\s+/g, " ").slice(0, 80);
}

function reportAlmaUsage(sessionId, response, model) {
  const usage = asObject(response?.usage);
  const inputTokens = Number(usage.promptTokens ?? usage.inputTokens ?? 0);
  const outputTokens = Number(usage.completionTokens ?? usage.outputTokens ?? 0);
  const cacheReadTokens = Number(usage.cachedInputTokens ?? usage.cacheReadTokens ?? 0);
  const cacheCreationTokens = Number(usage.cacheWriteInputTokens ?? usage.cacheCreationTokens ?? 0);
  if (![inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens].every((value) => Number.isFinite(value))) return;
  if (inputTokens === 0 && outputTokens === 0 && cacheReadTokens === 0 && cacheCreationTokens === 0) return;
  try {
    require("./adapters-extended.cjs").reportTokenUsage("alma", sessionId, {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      totalTokens: inputTokens + outputTokens,
      model: text(model) || undefined,
      isEstimated: false
    });
  } catch {
  }
}

class AlmaAdapter {
  agentId = "alma";
  knownSessions = new Set();
  prompts = new Map();

  isBlockingEvent() {
    return false;
  }

  rememberJump(sessionId, payload, ctx) {
    ctx.updateJumpTarget(sessionId, this.agentId, {
      terminal_app: text(payload.terminal_app) || "Alma",
      terminal_tty: payload.terminal_tty,
      terminal_session_id: payload.terminal_session_id,
      warp_pane_uuid: payload.warp_pane_uuid,
      cwd: payload.cwd
    });
  }

  startSession(sessionId, payload, ctx, { title, summary, prompt, sound }) {
    const isNew = !this.knownSessions.has(sessionId);
    this.knownSessions.add(sessionId);
    if (prompt) this.prompts.set(sessionId, prompt);
    ctx.emitEvent({
      type: "sessionStarted",
      sessionId,
      tool: this.agentId,
      timestamp: Date.now(),
      title: title || "Alma",
      summary: summary || undefined,
      latestUserPrompt: prompt ? prompt.slice(0, 120) : undefined
    });
    this.rememberJump(sessionId, payload, ctx);
    if (sound && isNew) ctx.playSoundEvent("sessionStart");
    return isNew;
  }

  handleHook(clientId, payload, ctx) {
    const input = asObject(payload.input);
    const eventName = text(payload.hook) || text(payload.hook_event_name);
    const sessionId = almaSessionId(payload, input);
    const now = Date.now();
    if (!sessionId || !eventName) {
      ctx.sendResponse(clientId, ACK);
      return;
    }

    switch (eventName) {
      case "thread.created":
      case "thread.activated": {
        this.startSession(sessionId, payload, ctx, {
          title: text(input.title) || "Alma",
          sound: eventName === "thread.created"
        });
        break;
      }
      case "chat.message.willSend": {
        const prompt = promptText(input, payload);
        this.startSession(sessionId, payload, ctx, {
          title: prompt ? prompt.slice(0, 60) : "Alma",
          summary: prompt.slice(0, 120),
          prompt,
          sound: true
        });
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool: this.agentId,
          timestamp: now,
          activity: "Thinking...",
          latestUserPrompt: prompt.slice(0, 120)
        });
        break;
      }
      case "tool.willExecute": {
        if (!this.knownSessions.has(sessionId)) {
          this.startSession(sessionId, payload, ctx, { title: "Alma", sound: false });
        } else {
          this.rememberJump(sessionId, payload, ctx);
        }
        const toolName = text(input.tool) || "Tool";
        ctx.emitEvent({
          type: "toolUseStarted",
          sessionId,
          tool: this.agentId,
          timestamp: now,
          toolName,
          activity: summarizeTool(toolName, input.args)
        });
        break;
      }
      case "tool.didExecute": {
        const toolName = text(input.tool) || "Tool";
        const preview = previewText(input.result);
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool: this.agentId,
          timestamp: now,
          activity: preview ? `${toolName}: ${preview}` : `${toolName} done`
        });
        break;
      }
      case "tool.onError": {
        const toolName = text(input.tool) || "Tool";
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool: this.agentId,
          timestamp: now,
          activity: `${toolName} failed`
        });
        ctx.playSoundEvent("taskError");
        break;
      }
      case "chat.message.didReceive": {
        const response = asObject(input.response);
        const assistant = text(response.content);
        if (!this.knownSessions.has(sessionId)) {
          this.startSession(sessionId, payload, ctx, { title: text(input.title) || "Alma", sound: false });
        }
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool: this.agentId,
          timestamp: now,
          activity: "",
          lastAssistantMessage: assistant || undefined
        });
        ctx.emitEvent({
          type: "sessionCompleted",
          sessionId,
          tool: this.agentId,
          timestamp: now,
          lastAssistantMessage: assistant || undefined,
          latestUserPrompt: this.prompts.get(sessionId),
          isSessionEnd: false
        });
        ctx.playSoundEvent("taskComplete");
        reportAlmaUsage(sessionId, response, input.model);
        break;
      }
      case "thread.deleted": {
        ctx.clearStalePendingInteraction(sessionId);
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId,
          tool: this.agentId,
          timestamp: now,
          activity: ""
        });
        ctx.emitEvent({
          type: "sessionCompleted",
          sessionId,
          tool: this.agentId,
          timestamp: now,
          latestUserPrompt: this.prompts.get(sessionId),
          isSessionEnd: true
        });
        this.knownSessions.delete(sessionId);
        this.prompts.delete(sessionId);
        break;
      }
      default:
        break;
    }
    ctx.sendResponse(clientId, ACK);
  }
}

module.exports = { AlmaAdapter };
