"use strict";

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["https:", "http:"]);
const ALLOWED_SYSTEM_URLS = new Set([
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"
]);

function isAllowedExternalUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  if (ALLOWED_SYSTEM_URLS.has(value)) return true;
  try {
    const parsed = new URL(value);
    return ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

module.exports = { isAllowedExternalUrl };
