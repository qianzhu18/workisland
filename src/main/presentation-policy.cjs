"use strict";

function createPresentationRequest(event, settings) {
  if (event.type === "sessionCompleted") {
    if (!settings.expandOnSessionComplete) return null;
    if (event.isInterrupt || event.isSessionEnd || event.isRalphLoopIteration) return null;
    return {
      // Notifications deliberately reuse the regular hover panel.  Restricting
      // the list keeps a completed task from opening every live session at once.
      surface: {
        type: "sessionList",
        actionableSessionId: event.sessionId,
        visibleSessionIds: [event.sessionId]
      },
      priority: event.error ? "error" : "completion",
      autoDismiss: !event.error,
      suppressWhenFocused: !event.error
    };
  }

  if (event.type === "permissionRequested" || event.type === "questionAsked") {
    if (!settings.expandOnActionRequired) return null;
    return {
      surface: { type: "sessionList", actionableSessionId: event.sessionId },
      priority: "action-required",
      autoDismiss: false,
      suppressWhenFocused: false
    };
  }

  return null;
}

function selectAutomaticSurface(event, settings) {
  return createPresentationRequest(event, settings)?.surface ?? null;
}

module.exports = { createPresentationRequest, selectAutomaticSurface };
