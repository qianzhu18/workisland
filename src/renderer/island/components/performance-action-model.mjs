const MESSAGES = Object.freeze({
  signaled: "performance.action.signaled",
  protected: "performance.action.protected",
  "identity-changed": "performance.action.identityChanged",
  permission: "performance.action.permission",
  ended: "performance.action.ended",
  failed: "performance.action.failed"
});

export function performanceActionMessage(result = {}) {
  return MESSAGES[result.reason] || (result.ok ? MESSAGES.signaled : MESSAGES.failed);
}
