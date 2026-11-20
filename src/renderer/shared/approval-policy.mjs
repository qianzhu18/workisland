// Only show decisions that the corresponding agent bridge can actually apply.
export function canAllowAlways(tool, request) {
  if ((request?.approvalMode ?? 'bridge') === 'terminalNative') return false;
  if (tool === 'opencode' || tool === 'sara' || tool === 'alma') return true;
  return tool === 'claude' && (request?.toolName === 'ExitPlanMode' || (request?.permissionSuggestions?.length ?? 0) > 0);
}

// Per-agent approval mode lists (mirrors src/shared/approval-policy.cjs MODES_BY_AGENT).
const MODES_BY_AGENT = {
  codex: ['bridge', 'terminalNative'],
  coco: ['bridge', 'terminalNative'],
  'copilot-cli': ['bridge', 'terminalNative'],
  traex: ['bridge', 'terminalNative'],
  alma: ['bridge', 'trust', 'native']
};
const DEFAULT_MODES = ['bridge', 'terminalNative'];
export function approvalModesFor(agent) {
  return MODES_BY_AGENT[agent] || DEFAULT_MODES;
}
