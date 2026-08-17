import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const {
  TELEMETRY_CONSENT_NOTICE_VERSION,
  isTelemetryConsentPending,
  createTelemetryConsentChoice
} = require("../src/shared/telemetry-consent.cjs");

test("an existing installation without a recorded decision must see the telemetry notice", () => {
  assert.equal(isTelemetryConsentPending({ hasCompletedOnboarding: true, telemetryEnabled: false }), true);
  assert.equal(isTelemetryConsentPending({ telemetryConsentNoticeVersion: "older-notice" }), true);
});

test("an accepted or declined choice records the current notice version", () => {
  assert.deepEqual(createTelemetryConsentChoice(true), {
    telemetryEnabled: true,
    telemetryConsentNoticeVersion: TELEMETRY_CONSENT_NOTICE_VERSION
  });
  assert.deepEqual(createTelemetryConsentChoice(false), {
    telemetryEnabled: false,
    telemetryConsentNoticeVersion: TELEMETRY_CONSENT_NOTICE_VERSION
  });
  assert.equal(isTelemetryConsentPending(createTelemetryConsentChoice(false)), false);
});
