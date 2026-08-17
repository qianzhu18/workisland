import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { createWindowClasses } = require("../src/main/windows.cjs");

const settingsSource = readFileSync(new URL("../src/renderer/settings-app.js", import.meta.url), "utf8");
const welcomeSource = readFileSync(new URL("../src/renderer/assets/welcome-view.js", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../src/preload/welcome.js", import.meta.url), "utf8");
const sharedSource = readFileSync(new URL("../src/shared/settings.cjs", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main/index.cjs", import.meta.url), "utf8");
const windowSource = readFileSync(new URL("../src/main/windows.cjs", import.meta.url), "utf8");

test("settings about page exposes the opt-in telemetry toggle", () => {
  assert.match(settingsSource, /匿名使用统计/);
  assert.match(settingsSource, /save\(\{ telemetryEnabled: v \}\)/);
  // 关闭语义必须向用户说明：清空未上报数据。
  assert.match(settingsSource, /清空未上报的数据/);
});

test("welcome consent card defaults to unchecked and submits with get-started", () => {
  assert.match(welcomeSource, /useState\(false\)/);
  assert.match(welcomeSource, /允许匿名使用统计/);
  assert.match(welcomeSource, /getStarted\(\{ telemetry \}\)/);
});

test("welcome preload forwards the telemetry payload", () => {
  assert.match(preloadSource, /WELCOME_GET_STARTED, payload \|\| \{\}/);
});

test("first-launch opt-in records the launch only after consent", () => {
  assert.match(mainSource, /createTelemetryConsentChoice\(payload\.telemetry\)/);
  assert.match(mainSource, /choice\.telemetryEnabled\) telemetryService\?\.track\(EVENTS\.APP_LAUNCHED\)/);
});

test("telemetry stays opt-in by default in shared settings", () => {
  assert.match(sharedSource, /telemetryEnabled: false/);
});

test("upgraded users see a standalone consent window once", () => {
  assert.match(mainSource, /isTelemetryConsentPending\(coordinator\.getSettings\(\)\)/);
  assert.match(mainSource, /showWelcomeWindow\(\{\s*consentOnly: true,\s*afterComplete: startIsland\s*\}\)/);
  assert.match(windowSource, /\?mode=telemetry/);
  assert.match(welcomeSource, /telemetryConsentOnly/);
  assert.match(welcomeSource, /你的隐私选择/);
});

test("telemetry consent is independent from the auto-hiding Island window", () => {
  let browserWindowOptions;
  class FakeBrowserWindow {
    constructor(options) {
      browserWindowOptions = options;
    }
    loadFile() {}
    once() {}
  }

  const { WelcomeWindow } = createWindowClasses({
    electron: { BrowserWindow: FakeBrowserWindow },
    path,
    utils: { is: { dev: false } },
    IPC: {},
    fixPanel() {},
    fixPetWindow() {},
    setWindowCornerRadius() {},
    log: { debug() {}, error() {}, warn() {} },
    isVisibleInIsland() { return false; },
    getIsQuitting() { return false; }
  });

  new WelcomeWindow({
    consentOnly: true,
    parent: { isDestroyed: () => false }
  });

  assert.equal("parent" in browserWindowOptions, false);
  assert.equal("modal" in browserWindowOptions, false);
});

test("closing the consent window cannot silently record a decision", () => {
  assert.doesNotMatch(mainSource, /\.once\("closed", \(\) => finishWelcome\(\)\)/);
});
