"use strict";

const {
  interpolate,
  normalizeLanguagePreference,
  resolveLocale
} = require("../shared/locale.cjs");
const { configureI18n } = require("./i18n.cjs");

function loadBundledCatalogs() {
  return {
    "zh-CN": require("../locales/zh-CN.json"),
    en: require("../locales/en.json")
  };
}

function createLocalizationService({
  getPreference: readPreference = () => "system",
  setPreference: persistPreference = () => {},
  getPreferredSystemLanguages = () => [],
  catalogs = loadBundledCatalogs(),
  broadcast = () => {}
} = {}) {
  const fallbackMessages = catalogs.en || {};
  let preference = normalizeLanguagePreference(readPreference());
  let locale = resolveLocale(preference, getPreferredSystemLanguages());

  const applyMainI18n = () => {
    configureI18n({
      locale,
      messages: catalogs[locale] || fallbackMessages,
      fallbackMessages
    });
  };

  const getSnapshot = () => ({
    preference,
    locale,
    messages: catalogs[locale] || fallbackMessages
  });

  const translate = (key, parameters = {}) => {
    const template = catalogs[locale]?.[key] ?? fallbackMessages[key] ?? key;
    return interpolate(template, parameters);
  };

  const publish = () => {
    applyMainI18n();
    const snapshot = getSnapshot();
    broadcast(snapshot);
    return snapshot;
  };

  const setLanguagePreference = (value) => {
    preference = normalizeLanguagePreference(value);
    persistPreference(preference);
    locale = resolveLocale(preference, getPreferredSystemLanguages());
    return publish();
  };

  const refreshSystemLocale = () => {
    if (preference !== "system") return false;
    const nextLocale = resolveLocale(preference, getPreferredSystemLanguages());
    if (nextLocale === locale) return false;
    locale = nextLocale;
    publish();
    return true;
  };

  applyMainI18n();

  return {
    getSnapshot,
    getPreference: () => preference,
    getLocale: () => locale,
    t: translate,
    setPreference: setLanguagePreference,
    refreshSystemLocale
  };
}

module.exports = { createLocalizationService, loadBundledCatalogs };
