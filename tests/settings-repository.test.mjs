import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { SettingsRepository } = require("../src/main/settings-repository.cjs");
const { TELEMETRY_CONSENT_NOTICE_VERSION } = require("../src/shared/telemetry-consent.cjs");

test("telemetry policy migration is persisted before a later restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "workisland-settings-"));
  const filePath = join(directory, "settings.json");
  writeFileSync(filePath, JSON.stringify({
    telemetryEnabled: false,
    telemetryConsentNoticeVersion: ""
  }));

  const repository = new SettingsRepository(filePath, { saveDelayMs: 60_000 });
  const loaded = repository.load();
  assert.equal(loaded.telemetryEnabled, true);
  repository.dispose();

  const saved = JSON.parse(readFileSync(filePath, "utf8"));
  assert.equal(saved.telemetryEnabled, true);
  assert.equal(saved.telemetryPolicyVersion, 2);

  const restarted = new SettingsRepository(filePath).load();
  assert.equal(restarted.telemetryEnabled, true);
});

test("legacy explicit opt-outs are persisted as off", () => {
  const directory = mkdtempSync(join(tmpdir(), "workisland-settings-optout-"));
  const filePath = join(directory, "settings.json");
  writeFileSync(filePath, JSON.stringify({
    telemetryEnabled: false,
    telemetryConsentNoticeVersion: TELEMETRY_CONSENT_NOTICE_VERSION
  }));

  const repository = new SettingsRepository(filePath, { saveDelayMs: 60_000 });
  assert.equal(repository.load().telemetryEnabled, false);
  repository.dispose();

  const saved = JSON.parse(readFileSync(filePath, "utf8"));
  assert.equal(saved.telemetryEnabled, false);
  assert.equal(saved.telemetryPolicyVersion, 2);
});
