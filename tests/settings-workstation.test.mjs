import assert from "node:assert/strict";
import test from "node:test";
import settings from "../src/shared/settings.cjs";

test("workstation features default to useful, privacy-conscious behavior", () => {
  assert.equal(settings.DEFAULT_SETTINGS.mediaEnabled, true);
  assert.equal(settings.DEFAULT_SETTINGS.mediaTrackChangeNotifications, true);
  assert.equal(settings.DEFAULT_SETTINGS.lyricsEnabled, false);
  assert.equal(settings.DEFAULT_SETTINGS.performanceEnabled, true);
  assert.equal(settings.DEFAULT_SETTINGS.performanceAlertsEnabled, false);
  assert.equal(settings.DEFAULT_SETTINGS.fileShelfEnabled, true);
  assert.equal(settings.DEFAULT_SETTINGS.clipboardHistoryEnabled, false);
  assert.equal(settings.DEFAULT_SETTINGS.terminalEnabled, true);
  assert.equal(settings.DEFAULT_SETTINGS.clipboardHistoryLimit, 100);
  assert.equal(settings.DEFAULT_SETTINGS.clipboardRetentionHours, 24);
  assert.equal(settings.DEFAULT_SETTINGS.toolboxReopenMode, "agent");
});

test("toolbox reopen preference defaults safely and preserves supported choices", () => {
  assert.equal(settings.mergeSettings({ toolboxReopenMode: "last" }).toolboxReopenMode, "last");
  assert.equal(settings.mergeSettings({ toolboxReopenMode: "unknown" }).toolboxReopenMode, "agent");
});

test("persisted workstation preferences survive settings merge", () => {
  const merged = settings.mergeSettings({
    mediaEnabled: false,
    mediaTrackChangeNotifications: false,
    lyricsEnabled: true,
    performanceEnabled: false,
    performanceAlertsEnabled: true
  });
  assert.equal(merged.mediaEnabled, false);
  assert.equal(merged.mediaTrackChangeNotifications, false);
  assert.equal(merged.lyricsEnabled, true);
  assert.equal(merged.performanceEnabled, false);
  assert.equal(merged.performanceAlertsEnabled, true);
});

test("productivity settings normalize unsafe persisted values", () => {
  const merged = settings.mergeSettings({
    clipboardHistoryLimit: 9999,
    clipboardRetentionHours: -2,
    terminalSavedCommands: [
      { id: "tests", name: "运行测试", command: "npm test", cwdMode: "agent-project" },
      { id: "bad", name: "", command: "rm -rf /" }
    ]
  });
  assert.equal(merged.clipboardHistoryLimit, 100);
  assert.equal(merged.clipboardRetentionHours, 24);
  assert.deepEqual(merged.terminalSavedCommands, [
    { id: "tests", name: "运行测试", command: "npm test", cwdMode: "agent-project" }
  ]);
});
