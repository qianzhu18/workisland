"use strict";

const { interpolate } = require("../shared/locale.cjs");

let currentLocale = "en";
let currentMessages = {};
let englishMessages = {};

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

const i18n = new Proxy({
  t: translate,
  getLocale: () => currentLocale
}, {
  get(target, key) {
    if (key === "then") return undefined;
    if (Object.prototype.hasOwnProperty.call(target, key)) return target[key];
    return (params, fallback = "") => formatFallback(fallback, params);
  }
});

module.exports = { configureI18n, i18n, formatFallback };
