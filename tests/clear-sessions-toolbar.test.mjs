import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(new URL("../src/renderer/island/components/IslandPanel.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/renderer/island/app.js", import.meta.url), "utf8");
const toolbar = readFileSync(new URL("../src/renderer/island/components/ToolbarTools.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/renderer/island/components/IslandPanel.css", import.meta.url), "utf8");

test("bulk session cleanup is a localized draggable toolbar action", () => {
  assert.match(panel, /function ClearSessionsToolIcon/);
  assert.match(panel, /id:\s*["']clear-sessions["']/);
  assert.match(panel, /label:\s*t\(["']session\.clear["']\)/);
  assert.match(panel, /deleteSessions\?\.\(visibleSessionIds\)/);
  assert.match(panel, /disabled:\s*visibleSessionIds\.length === 0/);
  assert.match(toolbar, /["']aria-disabled["']:\s*tool\.disabled/);
  assert.match(toolbar, /if \(tool\.disabled\) return/);
});

test("bulk session cleanup no longer consumes a session-list row", () => {
  assert.doesNotMatch(panel, /session-list-actions/);
  assert.doesNotMatch(css, /\.session-list-actions/);
});

test("the settings toggle controls tool visibility without overwriting toolbar placement", () => {
  assert.match(app, /useState\(DEFAULT_SETTINGS\.clearSessionsEnabled\)/);
  assert.match(app, /setClearSessionsEnabled\(s\.clearSessionsEnabled\)/);
  assert.match(app, /clearSessionsEnabled,/);
  assert.match(panel, /clearSessionsEnabled = true/);
  assert.match(panel, /\.\.\.\(clearSessionsEnabled \? \[\{ id: 'clear-sessions'/);
  assert.doesNotMatch(panel, /toolbarHiddenModules\s*[:=]\s*clearSessionsEnabled/);
});
