import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { listCoreAgentDescriptors, validateAgentWiring } = require("../src/shared/agent-catalog.cjs");

const Module = require("node:module");
const originalLoad = Module._load;
const fakeElectron = {
  app: {
    getPath: () => "/tmp/workisland-test-userdata",
    isPackaged: false,
    getAppPath: () => process.cwd()
  },
  ipcMain: {},
  shell: {},
  dialog: {}
};
Module._load = function(request, parent, isMain) {
  if (request === "electron") return fakeElectron;
  return originalLoad.call(this, request, parent, isMain);
};

const adapterRegistry = new Map();
for (const [agentId, adapter] of Object.entries({
  claude: require("../src/main/adapters-cli.cjs").ClaudeAdapter,
  codex: require("../src/main/adapters-cli.cjs").CodexAdapter,
  coco: require("../src/main/adapters-ide.cjs").CocoAdapter,
  cursor: require("../src/main/adapters-ide.cjs").CursorAdapter,
  trae: require("../src/main/adapters-ide.cjs").TraeHookAdapter,
  zcode: require("../src/main/adapters-work-agents.cjs").ZCodeAdapter,
  workbuddy: require("../src/main/adapters-work-agents.cjs").WorkBuddyAdapter,
  opencode: require("../src/main/adapters-ide.cjs").OpenCodeAdapter,
  sara: require("../src/main/adapters-ide.cjs").SaraAdapter,
  kimi: require("../src/main/adapters-ide.cjs").KimiAdapter,
  "copilot-cli": require("../src/main/adapters-ide.cjs").CopilotCliAdapter,
  gemini: require("../src/main/adapters-extended.cjs").GeminiAdapter,
  hermes: require("../src/main/adapters-extended.cjs").HermesAdapter,
  aiden: require("../src/main/adapters-extended.cjs").AidenAdapter,
  dsh: require("../src/main/adapters-dsh.cjs").DeepSeekHarnessAdapter,
  traex: require("../src/main/adapters-extended.cjs").TraexCliAdapter
})) adapterRegistry.set(agentId, new adapter());
const { hasTraexSourceMarker } = require("../src/main/hooks-extended.cjs");
const { AGENT_PLUGINS } = require("../src/main/agent-registry.cjs");
Module._load = originalLoad;

const scenarios = {
  claude: { hook_event_name: "UserPromptSubmit", prompt: "matrix test" },
  codex: { hook_event_name: "UserPromptSubmit", prompt: "matrix test", transcript_path: "/tmp/missing-transcript" },
  coco: { event_type: "user_prompt_submit", user_prompt_submit: { prompt: "matrix test" } },
  dsh: { hook_event_name: "UserPromptSubmit", prompt: "matrix test" },
  cursor: { hook_event_name: "beforeSubmitPrompt", prompt: "matrix test" },
  trae: { hook_event_name: "UserPromptSubmit", prompt: "matrix test" },
  zcode: { hook_event_name: "UserPromptSubmit", prompt: "matrix test" },
  workbuddy: { hook_event_name: "UserPromptSubmit", prompt: "matrix test" },
  opencode: { hook_event_name: "UserPromptSubmit", prompt: "matrix test" },
  sara: { hook_event_name: "UserPromptSubmit", prompt: "matrix test" },
  kimi: { hook_event_name: "UserPromptSubmit", prompt: "matrix test" },
  gemini: { hook_event_name: "BeforeAgent", prompt: "matrix test" },
  "copilot-cli": { hook_event_name: "userPromptSubmitted", prompt: "matrix test" },
  hermes: { event_type: "pre_llm_call", user_message: "matrix test" },
  aiden: { hook_event_name: "UserPromptSubmit", prompt: "matrix test" },
  traex: { hook_event_name: "UserPromptSubmit", prompt: "matrix test" }
};

function createContext(events, responses) {
  const context = {
    isRemote: false,
    emitEvent: (event) => events.push(event),
    sendResponse: (_clientId, response) => responses.push(response),
    getApprovalMode: () => "bridge",
    updateJumpTarget: () => {},
    playSoundEvent: () => {},
    clearStalePendingInteraction: () => {},
    setPendingPermission: () => {},
    setPendingQuestion: () => {},
    attachClaudeTranscriptWatcher: () => {},
    detachClaudeTranscriptWatcher: () => {},
    getSessionTitle: () => undefined,
    recordInternalSession: () => {},
    reportTokenUsage: () => {}
  };
  return new Proxy(context, {
    get(target, property) {
      return property in target ? target[property] : () => {};
    }
  });
}

test("every Settings core Agent has an adapter and handles its native prompt event", () => {
  const agentIds = listCoreAgentDescriptors().map(({ agentId }) => agentId);
  validateAgentWiring({ managerIds: agentIds, adapterIds: [...adapterRegistry.keys()] });

  for (const agentId of agentIds) {
    const adapter = adapterRegistry.get(agentId);
    const events = [];
    const responses = [];
    const sessionId = `matrix-${agentId}`;
    adapter.handleHook(`${agentId}-client`, {
      ...scenarios[agentId],
      session_id: sessionId,
      cwd: "/tmp/workisland-matrix",
      terminal_app: "Warp"
    }, createContext(events, responses));
    assert.ok(events.some((event) => event.type === "sessionStarted"), `${agentId} did not start a session`);
    assert.ok(responses.length > 0, `${agentId} did not acknowledge its hook`);
  }
});

test("TraeX health accepts development and packaged hook command quoting", () => {
  assert.equal(hasTraexSourceMarker("node hooks-cli/index.cjs --source traex"), true);
  assert.equal(hasTraexSourceMarker("node hooks-cli/index.cjs --source 'traex'"), true);
  assert.equal(hasTraexSourceMarker("node hooks-cli/index.cjs --source \"traex\""), true);
  assert.equal(hasTraexSourceMarker("node hooks-cli/index.cjs --source trae"), false);
});

test("Settings plugin Agents install, report health, normalize events, and uninstall", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "workisland-plugin-matrix-"));
  const logs = [];
  const context = {
    homeDir,
    hookCommand: "node hooks-cli/index.cjs --source plugin:test",
    ensureDir: async (path) => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(path, { recursive: true });
    },
    writeText: async (path, content) => {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(path, content, "utf8");
    },
    readText: async (path) => {
      try {
        return await readFile(path, "utf8");
      } catch {
        return "";
      }
    },
    removeFile: async (path) => {
      const { unlink } = await import("node:fs/promises");
      try {
        await unlink(path);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    },
    log: { info: (message) => logs.push(message) }
  };

  try {
    for (const plugin of AGENT_PLUGINS) {
      await plugin.install({ ...context, hookCommand: `node hooks-cli/index.cjs --source plugin:${plugin.id}` });
      const health = await plugin.checkHealth(context);
      assert.deepEqual(health, { installed: true, issues: [] }, `${plugin.id} health check failed`);
      const extensionPath = join(homeDir, plugin.id === "omp" ? ".omp/agent/extensions" : ".pi/agent/extensions", "flux-bridge.ts");
      const extension = await readFile(extensionPath, "utf8");
      assert.match(extension, new RegExp(`plugin:${plugin.id}`));

      const session = plugin.normalize({ session_id: `${plugin.id}-session`, cwd: "/tmp/plugin-matrix", prompt: "hello" }, "SessionStart");
      const prompt = plugin.normalize({ session_id: `${plugin.id}-session`, cwd: "/tmp/plugin-matrix", prompt: "hello" }, "UserPromptSubmit");
      const stop = plugin.normalize({ session_id: `${plugin.id}-session`, cwd: "/tmp/plugin-matrix", last_assistant_message: "done" }, "Stop");
      assert.equal(session.sessionId, `${plugin.id}-session`);
      assert.equal(prompt.event, "UserPromptSubmit");
      assert.equal(stop.lastAssistantMessage, "done");

      await plugin.uninstall(context);
      assert.deepEqual(await plugin.checkHealth(context), {
        installed: false,
        issues: ["flux-bridge 扩展文件缺失，请重新 Install"]
      });
    }
    assert.equal(logs.length, AGENT_PLUGINS.length * 2);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
