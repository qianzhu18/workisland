import { isVisibleInIsland } from '../session-model.mjs';

export function shouldDeferAgentSurface(payload, terminalVisible) {
  return Boolean(terminalVisible && payload?.reason === 'notification'
    && ['sessionList', 'completion'].includes(payload.surface?.type));
}

export function terminalPendingSessions(sessions) {
  const latest = new Map();
  for (const session of [...sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))) {
    if (session.id && !latest.has(session.id)) latest.set(session.id, session);
  }
  return [...latest.values()].filter(session => isVisibleInIsland(session)
    && (session.phase === 'waitingForApproval' || session.phase === 'waitingForAnswer'
      || (session.phase === 'completed' && session.error && !session.completionDismissed)));
}
