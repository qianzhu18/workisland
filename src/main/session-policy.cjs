"use strict";

function isPluginAgentTool(tool) {
  return typeof tool === "string" && tool.startsWith("plugin:");
}

function requiresAttention(phase) {
  return phase === "waitingForApproval" || phase === "waitingForAnswer";
}

function isVisibleInIsland(session) {
  if (session.parentSessionId) return false;
  if (requiresAttention(session.phase)) return true;
  // Completed work stays available until the user explicitly opens it.
  // Auto-collapsing the notification must not erase an unread result.
  if (session.phase === "completed") return !session.completionDismissed;
  if (session.isHookManaged) {
    if (session.isSessionEnded) return false;
    if (session.tool === "trae") return Boolean(session.latestUserPrompt);
    if (session.latestUserPrompt) return true;
    return session.tool === "kimi";
  }
  return Boolean(session.isProcessAlive);
}

function canContinueSessionViaTerminalPrompt(session) {
  if (session.phase !== "completed") return false;
  if (session.tool !== "claude" && session.tool !== "codex") return false;
  const target = session.jumpTarget;
  if (!target || target.remote || typeof target.app !== "string") return false;
  if (target.tmuxTarget) return true;
  const app = target.app.trim().toLowerCase();
  if (["iterm2", "iterm", "iterm.app"].includes(app)) return Boolean(target.tabId || target.tty);
  if (["terminal", "apple_terminal"].includes(app)) return Boolean(target.tty);
  return false;
}

function shouldAutoDismiss(surface, sessionPhase) {
  return surface.type === "sessionList"
    && Boolean(surface.actionableSessionId)
    && sessionPhase === "completed";
}

module.exports = {
  canContinueSessionViaTerminalPrompt,
  isPluginAgentTool,
  isVisibleInIsland,
  requiresAttention,
  shouldAutoDismiss
};
