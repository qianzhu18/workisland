"use strict";

function createPresentationRequest(event, settings) {
  const isTaskSubmission = (event.type === "sessionStarted" || event.type === "activityUpdated")
    && typeof event.latestUserPrompt === "string"
    && event.latestUserPrompt.trim().length > 0;

  if (isTaskSubmission) {
    if (!settings.expandOnSessionSubmit) return null;
    return {
      // A submitted prompt is the start of a user-visible turn. Keep the
      // same filtered panel as completion notifications and let the renderer
      // dismiss it after the configured short notification window.
      surface: {
        type: "sessionList",
        actionableSessionId: event.sessionId,
        visibleSessionIds: [event.sessionId]
      },
      priority: "submission",
      autoDismiss: true,
      suppressWhenFocused: false
    };
  }

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
      // A completion is a user-visible outcome, not background progress. It
      // must remain visible even when the originating Agent is frontmost.
      suppressWhenFocused: false
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
