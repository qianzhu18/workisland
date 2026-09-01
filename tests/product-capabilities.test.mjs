import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createDefaultSettings } = require("../src/shared/settings.cjs");
const {
  PRODUCT_CAPABILITIES,
  getProductCapability,
  listProductCapabilities
} = require("../src/shared/product-capabilities.cjs");

const REQUIRED_IDS = [
  "agent-monitoring",
  "media",
  "lyrics",
  "performance",
  "file-shelf",
  "quick-share",
  "clipboard-history",
  "terminal",
  "saved-commands",
  "usage",
  "notifications",
  "sound",
  "display-mode",
  "desktop-pet",
  "shortcuts"
];

const PUBLIC_FIELDS = [
  "available",
  "category",
  "enabled",
  "howToUse",
  "id",
  "name",
  "platforms",
  "privacy",
  "relatedSettings",
  "requirements",
  "settingsSection",
  "summary"
];

function hasPath(object, dottedPath) {
  const parts = dottedPath.split(".");
  let value = object;
  for (const part of parts) {
    if (!value || !Object.prototype.hasOwnProperty.call(value, part)) return false;
    value = value[part];
  }
  return true;
}

test("capability catalog covers every core WorkIsland extension", () => {
  assert.deepEqual(PRODUCT_CAPABILITIES.map(({ id }) => id), REQUIRED_IDS);
  const settings = createDefaultSettings();
  for (const capability of PRODUCT_CAPABILITIES) {
    for (const key of capability.relatedSettings) {
      assert.equal(hasPath(settings, key), true, `${capability.id} references unknown setting ${key}`);
    }
  }
});

test("capability projection exposes only documented product metadata and safe state", () => {
  const capabilities = listProductCapabilities({
    settings: createDefaultSettings(),
    platform: "darwin",
    modules: { media: true, performance: true, shelf: true, terminal: true, usage: true }
  });
  assert.equal(capabilities.length, REQUIRED_IDS.length);
  for (const capability of capabilities) {
    assert.deepEqual(Object.keys(capability).sort(), PUBLIC_FIELDS);
    assert.equal(typeof capability.available, "boolean");
    assert.equal(typeof capability.enabled, "boolean");
    assert.equal(Array.isArray(capability.platforms), true);
    assert.equal(Array.isArray(capability.relatedSettings), true);
    assert.equal(Array.isArray(capability.requirements), true);
  }
  assert.equal(capabilities.find(({ id }) => id === "media").enabled, true);
  assert.equal(capabilities.find(({ id }) => id === "lyrics").enabled, false);
  assert.equal(capabilities.find(({ id }) => id === "clipboard-history").enabled, false);
});

test("capability details reject unknown ids without leaking arbitrary input", () => {
  const context = { settings: createDefaultSettings(), platform: "win32", modules: {} };
  assert.equal(getProductCapability("quick-share", context).available, true);
  assert.throws(
    () => getProductCapability("../../secret", context),
    (error) => error.code === "CAPABILITY_NOT_FOUND" && !error.message.includes("../../secret")
  );
});
