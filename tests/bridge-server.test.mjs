import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";

const require = createRequire(import.meta.url);
const { createBridgeServerClass } = require("../src/main/bridge-server.cjs");
const { decodeLines } = require("../src/main/bridge-protocol.cjs");

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.writes = [];
  }
  write(value) { this.writes.push(Buffer.from(value)); }
  destroy() {}
}

function createServer(controlService) {
  const processedHooks = [];
  const adapter = {
    handleHook(clientId, payload, context) {
      processedHooks.push(payload);
      context.sendResponse(clientId, { type: "acknowledged" });
    }
  };
  class EmptyPluginAdapter { handleHook() {} }
  class EmptyWatcher { attach() {} detach() {} detachAll() {} }
  const BridgeServer = createBridgeServerClass({
    adapterRegistry: new Map([["codex", adapter]]),
    PluginAdapter: EmptyPluginAdapter,
    ClaudeTranscriptWatcher: EmptyWatcher,
    createHookPayloadRecorder: () => null,
    isPluginAgentTool: () => false,
    normalizeAgentPid: (value) => value,
    normalizeIdeWorkspace: () => undefined,
    normalizeTerminalAppForHookSource: () => undefined,
    parseTokenUsagePayload: () => null,
    getOriginalQuestions: () => [],
    getStructuredOriginalQuestions: () => [],
    mapStructuredAnswersToClaude: () => ({}),
    mapStructuredAnswersToOpenCode: () => [],
    renderAnswerSummary: () => ""
  });
  return { server: new BridgeServer({ controlService }), processedHooks };
}

function responses(socket) {
  return socket.writes.flatMap((chunk) => decodeLines(chunk).messages);
}

test("control requests receive one structured response with the same id", async () => {
  const calls = [];
  const { server } = createServer({
    execute: async (...args) => {
      calls.push(args);
      return { settings: { mediaEnabled: true } };
    }
  });
  const socket = new FakeSocket();
  server.handleConnection(socket);

  socket.emit("data", Buffer.from(`${JSON.stringify({
    type: "control",
    id: "request-1",
    command: "control.getSettings",
    params: { keys: ["mediaEnabled"] },
    client: { name: "Codex" }
  })}\n`));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, [["control.getSettings", { keys: ["mediaEnabled"] }, { name: "Codex" }]]);
  assert.deepEqual(responses(socket).at(-1), {
    id: "request-1",
    ok: true,
    result: { settings: { mediaEnabled: true } }
  });
});

test("control errors are serialized without stack traces", async () => {
  const { server } = createServer({
    execute: async () => {
      throw Object.assign(new Error("disabled"), { code: "LOCAL_CONTROL_DISABLED", details: { safe: true } });
    }
  });
  const socket = new FakeSocket();
  server.handleConnection(socket);
  socket.emit("data", Buffer.from('{"type":"control","id":"request-2","command":"control.getSettings"}\n'));
  await new Promise((resolve) => setImmediate(resolve));

  const response = responses(socket).at(-1);
  assert.deepEqual(response, {
    id: "request-2",
    ok: false,
    error: { code: "LOCAL_CONTROL_DISABLED", message: "disabled", details: { safe: true } }
  });
  assert.equal(JSON.stringify(response).includes("stack"), false);
});

test("legacy hook commands remain separate from control authority", async () => {
  let controlCalls = 0;
  const { server, processedHooks } = createServer({ execute: async () => { controlCalls += 1; } });
  const socket = new FakeSocket();
  server.handleConnection(socket);

  socket.emit("data", Buffer.from(`${JSON.stringify({
    type: "command",
    command: { type: "processHook", source: "codex", payload: { hook_event_name: "SessionStart" } }
  })}\n`));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(controlCalls, 0);
  assert.equal(processedHooks.length, 1);
  assert.equal(responses(socket).at(-1).type, "response");
});

test("invalid request ids and non-control commands fail closed", async () => {
  let calls = 0;
  const { server } = createServer({ execute: async () => { calls += 1; } });
  const socket = new FakeSocket();
  server.handleConnection(socket);
  socket.emit("data", Buffer.from('{"type":"control","id":"","command":"control.getSettings"}\n'));
  socket.emit("data", Buffer.from('{"type":"control","id":"request-3","command":"processHook"}\n'));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls, 0);
  assert.equal(responses(socket).some((response) => response.id === "request-3" && response.ok === false), true);
});
