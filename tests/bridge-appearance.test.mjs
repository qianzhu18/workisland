import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createBridgeServerClass } = require("../src/main/bridge-server.cjs");
const { createAppearanceController } = require("../src/main/appearance-controller.cjs");

class TestPluginAdapter {}
class TestTranscriptWatcher {
  constructor() {}
}
const TestBridgeServer = createBridgeServerClass({
  adapterRegistry: new Map(),
  PluginAdapter: TestPluginAdapter,
  ClaudeTranscriptWatcher: TestTranscriptWatcher,
  createHookPayloadRecorder: () => null,
  isPluginAgentTool: () => false,
  normalizeAgentPid: () => undefined,
  normalizeIdeWorkspace: () => undefined,
  normalizeTerminalAppForHookSource: () => undefined,
  parseTokenUsagePayload: () => undefined,
  getOriginalQuestions: () => [],
  getStructuredOriginalQuestions: () => [],
  mapStructuredAnswersToClaude: () => ({}),
  mapStructuredAnswersToOpenCode: () => [],
  renderAnswerSummary: () => ""
});

function createBridgeWithClient(controller) {
  const bridge = new TestBridgeServer();
  if (controller) bridge.setAppearanceController(controller);
  const lines = [];
  bridge.clients.set("client-1", {
    id: "client-1",
    socket: { write: (chunk) => lines.push(chunk.toString("utf8")) },
    buffer: Buffer.alloc(0)
  });
  return { bridge, readResponses: () => lines.map((line) => JSON.parse(line)) };
}

function lastResponse(responses) {
  const frame = responses[responses.length - 1];
  assert.equal(frame.type, "response");
  return frame.response;
}

function createFixtureController() {
  const saved = [];
  const settings = { islandAppearance: { kind: "default" }, petSprite: "codex:qianxue", petScale: 1 };
  const controller = createAppearanceController({
    appearanceService: {
      listBackgroundImages: () => [{ imageRef: "bg-x.png", bytes: 42 }]
    },
    getSettings: () => settings,
    updateSettings: (partial) => {
      Object.assign(settings, partial);
      saved.push(partial);
    }
  });
  return { controller, saved, settings };
}

test("appearance commands flow through the bridge with result envelopes", async () => {
  const { controller, saved, settings } = createFixtureController();
  const { bridge, readResponses } = createBridgeWithClient(controller);

  bridge.handleCommand("client-1", { type: "getAppearance" });
  await waitFor(() => readResponses().length > 0);
  const snapshot = lastResponse(readResponses());
  assert.equal(snapshot.type, "result");
  assert.equal(snapshot.data.islandAppearance.kind, "default");
  assert.equal(snapshot.data.petSprite, "codex:qianxue");
  assert.deepEqual(snapshot.data.availableBackgrounds, [{ imageRef: "bg-x.png", bytes: 42 }]);

  bridge.handleCommand("client-1", { type: "setAppearance", appearance: { kind: "solid", color: "#0B1E3A" } });
  await waitFor(() => readResponses().length > 1);
  const applied = lastResponse(readResponses());
  assert.equal(applied.type, "result");
  assert.deepEqual(applied.data.appearance, { kind: "solid", color: "#0b1e3a", opacity: 1 });
  assert.deepEqual(saved, [{ islandAppearance: { kind: "solid", color: "#0b1e3a", opacity: 1 } }]);
  assert.equal(settings.islandAppearance.color, "#0b1e3a");

  bridge.handleCommand("client-1", { type: "resetAppearance" });
  await waitFor(() => readResponses().length > 2);
  const reset = lastResponse(readResponses());
  assert.deepEqual(reset.data.appearance, { kind: "default" });
  assert.deepEqual(settings.islandAppearance, { kind: "default" });
});

test("validation failures return structured VALIDATION errors without saving", async () => {
  const { controller, saved } = createFixtureController();
  const { bridge, readResponses } = createBridgeWithClient(controller);

  bridge.handleCommand("client-1", { type: "setAppearance", appearance: { kind: "solid", color: "sparkles" } });
  await waitFor(() => readResponses().length > 0);
  const error = lastResponse(readResponses());
  assert.equal(error.type, "error");
  assert.equal(error.code, "VALIDATION");
  assert.ok(error.message.includes("颜色"));
  assert.equal(saved.length, 0);

  bridge.handleCommand("client-1", { type: "setAppearance", appearance: { kind: "image", imageDim: 0.4 } });
  await waitFor(() => readResponses().length > 1);
  const missingImage = lastResponse(readResponses());
  assert.equal(missingImage.code, "VALIDATION");
  assert.ok(missingImage.message.includes("image"));
});

test("setPet rejects unresolvable sprites with an error envelope", async () => {
  const { controller } = createFixtureController();
  const { bridge, readResponses } = createBridgeWithClient(controller);
  bridge.handleCommand("client-1", { type: "setPet", sprite: "../escape.png" });
  await waitFor(() => readResponses().length > 0);
  const error = lastResponse(readResponses());
  assert.equal(error.type, "error");
  assert.ok(error.message.length > 0);
});

test("unknown controller state answers UNAVAILABLE instead of hanging", async () => {
  const { bridge, readResponses } = createBridgeWithClient(null);
  bridge.handleCommand("client-1", { type: "getAppearance" });
  await waitFor(() => readResponses().length > 0);
  const error = lastResponse(readResponses());
  assert.equal(error.type, "error");
  assert.equal(error.code, "UNAVAILABLE");
});

test("appearance controller bright colors are darkened and reported", async () => {
  const { controller, saved } = createFixtureController();
  const { bridge, readResponses } = createBridgeWithClient(controller);
  bridge.handleCommand("client-1", { type: "setAppearance", appearance: { kind: "solid", color: "#FFFFFF" } });
  await waitFor(() => readResponses().length > 0);
  const result = lastResponse(readResponses());
  assert.equal(result.type, "result");
  assert.notEqual(result.data.appearance.color, "#ffffff");
  assert.equal(result.data.warnings.length, 1);
  assert.notEqual(saved[0].islandAppearance.color, "#ffffff");
});

function waitFor(predicate, timeoutMs = 2000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - startedAt > timeoutMs) return reject(new Error("waitFor timeout"));
      setImmediate(tick);
    };
    tick();
  });
}
