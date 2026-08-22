import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const {
  TELEMETRY_CONSENT_NOTICE_VERSION
} = require("../src/shared/telemetry-consent.cjs");
const {
  DEFAULT_SETTINGS,
  createDefaultSettings,
  mergeSettings
} = require("../src/shared/settings.cjs");

// 遥测政策 v2（2026-08-22 所有者决策）：默认开启、设置内披露；
// 旧同意流程的明确选择（含拒绝）必须被保留。

test("fresh installs start with anonymous usage stats enabled by default", () => {
  assert.equal(DEFAULT_SETTINGS.telemetryEnabled, true);
  assert.equal(createDefaultSettings().telemetryEnabled, true);
  assert.equal(mergeSettings({}).telemetryEnabled, true);
});

test("installs that never made a choice migrate to the default-on policy", () => {
  // 旧版本会把当时的默认值 false 原样持久化，未附带任何用户选择。
  const migrated = mergeSettings({
    telemetryEnabled: false,
    telemetryConsentNoticeVersion: ""
  });
  assert.equal(migrated.telemetryEnabled, true, "never-asked installs move to default-on");
  assert.equal(migrated.telemetryPolicyVersion, 2);
});

test("explicit choices recorded under the old consent flow are preserved", () => {
  const declined = mergeSettings({
    telemetryEnabled: false,
    telemetryConsentNoticeVersion: TELEMETRY_CONSENT_NOTICE_VERSION
  });
  assert.equal(declined.telemetryEnabled, false, "prior opt-outs must stay off");

  const accepted = mergeSettings({
    telemetryEnabled: true,
    telemetryConsentNoticeVersion: TELEMETRY_CONSENT_NOTICE_VERSION
  });
  assert.equal(accepted.telemetryEnabled, true);

  const olderDeclined = mergeSettings({
    telemetryEnabled: false,
    telemetryConsentNoticeVersion: "2026-07-01"
  });
  assert.equal(olderDeclined.telemetryEnabled, false, "a prior recorded opt-out must not be flipped by a notice-version change");
});

test("after migration the settings toggle persists across restarts", () => {
  // 首次启动完成迁移并落盘 policyVersion 2。
  const first = mergeSettings({ telemetryEnabled: false, telemetryConsentNoticeVersion: "" });
  assert.equal(first.telemetryEnabled, true);

  // 用户随后在设置里关闭；保存的文件已带版本 2，不得被再次迁移翻转。
  const afterManualOff = mergeSettings({ ...first, telemetryEnabled: false });
  assert.equal(afterManualOff.telemetryEnabled, false, "manual off must not be re-migrated");
  const afterManualOn = mergeSettings({ ...first, telemetryEnabled: true });
  assert.equal(afterManualOn.telemetryEnabled, true);
});
