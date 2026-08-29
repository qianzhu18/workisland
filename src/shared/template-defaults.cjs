"use strict";

// Active appearance template defaults, kept dependency-free so both the
// settings schema (settings.cjs) and the template runtime can require it
// without pulling Electron into shared code paths.

const { TEMPLATE_ID_PATTERN, VERSION_PATTERN } = require("./template-manifest.cjs");

const OFFICIAL_TEMPLATE_ID = "builtin:workisland-xiaoyu";
const OFFICIAL_TEMPLATE_VERSION = "1.0.0";

const DEFAULT_APPEARANCE_TEMPLATE = Object.freeze({
  id: OFFICIAL_TEMPLATE_ID,
  version: OFFICIAL_TEMPLATE_VERSION
});

/**
 * Normalize the persisted `appearanceTemplate` selection. Invalid shapes
 * reset to the official builtin template — a broken reference must never
 * block startup or blank the island's status icons.
 */
function normalizeAppearanceTemplate(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const version = typeof raw.version === "string" ? raw.version.trim() : "";
    if (TEMPLATE_ID_PATTERN.test(id) && (version === "" || VERSION_PATTERN.test(version))) {
      return { id, version: version || "*" };
    }
  }
  return { ...DEFAULT_APPEARANCE_TEMPLATE };
}

/**
 * Normalize `appearanceOverrides` — the per-module escapes on top of the
 * active template. v1 only supports `background` (an island appearance
 * compiled by the shared validator).
 */
function normalizeAppearanceOverrides(raw, normalizeAppearance) {
  const overrides = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw) && raw.background !== undefined) {
    try {
      const { appearance } = normalizeAppearance(raw.background);
      overrides.background = appearance;
    } catch {
      // Drop an invalid override; the template default applies instead.
    }
  }
  return overrides;
}

module.exports = {
  OFFICIAL_TEMPLATE_ID,
  OFFICIAL_TEMPLATE_VERSION,
  DEFAULT_APPEARANCE_TEMPLATE,
  normalizeAppearanceTemplate,
  normalizeAppearanceOverrides
};
