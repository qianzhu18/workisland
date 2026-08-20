"use strict";

const log = require("electron-log");
const crypto$1 = require("node:crypto");
const { ClaudeAdapter, CodexAdapter } = require("./adapters-cli.cjs");
const { CocoAdapter, CursorAdapter, OpenCodeAdapter, SaraAdapter, KimiAdapter, CopilotCliAdapter } = require("./adapters-ide.cjs");
const { GeminiAdapter, HermesAdapter, AidenAdapter, TraexCliAdapter } = require("./adapters-extended.cjs");
const { ZCodeAdapter, WorkBuddyAdapter } = require("./adapters-work-agents.cjs");
const { DeepSeekHarnessAdapter } = require("./adapters-dsh.cjs");

function createLocalHookAdapterRegistry() {
  const adapters = [
    new ClaudeAdapter(),
    new CodexAdapter(),
    new CocoAdapter(),
    new CursorAdapter(),
    new ZCodeAdapter(),
    new WorkBuddyAdapter(),
    new OpenCodeAdapter(),
    new SaraAdapter(),
    new KimiAdapter(),
    new CopilotCliAdapter(),
    new GeminiAdapter(),
    new HermesAdapter(),
    new AidenAdapter(),
    new DeepSeekHarnessAdapter(),
    new TraexCliAdapter()
  ];
  const registry = new Map(adapters.map((adapter) => [adapter.agentId, adapter]));
  return registry;
}

const adapterRegistry = createLocalHookAdapterRegistry();
const ID_RE = /^[a-z0-9-]{1,32}$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const VALID_EVENTS$1 = /* @__PURE__ */ new Set([
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
  "StopFailure",
  "SessionEnd",
  "SubagentStart",
  "SubagentStop",
  "Notification",
  "PreCompact",
  "PermissionRequest"
]);
function validatePlugins(plugins) {
  const seen = /* @__PURE__ */ new Set();
  for (const plugin of plugins) {
    validateSingle(plugin, seen);
  }
}
function validateSingle(plugin, seen) {
  if (!plugin.id || !ID_RE.test(plugin.id)) {
    throw new Error(`[AgentPlugin] invalid id: "${plugin.id}" — must match /^[a-z0-9-]{1,32}$/`);
  }
  if (seen.has(plugin.id)) {
    throw new Error(`[AgentPlugin] duplicate id: "${plugin.id}"`);
  }
  seen.add(plugin.id);
  if (!plugin.label || plugin.label.length > 48) {
    throw new Error(`[AgentPlugin:${plugin.id}] label must be 1-48 chars`);
  }
  if (!HEX_COLOR_RE.test(plugin.badgeColor)) {
    throw new Error(`[AgentPlugin:${plugin.id}] badgeColor must be valid hex (e.g. #FF6B35)`);
  }
  if (!Array.isArray(plugin.events) || plugin.events.length === 0) {
    throw new Error(`[AgentPlugin:${plugin.id}] events must be non-empty array`);
  }
  for (const e of plugin.events) {
    if (!VALID_EVENTS$1.has(e)) {
      throw new Error(`[AgentPlugin:${plugin.id}] unknown event: "${e}"`);
    }
  }
  if (typeof plugin.install !== "function") {
    throw new Error(`[AgentPlugin:${plugin.id}] install must be a function`);
  }
  if (typeof plugin.uninstall !== "function") {
    throw new Error(`[AgentPlugin:${plugin.id}] uninstall must be a function`);
  }
  if (typeof plugin.checkHealth !== "function") {
    throw new Error(`[AgentPlugin:${plugin.id}] checkHealth must be a function`);
  }
  if (typeof plugin.normalize !== "function") {
    throw new Error(`[AgentPlugin:${plugin.id}] normalize must be a function`);
  }
  if (!Array.isArray(plugin.suppressionBundleIds)) {
    throw new Error(`[AgentPlugin:${plugin.id}] suppressionBundleIds must be an array`);
  }
}
function generateFluxBridgeExtension(opts) {
  const { sdkImport, fluxHooksCommand, source } = opts;
  const escapeStringLiteral = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `// flux-bridge extension — 桥接 Agent 生命周期事件到 Orca 灵动岛。
// 由 Orca Plugin install 自动生成，请勿手动编辑。
// Agent: ${source} | SDK: ${sdkImport}

import { spawnSync } from "node:child_process";
import type { AgentEndEvent, ExtensionAPI, ExtensionContext } from "${sdkImport}";

// ─── 工具函数 ───────────────────────────────────────────────────────────

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function textFromContent(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typed = block as { type?: unknown; text?: unknown };
    if (typed.type === "text" && typeof typed.text === "string") parts.push(typed.text);
  }
  return parts.join("\\n") || null;
}

function lastAssistantMessage(event: AgentEndEvent): string | undefined {
  for (let index = event.messages.length - 1; index >= 0; index -= 1) {
    const message = event.messages[index];
    if (!message || typeof message !== "object") continue;
    const typed = message as { role?: unknown; content?: unknown };
    if (typed.role !== "assistant") continue;
    const text = firstString(textFromContent(typed.content));
    if (text) return text;
  }
  return undefined;
}

// ─── 数据清洗 ────────────────────────────────────────────────────────────

function stripXmlTags(value: string): string {
  // pi-agent-flow 等 Agent flow 引擎可能在文本中嵌入 XML 标签
  // （<context-seal>、<activation>、<directive>、<mission> 等），
  // 这些是框架内部通信标记，不应出现在灵动岛显示中。
  return value.replace(/<[^>]*context-seal[^>]*>[^<]*<\\/[^>]*context-seal[^>]*>/gi, "")
              .replace(/<[^>]+>([^<]+)<\\/[^>]+>/g, "$1")
              .trim();
}

// ─── 事件发送（通过 flux-hooks 转发到 BridgeServer） ─────────────────────

const fluxHooksCommand = "${escapeStringLiteral(fluxHooksCommand)}";

function sendHook(
  eventName: string,
  ctx: ExtensionContext,
  extra: Record<string, unknown> = {},
): void {
  if (process.env.FLUX_HOOKS_DISABLED === "1") return;

  const sessionId = firstString(ctx.sessionManager.getSessionId());
  if (!sessionId) return;

  const cwd = firstString(ctx.cwd) || process.cwd();
  const payload: Record<string, unknown> = {
    session_id: sessionId,
    cwd,
    ...extra,
  };
  try {
    spawnSync(fluxHooksCommand, ["--event", eventName], {
      shell: true,
      input: JSON.stringify(payload),
      encoding: "utf8",
      stdio: ["pipe", "ignore", "ignore"],
      timeout: 5000,
    });
  } catch (err) {
    // spawnSync 异常（如命令不存在）不应中断 Agent，但需可观测。
    if (process.env.FLUX_HOOKS_DEBUG === "1") {
      console.error("[flux-bridge] sendHook error:", err);
    }
  }
}

// ─── 扩展入口 ────────────────────────────────────────────────────────────

export default function fluxBridgeExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    sendHook("SessionStart", ctx, { reason: _event.reason });
  });

  pi.on("before_agent_start", async (event, ctx) => {
    sendHook("UserPromptSubmit", ctx, { prompt: stripXmlTags(event.prompt) });
  });

  pi.on("agent_end", async (event, ctx) => {
    const msg = lastAssistantMessage(event);
    sendHook("Stop", ctx, { last_assistant_message: msg ? stripXmlTags(msg) : undefined });
  });
}
`;
}
const CORE_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "Stop"
];
const EXTENSION_FILE = "flux-bridge.ts";
const HEALTH_FUNCTION_MARKER = "export default function";
function createNativeExtensionPlugin(opts) {
  const { id, label, badgeColor, extHomeSubpath, sdkImport, source } = opts;
  let activeMainSessionId = null;
  return {
    id,
    label,
    badgeColor,
    events: CORE_EVENTS,
    suppressionBundleIds: [],
    features: {
      larkNotification: false,
      bitsReport: false
    },
    async install(ctx) {
      const extDir = `${ctx.homeDir}/${extHomeSubpath}`;
      await ctx.ensureDir(extDir);
      const code = generateFluxBridgeExtension({
        sdkImport,
        source,
        fluxHooksCommand: ctx.hookCommand
      });
      await ctx.writeText(`${extDir}/${EXTENSION_FILE}`, code);
      ctx.log.info(`已安装 flux-bridge 扩展到 ${extDir}/${EXTENSION_FILE}`);
    },
    async uninstall(ctx) {
      const extPath = `${ctx.homeDir}/${extHomeSubpath}/${EXTENSION_FILE}`;
      await ctx.removeFile(extPath);
      ctx.log.info(`已卸载 flux-bridge 扩展: ${extPath}`);
    },
    async checkHealth(ctx) {
      const extPath = `${ctx.homeDir}/${extHomeSubpath}/${EXTENSION_FILE}`;
      const content = await ctx.readText(extPath);
      if (!content) {
        return { installed: false, issues: ["flux-bridge 扩展文件缺失，请重新 Install"] };
      }
      if (!content.includes(source) || !content.includes(HEALTH_FUNCTION_MARKER)) {
        return { installed: false, issues: ["flux-bridge 扩展文件损坏（source 不匹配或函数缺失），请重新 Install"] };
      }
      return { installed: true, issues: [] };
    },
    normalize(raw, event) {
      const sessionId = raw.session_id;
      if (!sessionId) return null;
      let parentSessionId;
      if (raw.reason === "subagent") {
        parentSessionId = activeMainSessionId ?? void 0;
      } else if (event === "SessionStart") {
        activeMainSessionId = sessionId;
      } else if (event === "UserPromptSubmit") {
        if (activeMainSessionId && activeMainSessionId !== sessionId) {
          parentSessionId = activeMainSessionId;
        } else {
          activeMainSessionId = sessionId;
        }
      } else if (event === "Stop") {
        if (activeMainSessionId === sessionId) {
          activeMainSessionId = null;
        }
      }
      return {
        sessionId,
        event,
        parentSessionId,
        cwd: raw.cwd,
        prompt: raw.prompt,
        lastAssistantMessage: raw.last_assistant_message,
        stopReason: raw.stop_reason
      };
    }
  };
}
const omp = createNativeExtensionPlugin({
  id: "omp",
  label: "Oh My Pi",
  badgeColor: "#F59E0B",
  extHomeSubpath: ".omp/agent/extensions",
  sdkImport: "@earendil-works/pi-coding-agent",
  source: "plugin:omp"
});
const pi = createNativeExtensionPlugin({
  id: "pi",
  label: "Pi",
  badgeColor: "#3B82F6",
  extHomeSubpath: ".pi/agent/extensions",
  sdkImport: "@mariozechner/pi-coding-agent",
  source: "plugin:pi"
});
const ALL_PLUGINS = [
  omp,
  pi
];
validatePlugins(ALL_PLUGINS);
const AGENT_PLUGINS = Object.freeze(ALL_PLUGINS);
const PLUGIN_BY_TOOL = new Map(
  ALL_PLUGINS.map((p) => [`plugin:${p.id}`, p])
);
function listPluginAgentMeta() {
  return ALL_PLUGINS.map((p) => ({
    tool: `plugin:${p.id}`,
    label: p.label,
    badgeColor: p.badgeColor,
    defaultHookEnabled: p.defaultHookEnabled ?? false
  }));
}
function getPluginDefaultHookEnabled(tool) {
  return PLUGIN_BY_TOOL.get(tool)?.defaultHookEnabled ?? false;
}
const ACK = { type: "acknowledged" };
const VALID_EVENTS = /* @__PURE__ */ new Set([
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
  "StopFailure",
  "SessionEnd",
  "SubagentStart",
  "SubagentStop",
  "Notification",
  "PreCompact",
  "PermissionRequest"
]);
class PluginAdapter {
  agentId = "plugin:*";
  /** 子 sessionId 集合（Pattern 2：normalize 返回 parentSessionId 的会话） */
  childSessions = /* @__PURE__ */ new Set();
  isBlockingEvent(payload) {
    const eventName = payload.hook_event_name;
    if (eventName !== "PermissionRequest") return false;
    const source = payload._source;
    if (!source) return false;
    const plugin = PLUGIN_BY_TOOL.get(source);
    return plugin?.permissionApprovalMode === "bridge";
  }
  handleHook(clientId, payload, ctx) {
    const source = payload._source;
    if (!source) {
      ctx.sendResponse(clientId, ACK);
      return;
    }
    const plugin = PLUGIN_BY_TOOL.get(source);
    if (!plugin) {
      log.warn("[PluginAdapter] unknown plugin source:", source);
      ctx.sendResponse(clientId, ACK);
      return;
    }
    const eventName = payload.hook_event_name;
    if (!eventName || !VALID_EVENTS.has(eventName)) {
      log.warn("[PluginAdapter] unknown event:", eventName, "from", source);
      ctx.sendResponse(clientId, ACK);
      return;
    }
    if (!plugin.events.includes(eventName)) {
      ctx.sendResponse(clientId, ACK);
      return;
    }
    let normalized;
    try {
      normalized = plugin.normalize(payload, eventName);
    } catch (err) {
      log.warn("[PluginAdapter] normalize error from", source, ":", err);
      ctx.sendResponse(clientId, ACK);
      return;
    }
    if (!normalized) {
      ctx.sendResponse(clientId, ACK);
      return;
    }
    const tool = source;
    const now = Date.now();
    if (normalized.subAgentId && eventName !== "SubagentStart" && eventName !== "SubagentStop") {
      ctx.sendResponse(clientId, ACK);
      return;
    }
    if (this.childSessions.has(normalized.sessionId)) {
      if (eventName === "Stop" || eventName === "StopFailure" || eventName === "SessionEnd") {
        this.childSessions.delete(normalized.sessionId);
      }
      ctx.sendResponse(clientId, ACK);
      return;
    }
    switch (eventName) {
      case "SessionStart": {
        if (normalized.parentSessionId) {
          this.childSessions.add(normalized.sessionId);
          ctx.sendResponse(clientId, ACK);
          return;
        }
        ctx.emitEvent({
          type: "sessionStarted",
          sessionId: normalized.sessionId,
          tool,
          timestamp: now,
          title: normalized.prompt ?? normalized.cwd ?? plugin.label,
          latestUserPrompt: normalized.prompt ?? normalized.cwd ?? plugin.label
        });
        ctx.updateJumpTarget(normalized.sessionId, tool);
        break;
      }
      case "UserPromptSubmit": {
        if (normalized.parentSessionId) {
          this.childSessions.add(normalized.sessionId);
          ctx.sendResponse(clientId, ACK);
          return;
        }
        ctx.emitEvent({
          type: "sessionStarted",
          sessionId: normalized.sessionId,
          tool,
          timestamp: now,
          title: normalized.prompt ?? plugin.label,
          latestUserPrompt: normalized.prompt
        });
        ctx.updateJumpTarget(normalized.sessionId, tool);
        ctx.playSoundEvent("sessionStart");
        break;
      }
      case "PreToolUse":
        ctx.emitEvent({
          type: "toolUseStarted",
          sessionId: normalized.sessionId,
          tool,
          timestamp: now,
          toolName: normalized.toolName,
          activity: normalized.toolName
        });
        ctx.updateJumpTarget(normalized.sessionId, tool);
        break;
      case "PostToolUse":
        ctx.clearStalePendingInteraction(normalized.sessionId);
        ctx.emitEvent({
          type: "permissionResolved",
          sessionId: normalized.sessionId,
          tool,
          timestamp: now
        });
        ctx.emitEvent({
          type: "toolUseCompleted",
          sessionId: normalized.sessionId,
          tool,
          timestamp: now,
          toolName: normalized.toolName
        });
        break;
      case "PostToolUseFailure": {
        const failToolName = normalized.toolName || "Tool";
        const failActivity = normalized.error ? `${failToolName} failed: ${normalized.error.slice(0, 80)}` : `${failToolName} failed`;
        ctx.emitEvent({
          type: "toolUseCompleted",
          sessionId: normalized.sessionId,
          tool,
          timestamp: now,
          toolName: failToolName
        });
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId: normalized.sessionId,
          tool,
          timestamp: now,
          activity: failActivity
        });
        break;
      }
      case "Stop":
        ctx.emitEvent({
          type: "sessionCompleted",
          sessionId: normalized.sessionId,
          tool,
          timestamp: now,
          lastAssistantMessage: normalized.lastAssistantMessage,
          isInterrupt: normalized.isInterrupt ?? false,
          isSessionEnd: false
        });
        ctx.playSoundEvent("taskComplete");
        break;
      case "StopFailure":
        ctx.emitEvent({
          type: "sessionCompleted",
          sessionId: normalized.sessionId,
          tool,
          timestamp: now,
          isSessionEnd: false,
          error: normalized.error,
          errorDetail: normalized.errorDetail
        });
        ctx.playSoundEvent("taskError");
        break;
      case "SessionEnd":
        ctx.emitEvent({
          type: "sessionCompleted",
          sessionId: normalized.sessionId,
          tool,
          timestamp: now,
          isInterrupt: false,
          isSessionEnd: true
        });
        break;
      case "SubagentStart":
      case "SubagentStop":
        break;
      case "Notification":
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId: normalized.sessionId,
          tool,
          timestamp: now,
          activity: normalized.message || normalized.notificationType || "Notification"
        });
        break;
      case "PreCompact":
        ctx.emitEvent({
          type: "activityUpdated",
          sessionId: normalized.sessionId,
          tool,
          timestamp: now,
          activity: "Compacting conversation..."
        });
        break;
      case "PermissionRequest": {
        const reqToolName = normalized.toolName || "unknown";
        const toolInputText = normalized.permissionToolInput || reqToolName;
        const approvalMode = plugin.permissionApprovalMode ?? "terminalNative";
        const permissionRequest = {
          id: crypto$1.randomUUID(),
          sessionId: normalized.sessionId,
          toolName: reqToolName,
          toolInput: toolInputText,
          riskLevel: normalized.permissionRiskLevel ?? "medium",
          approvalMode,
          ...normalized.permissionCodeDiff && normalized.permissionCodeDiff.length > 0 && {
            codeDiff: normalized.permissionCodeDiff
          },
          ...normalized.permissionSuggestions && normalized.permissionSuggestions.length > 0 && {
            permissionSuggestions: normalized.permissionSuggestions
          }
        };
        ctx.playSoundEvent("approvalNeeded");
        ctx.emitEvent({
          type: "permissionRequested",
          sessionId: normalized.sessionId,
          tool,
          timestamp: now,
          permissionRequest
        });
        if (approvalMode === "bridge") {
          ctx.setPendingPermission(normalized.sessionId, clientId, tool, {
            approvalMode: "bridge",
            disconnectPolicy: "resolveOnDisconnect"
          }, payload);
        } else {
          ctx.sendResponse(clientId, ACK);
          ctx.setPendingPermission(normalized.sessionId, clientId, tool, {
            approvalMode: "terminalNative",
            disconnectPolicy: "preserveOnDisconnect",
            responseChannelClosedAt: now
          });
        }
        return;
      }
    }
    ctx.sendResponse(clientId, ACK);
  }
}
module.exports = {
  adapterRegistry,
  AGENT_PLUGINS,
  PLUGIN_BY_TOOL,
  listPluginAgentMeta,
  getPluginDefaultHookEnabled,
  PluginAdapter
};
