import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { createLocalizationService } = require("../src/main/localization-service.cjs");
const { configureI18n, i18n } = require("../src/main/i18n.cjs");

function fixtureCatalogs() {
  return {
    "zh-CN": {
      "common.cancel": "取消",
      "welcome.greeting": "你好，{name}"
    },
    en: {
      "common.cancel": "Cancel",
      "fallback.only": "English fallback",
      "welcome.greeting": "Hello, {name}"
    }
  };
}

test("localization service resolves system language and translates", () => {
  let preference = "system";
  const broadcasts = [];
  const service = createLocalizationService({
    getPreference: () => preference,
    setPreference: (value) => { preference = value; },
    getPreferredSystemLanguages: () => ["en-US", "zh-Hans-CN"],
    catalogs: fixtureCatalogs(),
    broadcast: (snapshot) => broadcasts.push(snapshot)
  });

  assert.deepEqual(service.getSnapshot(), {
    preference: "system",
    locale: "en",
    messages: fixtureCatalogs().en,
    fallbackMessages: fixtureCatalogs().en
  });
  assert.equal(service.t("common.cancel"), "Cancel");
  assert.equal(service.t("welcome.greeting", { name: "Skyler" }), "Hello, Skyler");

  service.setPreference("zh-CN");
  assert.equal(preference, "zh-CN");
  assert.equal(service.getLocale(), "zh-CN");
  assert.equal(broadcasts.at(-1).messages["common.cancel"], "取消");
  assert.equal(broadcasts.at(-1).fallbackMessages["fallback.only"], "English fallback");
});

test("localization service normalizes invalid preferences and falls back to English keys", () => {
  let preference = "fr";
  const service = createLocalizationService({
    getPreference: () => preference,
    setPreference: (value) => { preference = value; },
    getPreferredSystemLanguages: () => ["zh-Hans-CN"],
    catalogs: fixtureCatalogs()
  });

  assert.equal(service.getPreference(), "system");
  assert.equal(service.getLocale(), "zh-CN");
  assert.equal(service.t("fallback.only"), "English fallback");
  assert.equal(service.t("missing.key"), "missing.key");

  service.setPreference("de");
  assert.equal(preference, "system");
});

test("system refresh broadcasts only when the resolved locale changes", () => {
  let languages = ["en-US"];
  const broadcasts = [];
  const service = createLocalizationService({
    getPreference: () => "system",
    setPreference: () => {},
    getPreferredSystemLanguages: () => languages,
    catalogs: fixtureCatalogs(),
    broadcast: (snapshot) => broadcasts.push(snapshot)
  });

  assert.equal(service.refreshSystemLocale(), false);
  languages = ["zh-Hans-CN", "en-US"];
  assert.equal(service.refreshSystemLocale(), true);
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].locale, "zh-CN");
});

test("main i18n supports semantic keys and legacy fallbacks during migration", () => {
  configureI18n({
    locale: "en",
    messages: fixtureCatalogs().en,
    fallbackMessages: fixtureCatalogs().en
  });

  assert.equal(i18n.t("common.cancel"), "Cancel");
  assert.equal(i18n.t("welcome.greeting", { name: "Skyler" }), "Hello, Skyler");
  assert.equal(i18n.k123({ name: "Skyler" }, "Legacy {name}"), "Legacy Skyler");
});
