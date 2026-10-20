import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { DEFAULT_SETTINGS } = require("../src/shared/settings.cjs");
const {
  needsBridgeReinstall,
  shouldUninstallBeforeAutoReinstall,
  shouldAutoEnableDsh,
  shouldAttemptDshAutoInstall,
  isDshVerificationCurrent,
  buildDshBridgeConfig
} = require("../src/shared/dsh-auto-connect.cjs");

test("DSH auto-connects by default like other local agents", () => {
  assert.equal(DEFAULT_SETTINGS.hookToggles.dsh, true);
});

test("bridge install is skipped when the profile already carries the bundled bridge", () => {
  assert.equal(needsBridgeReinstall({
    dependencySpec: "file:/Applications/WorkIsland.app/Contents/Resources/dsh-workisland-bridge",
    nodeModulesPresent: true,
    installedVersion: "1.0.1",
    desiredVersion: "1.0.1"
  }), false);
  assert.equal(needsBridgeReinstall({
    dependencySpec: undefined,
    nodeModulesPresent: true,
    installedVersion: "1.0.1",
    desiredVersion: "1.0.1"
  }), true);
  assert.equal(needsBridgeReinstall({
    dependencySpec: "file:/Applications/WorkIsland.app/Contents/Resources/dsh-workisland-bridge",
    nodeModulesPresent: true,
    installedVersion: "1.0.0",
    desiredVersion: "1.0.1"
  }), true);
  assert.equal(needsBridgeReinstall({
    dependencySpec: "file:/Applications/WorkIsland.app/Contents/Resources/dsh-workisland-bridge",
    nodeModulesPresent: false,
    installedVersion: null,
    desiredVersion: "1.0.1"
  }), true);
  // App 换过位置/重装过：profile 里的 file: 依赖必须跟着刷新，否则用户下次
  // 在 profile 里跑 pnpm install 会因为旧路径不存在而失败。
  assert.equal(needsBridgeReinstall({
    dependencySpec: "file:/Applications/WorkIsland.app/Contents/Resources/dsh-workisland-bridge",
    desiredSpec: "file:/Users/bao/Desktop/WorkIsland.app/Contents/Resources/dsh-workisland-bridge",
    nodeModulesPresent: true,
    installedVersion: "1.0.1",
    desiredVersion: "1.0.1"
  }), true);
  assert.equal(needsBridgeReinstall({
    dependencySpec: "file:./dsh-workisland-bridge",
    desiredSpec: "file:/tmp/dsh-profile/dsh-workisland-bridge",
    profileDir: "/tmp/dsh-profile",
    nodeModulesPresent: true,
    installedVersion: "1.0.1",
    desiredVersion: "1.0.1"
  }), false);
});

test("automatic reconciliation never uninstalls the DSH bridge first", () => {
  assert.equal(shouldUninstallBeforeAutoReinstall("dsh"), false);
  assert.equal(shouldUninstallBeforeAutoReinstall("claude"), true);
});

test("legacy opt-out migration is one-time and only targets users who never connected", () => {
  assert.equal(shouldAutoEnableDsh({ toggle: false, configExists: false, migrated: false }), true);
  assert.equal(shouldAutoEnableDsh({ toggle: false, configExists: true, migrated: false }), false);
  assert.equal(shouldAutoEnableDsh({ toggle: false, configExists: false, migrated: true }), false);
  assert.equal(shouldAutoEnableDsh({ toggle: true, configExists: false, migrated: false }), false);
});

test("watchdog only installs when DSH is detected and the bridge is actually missing", () => {
  const now = 1_000_000;
  const base = { enabled: true, targetCount: 1, installed: false, lastAttemptAt: 0, now };
  assert.equal(shouldAttemptDshAutoInstall(base), true);
  assert.equal(shouldAttemptDshAutoInstall({ ...base, enabled: false }), false);
  assert.equal(shouldAttemptDshAutoInstall({ ...base, targetCount: 0 }), false);
  assert.equal(shouldAttemptDshAutoInstall({ ...base, installed: true }), false);
  assert.equal(shouldAttemptDshAutoInstall({ ...base, lastAttemptAt: now - 1000 }), false);
  assert.equal(shouldAttemptDshAutoInstall({ ...base, lastAttemptAt: now - 11 * 60 * 1000 }), true);
});

test("a restart-pending bridge is not reported as verified", () => {
  assert.equal(isDshVerificationCurrent({ lastVerifiedAt: "2026-10-20T00:00:00.000Z", restartRequired: false }), true);
  assert.equal(isDshVerificationCurrent({ lastVerifiedAt: "2026-10-20T00:00:00.000Z", restartRequired: true }), false);
  assert.equal(isDshVerificationCurrent({ restartRequired: false }), false);
});

test("app coordinator wires automatic DSH connect into startup", () => {
  const coordinator = readFileSync(new URL("../src/main/app-coordinator.cjs", import.meta.url), "utf8");
  assert.match(coordinator, /migrateDshAutoDetect\(\)/);
  assert.match(coordinator, /startDshWatchdog\(\)/);
  assert.match(coordinator, /shouldUninstallBeforeAutoReinstall/);
  assert.match(coordinator, /isAvailable\(\)/);
});

test("DSH manager exposes availability and an options-aware uninstall", () => {
  const source = readFileSync(new URL("../src/main/hooks-custom.cjs", import.meta.url), "utf8");
  assert.match(source, /async isAvailable\(\)/);
  assert.match(source, /async uninstall\(options = \{\}\)/);
});
test("bridge config keeps a steady install silent and preserves real verification", () => {
  const existing = {
    command: "flux-hooks --source dsh",
    installedAt: "2026-10-01T00:00:00.000Z",
    restartRequired: false,
    profiles: [{ name: "web", profileDir: "/Users/u/.dsh/profiles/web" }],
    lastVerifiedAt: "2026-10-01T01:00:00.000Z",
    lastVerifiedEvent: "activityUpdated"
  };
  const steady = buildDshBridgeConfig({
    command: existing.command,
    existing,
    profiles: existing.profiles,
    changed: false,
    running: true
  });
  assert.equal(steady.restartRequired, false);
  assert.equal(steady.lastVerifiedAt, "2026-10-01T01:00:00.000Z");
  const updated = buildDshBridgeConfig({
    command: existing.command,
    existing,
    profiles: existing.profiles,
    changed: true,
    running: true
  });
  assert.equal(updated.restartRequired, true);
  // 换了一组 profile 说明验证不再是同一套配置，不能继续声称已验证。
  const changedProfiles = buildDshBridgeConfig({
    command: existing.command,
    existing,
    profiles: [{ name: "desktop", profileDir: "/Users/u/.dsh/profiles/desktop" }],
    changed: true,
    running: false
  });
  assert.equal(changedProfiles.restartRequired, false);
  assert.equal(changedProfiles.lastVerifiedAt, undefined);
});
