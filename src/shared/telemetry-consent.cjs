"use strict";

// Legacy version marker for choices recorded under the old (pre-2026-08-22)
// startup consent flow. That flow is retired; mergeSettings() reads this value
// once only to honour an existing opt-out during the policy migration.
const TELEMETRY_CONSENT_NOTICE_VERSION = "2026-08-18";

module.exports = {
  TELEMETRY_CONSENT_NOTICE_VERSION
};
