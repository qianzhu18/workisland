import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { IPC } = require("../src/shared/ipc.cjs");

// Renderer files are authored ESM with vendor imports, so this suite follows
// the repo's source-contract pattern (string assertions on the wired files)
// plus pure-function coverage where logic is extractable.

const islandPanelSource = readFileSync(new URL("../src/renderer/island/components/IslandPanel.js", import.meta.url), "utf8");
const islandAppSource = readFileSync(new URL("../src/renderer/island/app.js", import.meta.url), "utf8");
const islandPreloadSource = readFileSync(new URL("../src/preload/island.js", import.meta.url), "utf8");
const ipcServicesSource = readFileSync(new URL("../src/main/ipc-services.cjs", import.meta.url), "utf8");
const coordinatorSource = readFileSync(new URL("../src/main/app-coordinator.cjs", import.meta.url), "utf8");

test("IPC exposes the active-template status channel end to end", () => {
  assert.equal(IPC.TEMPLATE_GET_ACTIVE_STATUS_ASSETS, "template:get-active-status-assets");
  assert.ok(ipcServicesSource.includes("TEMPLATE_GET_ACTIVE_STATUS_ASSETS"), "ipc-services must handle the channel");
  assert.ok(islandPreloadSource.includes("getActiveTemplateStatusAssets"), "island preload must expose the fetcher");
});

test("IslandPanel keeps build-time assets as fallback and supports runtime override", () => {
  assert.ok(islandPanelSource.includes("DEFAULT_STATUS_ICONS"), "five build-time icons remain the fallback");
  assert.ok(islandPanelSource.includes("setIslandStatusAssets"), "runtime override entrypoint exists");
  assert.ok(islandPanelSource.includes("useIslandStatusIcons"), "React hook subscribes to overrides");
  // session.error wins over phase; both waiting phases share approval.
  assert.ok(islandPanelSource.includes("resolveSessionIcon"));
  assert.match(
    islandPanelSource,
    /if \(session\?\.error\) return icons\.error;/,
    "error state must take priority over phase icons"
  );
  assert.match(
    islandPanelSource,
    /phase === "waitingForApproval" \|\| phase === "waitingForAnswer"/,
    "both waiting phases must share the approval icon"
  );
});

test("app.js reloads status assets whenever the active template changes", () => {
  assert.ok(islandAppSource.includes("getActiveTemplateStatusAssets"), "app.js fetches status assets");
  assert.ok(islandAppSource.includes("setIslandPanelStatusAssets"), "app.js applies them to IslandPanel");
  assert.match(
    islandAppSource,
    /\[appearanceTemplate\?\.id, appearanceTemplate\?\.version\]/,
    "effect must depend on the template id and version"
  );
  assert.match(islandAppSource, /result\?\.assets \?\? null/, "null assets keep build-time fallback");
});

test("main process owns the builtin fallback for status assets", () => {
  assert.ok(coordinatorSource.includes("getActiveTemplateStatusAssets"), "coordinator exposes the resolver");
  assert.match(
    coordinatorSource,
    /return \{ assets: null \};/,
    "resolver failures must degrade to null, never throw at the renderer"
  );
});

test("renderer status SVGs are byte-identical to the builtin package (drift guard source)", () => {
  for (const name of ["idle", "running", "approval", "complete", "error"]) {
    const renderer = readFileSync(new URL(`../src/renderer/island/assets/status/${name}.svg`, import.meta.url));
    const builtin = readFileSync(new URL(`../resources/templates/builtin/workisland-xiaoyu/island-status/${name}.svg`, import.meta.url));
    assert.ok(renderer.equals(builtin), `${name}.svg drifted between renderer fallback and builtin package`);
  }
});
