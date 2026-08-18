import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { selectAutomaticSurface, createPresentationRequest } = require("../src/main/presentation-policy.cjs");
const coordinatorSource = readFileSync(new URL("../src/main/app-coordinator.cjs", import.meta.url), "utf8");
const islandPanelSource = readFileSync(new URL("../src/renderer/island/components/IslandPanel.js", import.meta.url), "utf8");
const islandPanelCss = readFileSync(new URL("../src/renderer/island/components/IslandPanel.css", import.meta.url), "utf8");

const settings = {
  expandOnSessionComplete: true,
  expandOnActionRequired: true
};

test("a normal session start does not open a surface", () => {
  assert.equal(selectAutomaticSurface({ type: "sessionStarted", sessionId: "a" }, settings), null);
});

test("a submitted prompt opens a short-lived filtered notification", () => {
  assert.deepEqual(
    createPresentationRequest({ type: "sessionStarted", sessionId: "submitted-session", latestUserPrompt: "Ship it" }, {
      ...settings,
      expandOnSessionSubmit: true
    }),
    {
      surface: { type: "sessionList", actionableSessionId: "submitted-session", visibleSessionIds: ["submitted-session"] },
      priority: "submission",
      autoDismiss: true,
      suppressWhenFocused: false
    }
  );
});

test("submission notifications can be disabled without affecting completion notifications", () => {
  assert.equal(
    selectAutomaticSurface({ type: "activityUpdated", sessionId: "a", latestUserPrompt: "Ship it" }, {
      ...settings,
      expandOnSessionSubmit: false
    }),
    null
  );
});

test("a completion opens the hover-equivalent panel filtered to its session", () => {
  assert.deepEqual(
    createPresentationRequest({ type: "sessionCompleted", sessionId: "completed-session" }, settings),
    {
      surface: { type: "sessionList", actionableSessionId: "completed-session", visibleSessionIds: ["completed-session"] },
      priority: "completion",
      autoDismiss: true,
      suppressWhenFocused: false
    }
  );
});

test("approval and question events retain their targeted actionable surface", () => {
  assert.deepEqual(
    selectAutomaticSurface({ type: "permissionRequested", sessionId: "approval-session" }, settings),
    { type: "sessionList", actionableSessionId: "approval-session" }
  );
  assert.deepEqual(
    selectAutomaticSurface({ type: "questionAsked", sessionId: "question-session" }, settings),
    { type: "sessionList", actionableSessionId: "question-session" }
  );
});

test("disabled notification settings suppress their respective automatic surfaces", () => {
  assert.equal(
    selectAutomaticSurface({ type: "sessionCompleted", sessionId: "a" }, { ...settings, expandOnSessionComplete: false }),
    null
  );
  assert.equal(
    selectAutomaticSurface({ type: "permissionRequested", sessionId: "a" }, { ...settings, expandOnActionRequired: false }),
    null
  );
});

test("action-required and error requests remain visible", () => {
  assert.equal(createPresentationRequest({ type: "permissionRequested", sessionId: "approval-session" }, settings).autoDismiss, false);
  assert.equal(createPresentationRequest({ type: "permissionRequested", sessionId: "approval-session" }, settings).suppressWhenFocused, false);
  assert.equal(createPresentationRequest({ type: "sessionCompleted", sessionId: "failed-session", error: "failed" }, settings).autoDismiss, false);
});

test("an active desktop pet is the exclusive automatic-notification surface", () => {
  assert.match(coordinatorSource, /this\.petMode\.isActive[\s\S]*?this\.petMode\.presentSurface[\s\S]*?return;/);
});

test("completion notifications use the regular hover panel, not a compact card", () => {
  assert.match(islandPanelSource, /AgentUsageRow/);
  assert.doesNotMatch(islandPanelSource, /completion-notification/);
  assert.doesNotMatch(islandPanelCss, /\.completion-notification/);
});
