import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const settingsSource = readFileSync(new URL("../src/renderer/settings-app.js", import.meta.url), "utf8");
const islandSource = readFileSync(new URL("../src/renderer/island/app.js", import.meta.url), "utf8");
const ipcSource = readFileSync(new URL("../src/shared/ipc.cjs", import.meta.url), "utf8");
const nativeSource = readFileSync(new URL("../native/panel-fix/src/panel_fix.mm", import.meta.url), "utf8");

test("appearance backgrounds do not create a second native blur surface", () => {
  assert.doesNotMatch(settingsSource, /background\.blur\.title|withAppearanceBackgroundBlur|backgroundBlur/);
  assert.doesNotMatch(islandSource, /setIslandBlurShape|backgroundBlur/);
  assert.doesNotMatch(ipcSource, /ISLAND_BLUR_SHAPE/);
  assert.doesNotMatch(nativeSource, /WorkIslandBlurView|setIslandBlur|SetIslandBlur/);
});
