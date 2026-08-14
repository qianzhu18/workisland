import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { selectAutomaticSurface } = require("../src/main/presentation-policy.cjs");
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

test("a completion opens only a compact surface for its session", () => {
  assert.deepEqual(
    selectAutomaticSurface({ type: "sessionCompleted", sessionId: "completed-session" }, settings),
    { type: "completion", actionableSessionId: "completed-session" }
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

test("completion notifications are also routed to an active desktop pet", () => {
  assert.doesNotMatch(
    coordinatorSource,
    /petMode\.isActive\s*&&\s*payload\.surface\.type\s*!==\s*["']completion["']/
  );
});

test("compact completion content reserves the hardware-notch safe area", () => {
  assert.match(islandPanelSource, /--island-safe-top-inset/);
  assert.match(islandPanelCss, /\.completion-notification[\s\S]*padding-top:\s*var\(--island-safe-top-inset/);
});
