import assert from "node:assert/strict";
import test from "node:test";
import settings from "../src/shared/settings.cjs";

test("workstation features default to useful, privacy-conscious behavior", () => {
  assert.equal(settings.DEFAULT_SETTINGS.mediaEnabled, true);
  assert.equal(settings.DEFAULT_SETTINGS.mediaTrackChangeNotifications, true);
  assert.equal(settings.DEFAULT_SETTINGS.performanceEnabled, true);
  assert.equal(settings.DEFAULT_SETTINGS.performanceAlertsEnabled, false);
});

test("persisted workstation preferences survive settings merge", () => {
  const merged = settings.mergeSettings({
    mediaEnabled: false,
    mediaTrackChangeNotifications: false,
    performanceEnabled: false,
    performanceAlertsEnabled: true
  });
  assert.equal(merged.mediaEnabled, false);
  assert.equal(merged.mediaTrackChangeNotifications, false);
  assert.equal(merged.performanceEnabled, false);
  assert.equal(merged.performanceAlertsEnabled, true);
});
