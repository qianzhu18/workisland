import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  CONTROLLED_SETTINGS,
  describeControlledSettings,
  readControlledSettings,
  validateControlledChanges
} = require("../src/shared/settings-control-schema.cjs");
const { createDefaultSettings } = require("../src/shared/settings.cjs");

const EXPECTED_KEYS = [
  "autoCollapseDelayMs",
  "autoCollapseOnMouseLeave",
  "completionPopupDurationSec",
  "fileShelfEnabled",
  "hoverToOpen",
  "islandDisplayMode",
  "lyricsEnabled",
  "mediaEnabled",
  "mediaTrackChangeNotifications",
  "performanceAlertsEnabled",
  "performanceEnabled",
  "petScale",
  "petSprite",
  "showUsageQuota",
  "sound.enabled",
  "sound.volume",
  "terminalEnabled",
  "updateChecksEnabled",
  "usageDisplayValue"
];

test("controlled settings expose only the explicit reversible allowlist", () => {
  assert.deepEqual(Object.keys(CONTROLLED_SETTINGS).sort(), EXPECTED_KEYS);

  for (const forbidden of [
    "approvalModes",
    "clipboardHistoryEnabled",
    "telemetryEnabled",
    "terminalShell",
    "terminalSavedCommands",
    "hookToggles",
    "launchAtLogin"
  ]) {
    assert.equal(CONTROLLED_SETTINGS[forbidden], undefined);
  }
});

test("descriptions and reads include only requested controlled settings", () => {
  const settings = createDefaultSettings();
  settings.sound.volume = 37;

  const descriptions = describeControlledSettings(settings);
  assert.equal(descriptions.length, EXPECTED_KEYS.length);
  assert.deepEqual(
    Object.keys(descriptions[0]).sort(),
    ["constraints", "currentValue", "defaultValue", "description", "key", "label", "restartRequired", "type", "writable"].sort()
  );
  assert.deepEqual(readControlledSettings(settings, ["sound.volume", "mediaEnabled"]), {
    "sound.volume": 37,
    mediaEnabled: true
  });
  assert.throws(
    () => readControlledSettings(settings, ["telemetryEnabled"]),
    (error) => error.code === "SETTING_NOT_ALLOWED"
  );
});

test("validation is atomic and constructs nested partial settings safely", () => {
  const settings = createDefaultSettings();
  settings.sound.events.taskComplete.enabled = false;

  const validated = validateControlledChanges(settings, {
    completionPopupDurationSec: 10,
    "sound.enabled": false,
    "sound.volume": 25
  });

  assert.deepEqual(validated.values, {
    completionPopupDurationSec: 10,
    "sound.enabled": false,
    "sound.volume": 25
  });
  assert.equal(validated.partial.completionPopupDurationSec, 10);
  assert.equal(validated.partial.sound.enabled, false);
  assert.equal(validated.partial.sound.volume, 25);
  assert.equal(validated.partial.sound.events.taskComplete.enabled, false);

  assert.throws(
    () => validateControlledChanges(settings, { mediaEnabled: false, telemetryEnabled: false }),
    (error) => error.code === "SETTING_NOT_ALLOWED"
  );
});

test("validators reject out-of-range and malformed values", () => {
  const settings = createDefaultSettings();
  const invalidCases = [
    ["mediaEnabled", "false"],
    ["sound.volume", -1],
    ["sound.volume", 101],
    ["sound.volume", 1.5],
    ["completionPopupDurationSec", 0],
    ["completionPopupDurationSec", 61],
    ["petScale", 0.49],
    ["petScale", 2.01],
    ["islandDisplayMode", "hidden"],
    ["usageDisplayValue", "remaining-percent"],
    ["autoCollapseDelayMs", 499],
    ["autoCollapseDelayMs", 60001]
  ];

  for (const [key, value] of invalidCases) {
    assert.throws(
      () => validateControlledChanges(settings, { [key]: value }),
      (error) => error.code === "INVALID_SETTING_VALUE",
      `${key} should reject ${JSON.stringify(value)}`
    );
  }
});

test("pet selection accepts only an already-installed pet", () => {
  const settings = createDefaultSettings();
  const context = { installedPetIds: new Set(["codex:qianxue", "custom:fox"]) };

  assert.equal(
    validateControlledChanges(settings, { petSprite: "custom:fox" }, context).partial.petSprite,
    "custom:fox"
  );
  assert.throws(
    () => validateControlledChanges(settings, { petSprite: "custom:not-installed" }, context),
    (error) => error.code === "INVALID_SETTING_VALUE"
  );
});

test("change requests are bounded before any values are accepted", () => {
  const settings = createDefaultSettings();
  const tooMany = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`key-${index}`, true]));

  assert.throws(
    () => validateControlledChanges(settings, tooMany),
    (error) => error.code === "TOO_MANY_SETTINGS"
  );
});
