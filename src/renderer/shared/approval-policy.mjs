// Only show decisions that the corresponding agent bridge can actually apply.
export function canAllowAlways(tool, request) {
  if ((request?.approvalMode ?? 'bridge') === 'terminalNative') return false;
  if (tool === 'opencode' || tool === 'sara') return true;
  return tool === 'claude' && (request?.toolName === 'ExitPlanMode' || (request?.permissionSuggestions?.length ?? 0) > 0);
}
