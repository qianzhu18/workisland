import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { mergeSettings, createDefaultSettings, DEFAULT_SETTINGS } = require("../src/shared/settings.cjs");
const { createPresentationRequest } = require("../src/main/presentation-policy.cjs");

const coordinatorSource = readFileSync(new URL("../src/main/app-coordinator.cjs", import.meta.url), "utf8");
const settingsAppSource = readFileSync(new URL("../src/renderer/settings-app.js", import.meta.url), "utf8");
const rendererDefaultsSource = readFileSync(new URL("../src/renderer/shared/settings.js", import.meta.url), "utf8");

const baseNotificationSettings = {
  expandOnSessionSubmit: true,
  expandOnSessionComplete: true,
  expandOnActionRequired: true
};

// ── Default & migration ─────────────────────────────────────────────────────

test("fresh installs default to minimal display mode", () => {
  assert.equal(DEFAULT_SETTINGS.islandDisplayMode, "minimal");
  assert.equal(createDefaultSettings().islandDisplayMode, "minimal");
  assert.equal(mergeSettings({}).islandDisplayMode, "minimal");
});

test("renderer default settings mirror the shared minimal default", () => {
  assert.match(rendererDefaultsSource, /islandDisplayMode:\s*"minimal"/);
  assert.doesNotMatch(rendererDefaultsSource, /alwaysHide|hideWhenNoActiveSessions/);
});

test("legacy booleans are migrated once and then removed from the merged settings", () => {
  // Pre-notification-mode installs were forced to alwaysHide=true by the old
  // migration; the stored false is not a user choice.
  assert.equal(mergeSettings({ alwaysHide: false }).islandDisplayMode, "minimal");
  // Explicit persistent preference survives migration.
  assert.equal(
    mergeSettings({ alwaysHide: false, notificationModeVersion: 1 }).islandDisplayMode,
    "persistent"
  );
  // Notification mode kept on equals minimal.
  assert.equal(
    mergeSettings({ alwaysHide: true, notificationModeVersion: 1 }).islandDisplayMode,
    "minimal"
  );
  // "Hide when no active sessions" is an idle-hidden preference → minimal.
  assert.equal(
    mergeSettings({ alwaysHide: false, hideWhenNoActiveSessions: true, notificationModeVersion: 1 }).islandDisplayMode,
    "minimal"
  );

  const merged = mergeSettings({ alwaysHide: false, notificationModeVersion: 1 });
  assert.ok(!("alwaysHide" in merged));
  assert.ok(!("notificationModeVersion" in merged));
  assert.ok(!("hideWhenNoActiveSessions" in merged));
});

test("an existing islandDisplayMode is never overwritten by legacy fields", () => {
  const persisted = mergeSettings({
    islandDisplayMode: "persistent",
    alwaysHide: true,
    notificationModeVersion: 1,
    hideWhenNoActiveSessions: true
  });
  assert.equal(persisted.islandDisplayMode, "persistent");
  const persistedMinimal = mergeSettings({ islandDisplayMode: "minimal", alwaysHide: false, notificationModeVersion: 1 });
  assert.equal(persistedMinimal.islandDisplayMode, "minimal");
});

test("an invalid islandDisplayMode value falls back to the migration result", () => {
  assert.equal(mergeSettings({ islandDisplayMode: "always", alwaysHide: false, notificationModeVersion: 1 }).islandDisplayMode, "persistent");
});

// ── Runtime reads only islandDisplayMode ────────────────────────────────────

test("the coordinator conceal logic reads only islandDisplayMode", () => {
  assert.match(coordinatorSource, /this\.settings\.islandDisplayMode === "minimal"\) return true;/);
  assert.doesNotMatch(coordinatorSource, /this\.settings\.alwaysHide|this\.settings\.hideWhenNoActiveSessions/);
});

test("switching the display mode re-evaluates visibility immediately", () => {
  assert.match(coordinatorSource, /"hideWhenFullscreen" in partial \|\| "islandDisplayMode" in partial/);
});

// ── Both modes keep required notifications visible ──────────────────────────

for (const mode of ["minimal", "persistent"]) {
  const settings = { ...baseNotificationSettings, islandDisplayMode: mode };

  test(`[${mode}] submission and completion surfaces appear briefly`, () => {
    const submission = createPresentationRequest(
      { type: "sessionStarted", sessionId: "s1", latestUserPrompt: "Ship it" },
      settings
    );
    assert.equal(submission.priority, "submission");
    assert.equal(submission.autoDismiss, true);
    const completion = createPresentationRequest({ type: "sessionCompleted", sessionId: "s1" }, settings);
    assert.equal(completion.priority, "completion");
    assert.equal(completion.autoDismiss, true);
  });

  test(`[${mode}] approval, question and error surfaces stay visible`, () => {
    for (const event of [
      { type: "permissionRequested", sessionId: "s1" },
      { type: "questionAsked", sessionId: "s1" }
    ]) {
      const request = createPresentationRequest(event, settings);
      assert.equal(request.priority, "action-required");
      assert.equal(request.autoDismiss, false, `${event.type} must not auto-hide`);
      assert.equal(request.suppressWhenFocused, false, `${event.type} must survive focus loss`);
    }
    const error = createPresentationRequest({ type: "sessionCompleted", sessionId: "s1", error: "boom" }, settings);
    assert.equal(error.priority, "error");
    assert.equal(error.autoDismiss, false, "errors must not auto-hide");
  });

  test(`[${mode}] idle state opens no surface`, () => {
    assert.equal(createPresentationRequest({ type: "sessionStarted", sessionId: "s1" }, settings), null);
  });
}

test("action-required surfaces are not suppressed when WorkIsland is focused", () => {
  for (const mode of ["minimal", "persistent"]) {
    const request = createPresentationRequest(
      { type: "permissionRequested", sessionId: "s1" },
      { ...baseNotificationSettings, islandDisplayMode: mode }
    );
    assert.equal(request.suppressWhenFocused, false);
  }
});

// ── Settings UI ─────────────────────────────────────────────────────────────

test("settings expose a positive minimal / persistent choice instead of negative toggles", () => {
  assert.match(settingsAppSource, /Island 显示模式/);
  assert.match(settingsAppSource, /\[\["minimal", "极简（推荐）"\], \["persistent", "常驻"\]\]/);
  assert.match(settingsAppSource, /save\(\{ islandDisplayMode: v \}\)/);
  assert.doesNotMatch(settingsAppSource, /alwaysHide|hideWhenNoActiveSessions/);
});
