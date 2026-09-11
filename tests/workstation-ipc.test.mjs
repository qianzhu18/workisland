import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { IPC } = require("../src/shared/ipc.cjs");
const css = readFileSync(new URL("../src/renderer/island/app.css", import.meta.url), "utf8");
const panelCss = readFileSync(new URL("../src/renderer/island/components/IslandPanel.css", import.meta.url), "utf8");

test("Island preload exposes narrow media and performance contracts", () => {
  const preload = readFileSync(new URL("../src/preload/island.js", import.meta.url), "utf8");
  for (const key of ["MEDIA_GET_STATE", "MEDIA_STATE_UPDATE", "MEDIA_COMMAND", "LYRICS_GET_STATE", "LYRICS_STATE_UPDATE", "LYRICS_CLEAR_CACHE", "PERFORMANCE_GET_STATE", "PERFORMANCE_STATE_UPDATE", "PERFORMANCE_DETAILS_VISIBLE", "PERFORMANCE_PROCESS_ACTION"]) {
    assert.equal(typeof IPC[key], "string", `${key} channel must exist`);
  }
  for (const method of ["getMediaState", "onMediaStateUpdate", "mediaCommand", "getLyricsState", "onLyricsStateUpdate", "getPerformanceState", "onPerformanceUpdate", "setPerformanceDetailsVisible", "actOnProcess"]) {
    assert.match(preload, new RegExp(`${method}\\(`), `${method} must be exposed by preload`);
  }
  const coordinator = readFileSync(new URL("../src/main/app-coordinator.cjs", import.meta.url), "utf8");
  const services = readFileSync(new URL("../src/main/ipc-services.cjs", import.meta.url), "utf8");
  assert.match(coordinator, /actOnProcess\(request\)/);
  assert.match(services, /PERFORMANCE_PROCESS_ACTION/);
  const popover = readFileSync(new URL("../src/renderer/island/components/PerformancePopover.js", import.meta.url), "utf8");
  assert.match(popover, /performance\.process\.forceQuit/);
  assert.match(popover, /actOnProcess/);
  assert.match(popover, /aria-pressed/);
  assert.match(popover, /performance\.process\.viewAll/);
  assert.match(popover, /formatProcessMemory/);
  assert.match(popover, /performance-process-list/);
  assert.match(popover, /process\.protected/);
  assert.match(popover, /performance-process-status/);
  assert.match(popover, /performance\.process\.loading/);
  assert.match(popover, /performance\.process\.unavailable/);
  assert.match(popover, /performance\.process\.empty/);
  assert.match(popover, /window\.setTimeout\(\(\) => setHovered\(false\), 350\)/);
  const pill = readFileSync(new URL("../src/renderer/island/components/IslandPill.js", import.meta.url), "utf8");
  assert.match(pill, /media-wave-bar/);
  assert.match(pill, /getNotchMediaLayout/);
  const app = readFileSync(new URL("../src/renderer/island/app.js", import.meta.url), "utf8");
  assert.match(app, /useNotchMedia:\s*notchInfo\.hasNotch/);
  assert.doesNotMatch(app, /\bisDocked\b/, "reverted dock mode must not leak into workstation rendering");
  const mediaCard = readFileSync(new URL("../src/renderer/island/components/MediaCard.js", import.meta.url), "utf8");
  assert.match(mediaCard, /appIconDataUrl/);
  assert.match(mediaCard, /media-source-icon/);
  assert.doesNotMatch(mediaCard, /media-source-badge"\s*},\s*media\?\.appName/, "source badge must not render the application name as visible text");
  assert.match(mediaCard, /LyricsPanel/);
  assert.match(mediaCard, /ResizeObserver/);
  assert.doesNotMatch(mediaCard, /showLyrics\s*&&\s*React\.createElement\(LyricsPanel/, "lyrics must remain mounted while the rail grows");
  assert.match(mediaCard, /media-compact-lyric/);
  const lyricsPanel = readFileSync(new URL("../src/renderer/island/components/LyricsPanel.js", import.meta.url), "utf8");
  assert.match(lyricsPanel, /lyrics-line is-active/);
  assert.match(lyricsPanel, /4000/);
  assert.match(lyricsPanel, /"aria-hidden": mode === "compact"/);
  assert.match(css, /workspace-content\.has-media\s*\{[^}]*grid-template-columns:\s*300px minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.media-rail\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.lyrics-panel\s*\{[^}]*position:\s*absolute[^}]*bottom:/s);
  assert.match(css, /performance-process-list[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.performance-process-status\s*\{/);
});

test("custom Island backgrounds use semantic foreground tokens and a hollow performance gauge", () => {
  for (const token of [
    "--island-fg-primary",
    "--island-fg-secondary",
    "--island-fg-tertiary",
    "--island-control-fill",
    "--island-control-border",
    "--island-content-shadow",
    "--island-surface-shadow"
  ]) assert.match(css, new RegExp(token));
  assert.match(css, /\[data-island-tone="dark"\]/);
  assert.match(css, /\[data-island-tone="glass"\]/);
  assert.match(css, /\.performance-gauge\s*\{[^}]*-webkit-mask:\s*radial-gradient/s);
  assert.doesNotMatch(css, /\.performance-gauge::after\s*\{/);
  assert.match(css, /\.performance-mini\s*\{[^}]*var\(--island-fg-secondary\)/s);
  assert.match(css, /\.pill-label\s*\{[^}]*var\(--island-fg-primary\)/s);
  assert.match(panelCss, /\.token-burn-count-value\s*\{[^}]*var\(--island-fg-primary\)/s);
  assert.match(panelCss, /\.token-usage-label\s*\{[^}]*var\(--island-fg-secondary\)/s);
});
