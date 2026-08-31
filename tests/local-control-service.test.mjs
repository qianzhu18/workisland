import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createDefaultSettings } = require("../src/shared/settings.cjs");
const { LocalControlService } = require("../src/main/local-control-service.cjs");

function createHarness(overrides = {}) {
  let settings = { ...createDefaultSettings(), localAgentControlEnabled: true };
  const updates = [];
  const focused = [];
  const opened = [];
  const surfaces = [];
  const notices = [];
  const sessions = overrides.sessions || [];
  const audit = [];
  const service = new LocalControlService({
    getSettings: () => settings,
    updateSettings: (partial, source) => {
      updates.push({ partial, source });
      settings = { ...settings, ...partial };
    },
    getInstalledPetIds: () => new Set(["codex:qianxue", "custom:fox"]),
    getSessions: () => sessions,
    jumpToSession: async (id) => focused.push(id),
    openSettingsTab: (section) => opened.push(section),
    setDisplaySurface: (surface) => surfaces.push(surface),
    presentSettingsChange: (notice) => notices.push(notice),
    getProductState: () => ({ displaySurface: "island", expanded: false }),
    audit: { append: (record) => audit.push(record), list: () => audit },
    now: () => 1_800_000_000_000,
    randomId: (() => {
      let value = 0;
      return (prefix) => `${prefix}-${++value}`;
    })(),
    ...overrides.dependencies
  });
  return { service, getSettings: () => settings, updates, focused, opened, surfaces, notices, audit };
}

test("every local control request is rejected while the master switch is off", async () => {
  const harness = createHarness({
    dependencies: { getSettings: () => createDefaultSettings() }
  });

  await assert.rejects(
    harness.service.execute("control.getSettings", {}, { name: "Codex" }),
    (error) => error.code === "LOCAL_CONTROL_DISABLED"
  );
  assert.equal(harness.updates.length, 0);
});

test("a valid multi-setting update is applied atomically and returns an undo id", async () => {
  const harness = createHarness();

  const result = await harness.service.execute(
    "control.updateSettings",
    { changes: { completionPopupDurationSec: 10, "sound.volume": 35 } },
    { name: "Codex Desktop", version: "1.2.3" }
  );

  assert.equal(harness.updates.length, 1);
  assert.equal(harness.updates[0].source, "local-agent");
  assert.equal(harness.getSettings().completionPopupDurationSec, 10);
  assert.equal(harness.getSettings().sound.volume, 35);
  assert.equal(result.changeId, "change-1");
  assert.deepEqual(result.changes, [
    { key: "completionPopupDurationSec", oldValue: 5, newValue: 10 },
    { key: "sound.volume", oldValue: 50, newValue: 35 }
  ]);
  assert.equal(harness.notices.length, 1);
  assert.equal(harness.notices[0].client, "Codex Desktop");
});

test("one invalid setting rejects the whole update", async () => {
  const harness = createHarness();

  await assert.rejects(
    harness.service.execute("control.updateSettings", {
      changes: { mediaEnabled: false, telemetryEnabled: false }
    }),
    (error) => error.code === "SETTING_NOT_ALLOWED"
  );

  assert.equal(harness.updates.length, 0);
  assert.equal(harness.getSettings().mediaEnabled, true);
});

test("undo restores values only while they still equal the agent-written values", async () => {
  const harness = createHarness();
  const changed = await harness.service.execute("control.updateSettings", {
    changes: { completionPopupDurationSec: 12 }
  });

  const undone = await harness.service.execute("control.undoSettingsChange", { changeId: changed.changeId });
  assert.equal(undone.undone, true);
  assert.equal(harness.getSettings().completionPopupDurationSec, 5);

  const newer = await harness.service.execute("control.updateSettings", {
    changes: { completionPopupDurationSec: 15 }
  });
  harness.getSettings().completionPopupDurationSec = 20;

  await assert.rejects(
    harness.service.execute("control.undoSettingsChange", { changeId: newer.changeId }),
    (error) => error.code === "UNDO_CONFLICT"
  );
  assert.equal(harness.getSettings().completionPopupDurationSec, 20);
});

test("safe UI operations are allowlisted", async () => {
  const harness = createHarness();

  await harness.service.execute("control.openSettings", { section: "agent-control" });
  await harness.service.execute("control.setDisplaySurface", { surface: "pet" });
  assert.deepEqual(harness.opened, ["agent-control"]);
  assert.deepEqual(harness.surfaces, ["pet"]);

  await assert.rejects(
    harness.service.execute("control.openSettings", { section: "https://example.com" }),
    (error) => error.code === "ACTION_NOT_ALLOWED"
  );
  await assert.rejects(
    harness.service.execute("control.deleteSession", { id: "anything" }),
    (error) => error.code === "UNKNOWN_COMMAND"
  );
});

