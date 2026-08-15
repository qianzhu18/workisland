"use strict";

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["https:", "http:"]);
const ALLOWED_MAILTO_FIELDS = new Set(["subject", "body"]);
const ALLOWED_MAILTO_RECIPIENTS = new Set(["its.qianzhu@gmail.com"]);
const ALLOWED_SYSTEM_URLS = new Set([
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"
]);

function isAllowedExternalUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  if (ALLOWED_SYSTEM_URLS.has(value)) return true;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "mailto:") {
      let recipient;
      try {
        recipient = decodeURIComponent(parsed.pathname);
      } catch {
        return false;
      }
      if (!ALLOWED_MAILTO_RECIPIENTS.has(recipient.toLowerCase()) || parsed.hash) return false;
      for (const [key, fieldValue] of parsed.searchParams) {
        if (!ALLOWED_MAILTO_FIELDS.has(key) || /[\r\n]/.test(fieldValue)) return false;
      }
      return true;
    }
    return ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

module.exports = { isAllowedExternalUrl };
