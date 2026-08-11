"use strict";

const APPROVAL_MODE = Object.freeze({
  ISLAND: "bridge",
  TERMINAL: "terminalNative"
});

const CONFIGURABLE_APPROVAL_AGENTS = Object.freeze([
  "codex",
  "coco",
  "copilot-cli",
  "traex"
]);

const DEFAULT_APPROVAL_MODES = Object.freeze(
  Object.fromEntries(
    CONFIGURABLE_APPROVAL_AGENTS.map((agent) => [agent, APPROVAL_MODE.ISLAND])
  )
);

function isApprovalMode(value) {
  return value === APPROVAL_MODE.ISLAND || value === APPROVAL_MODE.TERMINAL;
}

function normalizeApprovalModes(value = {}) {
  return Object.fromEntries(
    CONFIGURABLE_APPROVAL_AGENTS.map((agent) => [
      agent,
      isApprovalMode(value[agent]) ? value[agent] : DEFAULT_APPROVAL_MODES[agent]
    ])
  );
}

function resolveApprovalMode(settings, agent) {
  const configured = settings?.approvalModes?.[agent];
  return isApprovalMode(configured) ? configured : APPROVAL_MODE.ISLAND;
}

module.exports = {
  APPROVAL_MODE,
  CONFIGURABLE_APPROVAL_AGENTS,
  DEFAULT_APPROVAL_MODES,
  isApprovalMode,
  normalizeApprovalModes,
  resolveApprovalMode
};
