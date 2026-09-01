import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { requestLocalControl } = require("../local-control-client.cjs");
const { PRODUCT_CAPABILITIES } = require("../../shared/product-capabilities.cjs");
const { DIAGNOSIS_SUBJECTS } = require("../../main/mcp-diagnostics.cjs");

const emptyInput = z.object({}).strict();
const controlledKey = z.string().min(1).max(120);
const settingValue = z.union([z.boolean(), z.number().finite(), z.string().max(500)]);
const settingsChanges = z.record(controlledKey, settingValue).refine(
  (changes) => Object.keys(changes).length >= 1 && Object.keys(changes).length <= 20,
  "Provide between 1 and 20 setting changes."
);
const capabilityId = z.enum(PRODUCT_CAPABILITIES.map(({ id }) => id));
const diagnosisSubject = z.enum(DIAGNOSIS_SUBJECTS);

export const TOOL_NAMES = Object.freeze([
  "list_capabilities",
  "get_capability",
  "list_integrations",
  "list_active_sessions",
  "diagnose",
  "describe_settings",
  "get_settings",
  "update_settings",
  "undo_settings_change",
  "get_product_state",
  "focus_session",
  "open_settings",
  "set_display_surface"
]);

function resultContent(result) {
  const structuredContent = result && typeof result === "object" && !Array.isArray(result)
    ? result
    : { value: result };
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent
  };
}

function errorContent(error) {
  const output = {
    error: {
      code: typeof error?.code === "string" ? error.code : "INTERNAL_ERROR",
      message: typeof error?.message === "string" ? error.message : "WorkIsland local control failed.",
      ...(error?.details === undefined ? {} : { details: error.details })
    }
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(output) }],
    structuredContent: output
  };
}

function registerForwardedTool(server, request, definition) {
  server.registerTool(
    definition.name,
    {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema,
      annotations: definition.annotations
    },
    async (args) => {
      try {
        const result = await request(definition.command, definition.params(args));
        return resultContent(result);
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}

export function createWorkIslandMcpServer(options = {}) {
  const clientName = (options.clientName || process.env.WORKISLAND_MCP_CLIENT || "MCP client").slice(0, 80);
  const request = options.request || ((command, params) => requestLocalControl(command, params, {
    client: { name: clientName, version: "1" }
  }));
  const server = new McpServer(
    { name: "workisland", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  const definitions = [
    {
      name: "list_capabilities",
      title: "List WorkIsland capabilities",
      description: "Use this first when the user asks what WorkIsland or the Island can do. Returns the complete product capability catalog with availability, enabled state, usage, privacy, requirements, and related settings.",
      inputSchema: emptyInput,
      command: "control.listCapabilities",
      params: () => ({}),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    {
      name: "get_capability",
      title: "Explain one WorkIsland capability",
      description: "Explain how one WorkIsland feature works, when it is available, what data it uses, and which settings affect it.",
      inputSchema: z.object({ id: capabilityId }).strict(),
      command: "control.getCapability",
      params: ({ id }) => ({ id }),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    {
      name: "list_integrations",
      title: "List WorkIsland agent integrations",
      description: "List supported local agents with redacted enabled, installed, real-event verification, and capability state. Configuration presence alone is not reported as verified.",
      inputSchema: emptyInput,
      command: "control.listIntegrations",
      params: () => ({}),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    {
      name: "list_active_sessions",
      title: "List sessions observed by WorkIsland",
      description: "List only sessions currently observed and visible in WorkIsland. This is not a system-wide process list and never returns prompts, answers, paths, terminal identifiers, or PIDs.",
      inputSchema: emptyInput,
      command: "control.listActiveSessions",
      params: () => ({}),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    {
      name: "diagnose",
      title: "Diagnose a WorkIsland feature",
      description: "Diagnose one allowlisted WorkIsland display or integration problem using observed state. This tool is read-only and does not change settings.",
      inputSchema: z.object({ subject: diagnosisSubject }).strict(),
      command: "control.diagnose",
      params: ({ subject }) => ({ subject }),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    {
      name: "describe_settings",
      title: "Describe WorkIsland settings",
      description: "Describe complex WorkIsland customization settings, including constraints and current values. Use product capability tools for feature discovery.",
      inputSchema: emptyInput,
      command: "control.describeSettings",
      params: () => ({}),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    {
      name: "get_settings",
      title: "Read WorkIsland settings",
      description: "Read all exposed WorkIsland settings or a requested set of safe keys.",
      inputSchema: z.object({ keys: z.array(controlledKey).max(20).optional() }).strict(),
      command: "control.getSettings",
      params: ({ keys }) => keys === undefined ? {} : { keys },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    {
      name: "update_settings",
      title: "Update WorkIsland settings",
      description: "Atomically change a bounded set of allowlisted, reversible WorkIsland preferences only when the user explicitly asks for a change.",
      inputSchema: z.object({ changes: settingsChanges }).strict(),
      command: "control.updateSettings",
      params: ({ changes }) => ({ changes }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    {
      name: "undo_settings_change",
      title: "Undo a WorkIsland settings change",
      description: "Undo a recent agent settings change if no newer edit conflicts with it.",
      inputSchema: z.object({ changeId: z.string().min(1).max(160) }).strict(),
      command: "control.undoSettingsChange",
      params: ({ changeId }) => ({ changeId }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    {
      name: "get_product_state",
      title: "Get WorkIsland state",
      description: "Read the current display surface, visible module state, and redacted session counts.",
      inputSchema: emptyInput,
      command: "control.getProductState",
      params: () => ({}),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    {
      name: "focus_session",
      title: "Focus a WorkIsland session",
      description: "Return to a visible session using an opaque ID from list_visible_sessions.",
      inputSchema: z.object({ id: z.string().min(1).max(160) }).strict(),
      command: "control.focusSession",
      params: ({ id }) => ({ id }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    {
      name: "open_settings",
      title: "Open WorkIsland Settings",
      description: "Open WorkIsland Settings at one allowlisted section.",
      inputSchema: z.object({
        section: z.enum(["general", "agents", "workstation", "appearance", "sound", "mcp", "about"]).default("mcp")
      }).strict(),
      command: "control.openSettings",
      params: ({ section }) => ({ section }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    {
      name: "set_display_surface",
      title: "Set WorkIsland display surface",
      description: "Switch WorkIsland between its Island and desktop-pet surfaces.",
      inputSchema: z.object({ surface: z.enum(["island", "pet"]) }).strict(),
      command: "control.setDisplaySurface",
      params: ({ surface }) => ({ surface }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    }
  ];

  for (const definition of definitions) registerForwardedTool(server, request, definition);
  return server;
}

export { errorContent, resultContent };
