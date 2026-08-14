"use strict";

function selectAutomaticSurface(event, settings) {
  if (event.type === "sessionCompleted") {
    if (!settings.expandOnSessionComplete) return null;
    if (event.isInterrupt || event.isSessionEnd || event.isRalphLoopIteration) return null;
    return { type: "completion", actionableSessionId: event.sessionId };
  }

  if (event.type === "permissionRequested" || event.type === "questionAsked") {
    if (!settings.expandOnActionRequired) return null;
    return { type: "sessionList", actionableSessionId: event.sessionId };
  }

  return null;
}

module.exports = { selectAutomaticSurface };
