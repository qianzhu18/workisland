import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createTelemetryService } = require("../src/main/telemetry-service.cjs");
const { EVENTS, sanitizeProps } = require("../src/shared/telemetry.cjs");

function makeService({
  telemetryEnabled = true,
  isPackaged = true,
  apiKey = "phc-test-key",
  requests = [],
  fetchImpl = async () => ({ ok: true })
} = {}) {
  const userDataPath = mkdtempSync(join(tmpdir(), "workisland-telemetry-"));
  const settings = { telemetryEnabled };
  const service = createTelemetryService({
    getSettings: () => settings,
    isPackaged,
    appVersion: "0.3.0-test",
    osVersion: "darwin 24.6.0",
    userDataPath,
    apiKey,
    fetchImpl: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      return fetchImpl();
    },
    logger: { warn() {} }
  });
  return { service, settings, requests, userDataPath };
}

test("sanitizeProps drops unknown properties and long values", () => {
  const clean = sanitizeProps(EVENTS.SESSION_STARTED, {
    tool: "claude",
    sessionId: "should-be-dropped",
    prompt: "user prompt content must never pass"
  });
  assert.deepEqual(clean, { tool: "claude" });

  const tooLong = sanitizeProps(EVENTS.JUMP_BACK, { tool: "x".repeat(200), target: "ghostty" });
  assert.deepEqual(tooLong, { target: "ghostty" });

  assert.deepEqual(sanitizeProps(EVENTS.APP_LAUNCHED, { anything: "else" }), {});
});

test("without consent nothing is queued or sent", async () => {
  const { service, requests } = makeService({ telemetryEnabled: false });
  service.track(EVENTS.SESSION_STARTED, { tool: "claude" });
  service.markFirstAgentSignal("claude");
  await service.flush();
  assert.equal(service.queueLength(), 0);
  assert.equal(requests.length, 0);
  assert.equal(service.isConsented(), false);
});

test("a launch can be recorded only after the user consents", () => {
  const { service, settings } = makeService({ telemetryEnabled: false });
  service.track(EVENTS.APP_LAUNCHED);
  assert.equal(service.queueLength(), 0, "pre-consent launch is never retained");

  settings.telemetryEnabled = true;
  service.track(EVENTS.APP_LAUNCHED);
  assert.equal(service.queueLength(), 1, "first-launch consent can create an activation cohort");
});

test("consent queues whitelisted events and flush clears them on success", async () => {
  const { service, requests } = makeService();
  service.track(EVENTS.SESSION_STARTED, { tool: "claude", evil: "drop-me" });
  service.track(EVENTS.JUMP_BACK, { tool: "codex", target: "ghostty" });
  assert.equal(service.queueLength(), 2);
  await service.flush();

  assert.equal(requests.length, 1);
  const batch = requests[0].body.batch;
  assert.equal(batch.length, 2);
  assert.equal(batch[0].event, EVENTS.SESSION_STARTED);
  assert.deepEqual(batch[0].properties.tool, "claude");
  assert.equal("evil" in batch[0].properties, false);
  assert.equal(batch[0].properties.appVersion, "0.3.0-test");
  assert.equal(typeof batch[0].distinct_id, "string");
  assert.equal(service.queueLength(), 0);
});

test("first agent signal is emitted at most once per installation", async () => {
  const { service, requests } = makeService();
  service.markFirstAgentSignal("claude");
  service.markFirstAgentSignal("codex");
  await service.flush();
  const signals = requests[0].body.batch.filter((e) => e.event === EVENTS.FIRST_AGENT_SIGNAL);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].properties.tool, "claude");
});

test("first agent signal is not consumed before telemetry consent", () => {
  const { service, settings } = makeService({ telemetryEnabled: false });
  service.markFirstAgentSignal("claude");
  assert.equal(service.queueLength(), 0);

  settings.telemetryEnabled = true;
  service.markFirstAgentSignal("claude");
  assert.equal(service.queueLength(), 1);
});

test("failed uploads keep the queue for the next retry", async () => {
  const { service, requests } = makeService({ fetchImpl: async () => ({ ok: false, status: 500 }) });
  service.track(EVENTS.SESSION_COMPLETED, { tool: "kimi" });
  await service.flush();
  assert.equal(requests.length, 1);
  assert.equal(service.queueLength(), 1, "queue survives a failed flush");
});

test("development builds never upload", async () => {
  const { service, requests } = makeService({ isPackaged: false });
  service.track(EVENTS.APP_LAUNCHED);
  await service.flush();
  assert.equal(requests.length, 0);
});

test("missing api key disables uploads but keeps local queueing", async () => {
  const { service, requests } = makeService({ apiKey: "" });
  service.track(EVENTS.APP_LAUNCHED);
  await service.flush();
  assert.equal(service.queueLength(), 1);
  assert.equal(requests.length, 0);
});

test("disabling consent wipes the pending queue immediately", async () => {
  const { service, settings } = makeService();
  service.track(EVENTS.SESSION_STARTED, { tool: "claude" });
  settings.telemetryEnabled = false;
  service.setEnabled(false);
  assert.equal(service.queueLength(), 0);
  const pending = readFileSync(service.getPendingPath(), "utf8");
  assert.equal(JSON.parse(pending).length, 0, "pending.json is emptied on disk too");
  await service.flush();
});

test("queue caps at the configured maximum by dropping the oldest", () => {
  const { service } = makeService();
  for (let index = 0; index < 520; index += 1) {
    service.track(EVENTS.SESSION_STARTED, { tool: `agent-${index}` });
  }
  assert.equal(service.queueLength(), 500);
});

test("trackSettingChange only reports whitelisted keys without values", async () => {
  const { service, requests } = makeService();
  service.trackSettingChange("launchAtLogin");
  service.trackSettingChange("approvalModes"); // whitelisted? no — must be dropped
  service.trackSettingChange("sound.enabled");
  await service.flush();
  const keys = requests[0].body.batch.map((e) => e.properties.key);
  assert.deepEqual(keys.sort(), ["launchAtLogin", "sound.enabled"]);
});

test("queue persists to disk and survives service restarts", async () => {
  const first = makeService({ fetchImpl: async () => ({ ok: false }) });
  first.service.track(EVENTS.SESSION_STARTED, { tool: "claude" });
  first.service.stop();

  assert.equal(existsSync(first.service.getPendingPath()), true);
  const second = createTelemetryService({
    getSettings: () => ({ telemetryEnabled: true }),
    isPackaged: true,
    appVersion: "0.3.0-test",
    osVersion: "darwin 24.6.0",
    userDataPath: first.userDataPath,
    apiKey: "phc-test-key",
    fetchImpl: async () => ({ ok: true }),
    logger: { warn() {} }
  });
  assert.equal(second.queueLength(), 1, "queued event is reloaded from pending.json");
  await second.flush();
  assert.equal(second.queueLength(), 0);
});
