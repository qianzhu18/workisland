export function isVisibleInIsland(session) {
  if (session.parentSessionId) return false;
  if (session.phase === "waitingForApproval" || session.phase === "waitingForAnswer") return true;

  // PRD-016 远程会话（observe-only）：不回传 latestUserPrompt（D3），
  // 只要未结束就保留在岛上；断线时以断线完成态收卡，不悬挂假 running。
  if (session.isRemote) return !session.isSessionEnded;

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

// 跨 Agent 交接（#126/#129）：完成/失败的本地会话且拿到了项目目录即可交接。
// 目标侧能力（能否自动注入）由预览结果分级展示，这里不做工具白名单——
// 交接包对任何源工具都能从会话字段 + Git 证据组装。
export function canHandoffSession(session) {
  if (session.phase !== "completed") return false;
  if (session.isRemote) return false;
  return Boolean(session.jumpTarget?.workingDirectory);
}

export function sortVisibleSessions(sessions) {
  return sessions.filter(isVisibleInIsland).sort((left, right) => right.updatedAt - left.updatedAt);
}

export function filterSurfaceSessions(sessions, surface) {
  const ids = surface?.visibleSessionIds;
  if (!Array.isArray(ids)) return sessions;
  return sessions.filter((session) => ids.includes(session.id));
}
