"use strict";

// Anonymous opt-in telemetry contract (ADR-0003 / PRD-005).
// Everything the main-process telemetry service is allowed to know lives in
// this file. Adding an event or property here requires updating PRD-005 first.
const POSTHOG_HOST = "https://us.i.posthog.com";
// Write-only project API key. Rotate in the PostHog console if it ever leaks;
// the key cannot read data back. Leave empty to hard-disable all uploads.
const POSTHOG_API_KEY = "phc_pTMuDUpg7jQuz9GhPiKJNsiPz5SrW9HZosjDFSnXmkfU";
const TELEMETRY_FLUSH_INTERVAL_MS = 5 * 60 * 1e3;
const TELEMETRY_REQUEST_TIMEOUT_MS = 8e3;
const TELEMETRY_QUEUE_MAX = 500;
const TELEMETRY_BATCH_MAX = 100;

const EVENTS = Object.freeze({
  APP_LAUNCHED: "app_launched",
  FIRST_AGENT_SIGNAL: "first_agent_signal",
  SESSION_STARTED: "session_started",
  SESSION_COMPLETED: "session_completed",
  APPROVAL_HANDLED: "approval_handled",
  QUESTION_ANSWERED: "question_answered",
  JUMP_BACK: "jump_back",
  SETTINGS_CHANGED: "settings_changed"
});

// Property whitelist per event. Anything else passed to track() is dropped.
const PROPERTY_WHITELIST = Object.freeze({
  [EVENTS.FIRST_AGENT_SIGNAL]: ["tool"],
  [EVENTS.SESSION_STARTED]: ["tool"],
  [EVENTS.SESSION_COMPLETED]: ["tool"],
  [EVENTS.APPROVAL_HANDLED]: ["action", "tool"],
  [EVENTS.QUESTION_ANSWERED]: ["tool"],
  [EVENTS.JUMP_BACK]: ["target", "tool"],
  [EVENTS.SETTINGS_CHANGED]: ["key"],
  [EVENTS.APP_LAUNCHED]: []
});

// Only these setting keys may be reported (as key-only, never the value).
const SETTINGS_KEY_WHITELIST = Object.freeze([
  "launchAtLogin",
  "hoverToOpen",
  "hideWhenFullscreen",
  "hideWhenNoActiveSessions",
  "expandOnActionRequired",
  "expandOnSessionComplete",
  "sound.enabled",
  "hapticFeedback",
  "petSprite",
  "updateChecksEnabled",
  "telemetryEnabled"
]);

function sanitizeProps(eventName, props) {
  const allowed = PROPERTY_WHITELIST[eventName];
  if (!allowed || allowed.length === 0) return {};
  const source = props && typeof props === "object" ? props : {};
  const clean = {};
  for (const key of allowed) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    // Only short scalar identifiers (agent name, action, terminal kind) pass.
    if (typeof value === "string" && value.length > 0 && value.length <= 64) {
      clean[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      clean[key] = value;
    }
  }
  return clean;
}

module.exports = {
  POSTHOG_HOST,
  POSTHOG_API_KEY,
  TELEMETRY_FLUSH_INTERVAL_MS,
  TELEMETRY_REQUEST_TIMEOUT_MS,
  TELEMETRY_QUEUE_MAX,
  TELEMETRY_BATCH_MAX,
  EVENTS,
  PROPERTY_WHITELIST,
  SETTINGS_KEY_WHITELIST,
  sanitizeProps
};
