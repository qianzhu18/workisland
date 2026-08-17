"use strict";

// This changes only when the user-facing telemetry notice changes materially.
// Keeping it separate from the app version prevents unnecessary re-prompts.
const TELEMETRY_CONSENT_NOTICE_VERSION = "2026-08-18";

function isTelemetryConsentPending(settings = {}) {
  return settings.telemetryConsentNoticeVersion !== TELEMETRY_CONSENT_NOTICE_VERSION;
}

function createTelemetryConsentChoice(enabled) {
  return {
    telemetryEnabled: enabled === true,
    telemetryConsentNoticeVersion: TELEMETRY_CONSENT_NOTICE_VERSION
  };
}

module.exports = {
  TELEMETRY_CONSENT_NOTICE_VERSION,
  isTelemetryConsentPending,
  createTelemetryConsentChoice
};
