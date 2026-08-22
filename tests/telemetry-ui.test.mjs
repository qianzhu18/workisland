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
const rendererSharedSource = readFileSync(new URL("../src/renderer/shared/settings.js", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main/index.cjs", import.meta.url), "utf8");
const windowSource = readFileSync(new URL("../src/main/windows.cjs", import.meta.url), "utf8");

// 遥测政策 v2（2026-08-22）：默认开启、设置内披露、随时可关；不再有同意窗口。

test("settings about page discloses default-on telemetry with a working toggle", () => {
  assert.match(settingsSource, /匿名使用统计/);
  assert.match(settingsSource, /默认开启/);
  assert.match(settingsSource, /save\(\{ telemetryEnabled: v \}\)/);
  // 关闭语义必须向用户说明：立即停止收集并清空未上报数据。
  assert.match(settingsSource, /清空未上报的数据/);
  assert.match(settingsSource, /本机发送状态/);
  assert.match(settingsSource, /最近一次成功提交到 PostHog/);
  assert.match(settingsSource, /getTelemetryStatus/);
});

test("welcome shows no telemetry consent UI under the default-on policy", () => {
  assert.doesNotMatch(welcomeSource, /允许匿名使用统计/);
  assert.doesNotMatch(welcomeSource, /getStarted\(\{ telemetry \}\)/);
  assert.doesNotMatch(welcomeSource, /telemetryConsentOnly|mode=telemetry/);
  assert.match(welcomeSource, /进入 WorkIsland/);
});

test("welcome preload no longer carries a telemetry payload", () => {
  assert.match(preloadSource, /WELCOME_GET_STARTED\)/);
  assert.doesNotMatch(preloadSource, /telemetry/);
});

test("telemetry is on by default in shared settings", () => {
  assert.match(sharedSource, /telemetryEnabled: true/);
  assert.match(rendererSharedSource, /telemetryEnabled: true/);
});

test("the consent window flow is fully removed from the main process", () => {
  assert.match(mainSource, /telemetryService\.track\(EVENTS\.APP_LAUNCHED\)/);
  assert.doesNotMatch(mainSource, /isTelemetryConsentPending|createTelemetryConsentChoice|needsTelemetryConsent/);
  assert.doesNotMatch(mainSource, /consentOnly/);
  assert.doesNotMatch(windowSource, /consentOnly|mode=telemetry/);
});

test("the welcome window is never attached to the auto-hiding Island window", () => {
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

  new WelcomeWindow();

  assert.equal("parent" in browserWindowOptions, false);
  assert.equal("modal" in browserWindowOptions, false);
});

test("closing the welcome window cannot silently complete onboarding", () => {
  assert.doesNotMatch(mainSource, /\.once\("closed", \(\) => finishWelcome\(\)\)/);
});
