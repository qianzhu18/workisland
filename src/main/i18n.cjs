"use strict";

const { interpolate } = require("../shared/locale.cjs");

let currentLocale = "en";
let englishMessages = require("../locales/en.json");
let currentMessages = englishMessages;

function formatFallback(template, params = {}) {
  return interpolate(template, params);
}

function configureI18n({ locale = "en", messages = {}, fallbackMessages = {} } = {}) {
  currentLocale = locale;
  currentMessages = messages && typeof messages === "object" ? messages : {};
  englishMessages = fallbackMessages && typeof fallbackMessages === "object" ? fallbackMessages : {};
}

function translate(key, params = {}) {
  const template = currentMessages[key] ?? englishMessages[key] ?? key;
  return interpolate(template, params);
}

const i18n = {
  t: translate,
  getLocale: () => currentLocale
};

module.exports = { configureI18n, i18n, formatFallback };
