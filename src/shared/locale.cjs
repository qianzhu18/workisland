"use strict";

const SUPPORTED_LOCALES = Object.freeze(["zh-CN", "en"]);
const LANGUAGE_PREFERENCES = Object.freeze(["system", ...SUPPORTED_LOCALES]);

function normalizeLanguagePreference(value) {
  return LANGUAGE_PREFERENCES.includes(value) ? value : "system";
}

function resolveLocale(preference, preferredLanguages = []) {
  const normalized = normalizeLanguagePreference(preference);
  if (normalized !== "system") return normalized;

  for (const rawLanguage of Array.isArray(preferredLanguages) ? preferredLanguages : []) {
    const language = String(rawLanguage || "").trim().toLowerCase();
    if (language === "zh" || language === "zh-cn" || language.startsWith("zh-hans")) return "zh-CN";
    if (language === "en" || language.startsWith("en-")) return "en";
  }
  return "en";
}

function interpolate(template, parameters = {}) {
  return String(template ?? "").replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(parameters, key) && parameters[key] != null
      ? String(parameters[key])
      : match
  ));
}

module.exports = {
  LANGUAGE_PREFERENCES,
  SUPPORTED_LOCALES,
  interpolate,
  normalizeLanguagePreference,
  resolveLocale
};
