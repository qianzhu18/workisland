"use strict";

const APPROVAL_MODE = Object.freeze({
  ISLAND: "bridge",
  TERMINAL: "terminalNative",
  // Alma-only modes: fully trust the agent (auto allow_always) or leave
  // approvals inside the native Alma UI.
  TRUST: "trust",
  NATIVE: "native"
});

const CONFIGURABLE_APPROVAL_AGENTS = Object.freeze([
  "codex",
  "coco",
  "copilot-cli",
  "traex",
  "alma"
]);

// Alma's handoff API supports a full-trust and a hand-off-to-native mode;
// the other configurable agents only choose between Island and terminal.
const MODES_BY_AGENT = Object.freeze({
  codex: [APPROVAL_MODE.ISLAND, APPROVAL_MODE.TERMINAL],
  coco: [APPROVAL_MODE.ISLAND, APPROVAL_MODE.TERMINAL],
  "copilot-cli": [APPROVAL_MODE.ISLAND, APPROVAL_MODE.TERMINAL],
  traex: [APPROVAL_MODE.ISLAND, APPROVAL_MODE.TERMINAL],
  alma: [APPROVAL_MODE.ISLAND, APPROVAL_MODE.TRUST, APPROVAL_MODE.NATIVE]
});

const DEFAULT_APPROVAL_MODES = Object.freeze(
  Object.fromEntries(
    CONFIGURABLE_APPROVAL_AGENTS.map((agent) => [agent, APPROVAL_MODE.ISLAND])
  )
);

function isApprovalMode(value) {
  return Object.values(APPROVAL_MODE).includes(value);
}

/** Modes offered in settings for a given agent (defaults to Island/terminal). */
function approvalModesFor(agent) {
  return MODES_BY_AGENT[agent] || [APPROVAL_MODE.ISLAND, APPROVAL_MODE.TERMINAL];
}

function isApprovalModeFor(agent, value) {
  return approvalModesFor(agent).includes(value);
}

function normalizeApprovalModes(value = {}) {
  return Object.fromEntries(
    CONFIGURABLE_APPROVAL_AGENTS.map((agent) => [
      agent,
      isApprovalModeFor(agent, value[agent]) ? value[agent] : DEFAULT_APPROVAL_MODES[agent]
    ])
  );
}

function resolveApprovalMode(settings, agent) {
  const configured = settings?.approvalModes?.[agent];
  return isApprovalModeFor(agent, configured) ? configured : APPROVAL_MODE.ISLAND;
}

module.exports = {
  APPROVAL_MODE,
  CONFIGURABLE_APPROVAL_AGENTS,
  DEFAULT_APPROVAL_MODES,
  approvalModesFor,
  isApprovalMode,
  isApprovalModeFor,
  normalizeApprovalModes,
  resolveApprovalMode
};
