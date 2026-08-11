"use strict";

function createHookDecision(allowed, message, { interrupt = false } = {}) {
  const decision = { behavior: allowed ? "allow" : "deny" };
  if (!allowed && interrupt) decision.interrupt = true;
  if (!allowed && message) decision.message = message;
  return decision;
}

function wrapPermissionRequestDecision(decision) {
  return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision } };
}

function isExitPlanMode(pending) {
  return pending.permissionPayload?.tool_name === "ExitPlanMode";
}

function buildExitPlanPermissionUpdates(action) {
  const mode = { allowOnce: "default", allowAlways: "acceptEdits" }[action];
  return mode ? [{ type: "setMode", mode, destination: "session" }] : [];
}

function buildPermissionDirective(pending, resolution) {
  const allowed = resolution.action !== "deny";
  const allowAlways = resolution.action === "allowAlways";
  switch (pending.tool) {
    case "opencode":
    case "sara":
      if (!allowed) return { type: "deny", reason: resolution.message };
      return allowAlways ? { type: "allow", permanent: true } : { type: "allow" };
    case "claude": {
      const decision = createHookDecision(allowed, resolution.message);
      if (isExitPlanMode(pending)) {
        const updates = buildExitPlanPermissionUpdates(resolution.action);
        if (updates.length) decision.updatedPermissions = updates;
      } else if (allowAlways) {
        const suggestions = pending.permissionPayload?.permission_suggestions;
        if (Array.isArray(suggestions) && suggestions.length) {
          decision.updatedPermissions = suggestions;
        }
      }
      return wrapPermissionRequestDecision(decision);
    }
    case "coco":
      return wrapPermissionRequestDecision(
        createHookDecision(allowed, resolution.message, { interrupt: true })
      );
    case "aiden":
    case "codex":
    case "traex":
      return wrapPermissionRequestDecision(createHookDecision(allowed, resolution.message));
    case "cursor": {
      const directive = { permission: allowed ? "allow" : "deny" };
      if (resolution.message) directive.user_message = resolution.message;
      return directive;
    }
    case "kimi": {
      const output = {
        hookEventName: "PreToolUse",
        permissionDecision: allowed ? "allow" : "deny"
      };
      if (!allowed && resolution.message) output.permissionDecisionReason = resolution.message;
      return { hookSpecificOutput: output };
    }
    case "copilot-cli": {
      const result = { permissionDecision: allowed ? "allow" : "deny" };
      if (!allowed && resolution.message) result.permissionDecisionReason = resolution.message;
      return result;
    }
    default:
      return { decision: allowed ? "allow" : "deny", message: resolution.message };
  }
}

module.exports = { buildPermissionDirective };
