export function isVisibleInIsland(session) {
  if (session.parentSessionId) return false;
  if (session.phase === "waitingForApproval" || session.phase === "waitingForAnswer") return true;
  if (session.phase === "completed") return !session.completionDismissed;

  if (session.isHookManaged) {
    if (session.isSessionEnded) return false;
    if (session.tool === "trae") return Boolean(session.latestUserPrompt);
    if (session.latestUserPrompt) return true;
    return session.tool === "kimi";
  }

  return Boolean(session.isProcessAlive);
}

export function canContinueSessionViaTerminalPrompt(session) {
  if (session.phase !== "completed") return false;
  if (session.tool !== "claude" && session.tool !== "codex") return false;

  const target = session.jumpTarget;
  if (!target || target.remote || typeof target.app !== "string") return false;
  if (target.tmuxTarget) return true;

  const app = target.app.trim().toLowerCase();
  if (["iterm2", "iterm", "iterm.app"].includes(app)) return Boolean(target.tabId || target.tty);
  if (app === "terminal" || app === "apple_terminal") return Boolean(target.tty);
  return false;
}

export function sortVisibleSessions(sessions) {
  return sessions.filter(isVisibleInIsland).sort((left, right) => right.updatedAt - left.updatedAt);
}

export function filterSurfaceSessions(sessions, surface) {
  const ids = surface?.visibleSessionIds;
  if (!Array.isArray(ids)) return sessions;
  return sessions.filter((session) => ids.includes(session.id));
}
