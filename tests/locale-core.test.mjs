import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const {
  LANGUAGE_PREFERENCES,
  SUPPORTED_LOCALES,
  interpolate,
  normalizeLanguagePreference,
  resolveLocale
} = require("../src/shared/locale.cjs");

test("locale policy exposes only the supported preferences", () => {
  assert.deepEqual(SUPPORTED_LOCALES, ["zh-CN", "en"]);
  assert.deepEqual(LANGUAGE_PREFERENCES, ["system", "zh-CN", "en"]);
  assert.equal(normalizeLanguagePreference("en"), "en");
  assert.equal(normalizeLanguagePreference("fr"), "system");
  assert.equal(normalizeLanguagePreference(null), "system");
});

test("system locale follows the first supported preferred language", () => {
  assert.equal(resolveLocale("system", ["zh-Hans-CN", "en-US"]), "zh-CN");
  assert.equal(resolveLocale("system", ["ja-JP", "en-GB"]), "en");
  assert.equal(resolveLocale("system", ["zh-Hant-TW", "en-US"]), "en");
  assert.equal(resolveLocale("system", ["fr-FR", "de-DE"]), "en");
});

test("an explicit application language overrides system preferences", () => {
  assert.equal(resolveLocale("zh-CN", ["en-US"]), "zh-CN");
  assert.equal(resolveLocale("en", ["zh-Hans-CN"]), "en");
});

test("interpolation replaces named values without evaluating content", () => {
  assert.equal(interpolate("Hello, {name}", { name: "Skyler" }), "Hello, Skyler");
  assert.equal(interpolate("{count} items for {name}", { count: 2 }), "2 items for {name}");
  assert.equal(interpolate("Run {value}", { value: "${process.exit(1)}" }), "Run ${process.exit(1)}");
});
