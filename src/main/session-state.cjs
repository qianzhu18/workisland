"use strict";

function createSessionState({ isVisibleInIsland }) {
  function createInitialState() {
    return { sessions: /* @__PURE__ */ new Map() };
  }
  function shouldUseActivityAsSubagentToolLine(activity) {
    if (!activity?.trim()) return false;
    const t = activity.trim();
    if (/^prompt:/i.test(t)) return false;
    if (/^processing prompt/i.test(t)) return false;
    if (/^thinking\.{0,3}$/i.test(t)) return false;
    return true;
  }
  function syncSubagentFields(sessions, childSession) {
    const parentId = childSession.parentSessionId;
    if (!parentId) return;
    const parent = sessions.get(parentId);
    if (!parent?.activeSubagents) return;
    const idx = parent.activeSubagents.findIndex((s) => s.agentId === childSession.id);
    if (idx < 0) return;
    const info = parent.activeSubagents[idx];
    const updated = {
      ...info,
      title: childSession.title || info.title,
      phase: childSession.phase || info.phase,
      lastToolActivity: shouldUseActivityAsSubagentToolLine(childSession.currentActivity) ? childSession.currentActivity.trim() : info.lastToolActivity
    };
    if (updated.title === info.title && updated.phase === info.phase && updated.lastToolActivity === info.lastToolActivity) return;
    const next = [...parent.activeSubagents];
    next[idx] = updated;
    sessions.set(parentId, { ...parent, activeSubagents: next });
  }
  function getOrCreateSession(state, event) {
    const existing = state.sessions.get(event.sessionId);
    if (existing) return existing;
    return {
      id: event.sessionId,
      title: "",
      tool: event.tool,
      phase: "running",
      createdAt: event.timestamp,
      updatedAt: event.timestamp,
      isSessionEnded: false,
      isProcessAlive: false,
      isHookManaged: true,
      recoveredFromTranscript: false,
      completionDismissed: false,
      isRemote: false
    };
  }
  function apply(state, event) {
    const sessions = new Map(state.sessions);
    const prev = getOrCreateSession(state, event);
    let session;
    switch (event.type) {
      case "sessionStarted": {
        session = {
          ...prev,
          title: event.title ?? prev.title,
          tool: event.tool,
          phase: "running",
          summary: event.summary ?? prev.summary,
          latestUserPrompt: event.latestUserPrompt ?? prev.latestUserPrompt,
          parentSessionId: event.parentSessionId ?? prev.parentSessionId,
          // 透传 source。`event.source ?? prev.source` 避免 pull adapter 多轮 sessionStarted
          // 时意外清空已有标签。
          source: event.source ?? prev.source,
          isSessionEnded: false,
          completionDismissed: false,
          isPullColdCompleteSession: false,
          recoveredFromTranscript: !!event.recoveredFromTranscript,
          recoveryTranscriptPath: event.recoveryTranscriptPath ?? (event.recoveredFromTranscript ? prev.recoveryTranscriptPath : void 0),
          // 显式清 error / errorDetail：与 turnStarted 保持 parity —— 新一轮 = 干净状态。
          // sessionCompleted reducer 用 `event.error ?? prev.error` 透传，残留会让
          // 下一轮成功完成时仍渲染为错误完成卡。
          error: void 0,
          errorDetail: void 0,
          // 新一轮 turn 开始：清掉上一轮残留的 activeTool（理论上 toolUseCompleted
          // 已经清过，这里是防御性兜底，避免上一轮未配对的 toolUseStarted 导致
          // sweep 误判"还有工具在跑"）。
          activeTool: void 0,
          createdAt: event.timestamp,
          updatedAt: event.timestamp
        };
        break;
      }
      case "activityUpdated": {
        const phase = prev.phase === "waitingForApproval" || prev.phase === "waitingForAnswer" ? prev.phase : "running";
        session = {
          ...prev,
          title: event.title ?? prev.title,
          currentActivity: event.activity ?? prev.currentActivity,
          // 仅当事件显式给出非 undefined 值时才覆盖；空字符串 "" 用作显式清空信号
          latestUserPrompt: event.latestUserPrompt !== void 0 ? event.latestUserPrompt : prev.latestUserPrompt,
          lastAssistantMessage: event.lastAssistantMessage !== void 0 ? event.lastAssistantMessage : prev.lastAssistantMessage,
          phase,
          isPullColdCompleteSession: false,
          updatedAt: event.timestamp
        };
        break;
      }
      case "traeIdeTitleUpdated": {
        session = {
          ...prev,
          title: event.title ?? prev.title,
          updatedAt: event.timestamp
        };
        break;
      }
      case "turnStarted": {
        session = {
          ...prev,
          phase: "running",
          latestUserPrompt: event.latestUserPrompt ?? prev.latestUserPrompt,
          isSessionEnded: false,
          completionDismissed: false,
          isPullColdCompleteSession: false,
          error: void 0,
          errorDetail: void 0,
          // 防御性兜底：上一轮可能有未配对的 toolUseStarted（pull adapter 不发
          // tool 事件，理论上不会出现，但保留与 sessionStarted 一致的清理语义）。
          activeTool: void 0,
          createdAt: event.timestamp,
          updatedAt: event.timestamp
        };
        break;
      }
      case "permissionRequested": {
        session = {
          ...prev,
          phase: "waitingForApproval",
          permissionRequest: event.permissionRequest,
          isPullColdCompleteSession: false,
          updatedAt: event.timestamp
        };
        break;
      }
      case "permissionResolved": {
        if (prev.phase !== "waitingForApproval") {
          session = prev;
          break;
        }
        const shouldComplete = prev.isSessionEnded && prev.isHookManaged;
        session = shouldComplete ? {
          ...prev,
          phase: "completed",
          permissionRequest: void 0,
          currentActivity: void 0,
          completionDismissed: true,
          updatedAt: event.timestamp
        } : {
          ...prev,
          phase: "running",
          permissionRequest: void 0,
          updatedAt: event.timestamp
        };
        break;
      }
      case "questionAsked": {
        session = {
          ...prev,
          phase: "waitingForAnswer",
          questionPrompt: event.questionPrompt,
          isPullColdCompleteSession: false,
          updatedAt: event.timestamp
        };
        break;
      }
      case "questionAnswered": {
        const shouldComplete = prev.isSessionEnded && prev.isHookManaged;
        session = shouldComplete ? {
          ...prev,
          phase: "completed",
          questionPrompt: void 0,
          currentActivity: void 0,
          completionDismissed: true,
          updatedAt: event.timestamp
        } : {
          ...prev,
          phase: "running",
          questionPrompt: void 0,
          updatedAt: event.timestamp
        };
        break;
      }
      case "planConfirmationRequested": {
        session = {
          ...prev,
          phase: "waitingForAnswer",
          planConfirmation: event.planConfirmation,
          isPullColdCompleteSession: false,
          updatedAt: event.timestamp
        };
        break;
      }
      case "planConfirmationAnswered": {
        const shouldComplete = prev.isSessionEnded && prev.isHookManaged;
        session = shouldComplete ? {
          ...prev,
          phase: "completed",
          planConfirmation: void 0,
          currentActivity: void 0,
          completionDismissed: true,
          updatedAt: event.timestamp
        } : {
          ...prev,
          phase: "running",
          planConfirmation: void 0,
          updatedAt: event.timestamp
        };
        break;
      }
      case "toolUseStarted": {
        const nextActivity = event.activity ?? (event.toolName != null ? String(event.toolName) : prev.currentActivity);
        const nextActiveTool = event.toolName != null ? String(event.toolName) : prev.activeTool;
        session = {
          ...prev,
          currentActivity: nextActivity,
          activeTool: nextActiveTool,
          isPullColdCompleteSession: false,
          updatedAt: event.timestamp
        };
        break;
      }
      case "toolUseCompleted": {
        session = {
          ...prev,
          currentActivity: void 0,
          // 工具结束 → 清空状态机字段，让 sweep 可以正确识别"无活跃工具"。
          activeTool: void 0,
          updatedAt: event.timestamp
        };
        break;
      }
      case "sessionCompleted": {
        const isEnd = event.isSessionEnd ?? prev.isSessionEnded;
        const isPending = prev.phase === "waitingForApproval" || prev.phase === "waitingForAnswer";
        if (isPending) {
          session = {
            ...prev,
            title: event.title ?? prev.title,
            summary: event.summary ?? prev.summary,
            lastAssistantMessage: event.lastAssistantMessage ?? prev.lastAssistantMessage,
            latestUserPrompt: event.latestUserPrompt ?? prev.latestUserPrompt,
            isSessionEnded: isEnd,
            error: event.error ?? prev.error,
            errorDetail: event.errorDetail ?? prev.errorDetail,
            updatedAt: event.timestamp
          };
          break;
        }
        session = {
          ...prev,
          title: event.title ?? prev.title,
          phase: "completed",
          currentActivity: void 0,
          activeSubagents: [],
          // Turn 完成时清空残留的 subagent，防止 CLI 未发 subagent_stop 导致泄漏
          // 一轮 turn 结束（包含被 sweep / watcher 合成的中断结束）也要清 activeTool，
          // 否则下一次 sweep 仍会看到上一轮残留的工具名而 skip。
          activeTool: void 0,
          summary: event.summary ?? prev.summary,
          lastAssistantMessage: event.lastAssistantMessage ?? prev.lastAssistantMessage,
          latestUserPrompt: event.latestUserPrompt ?? prev.latestUserPrompt,
          isSessionEnded: isEnd,
          // Completion notifications may auto-collapse, but the result remains
          // unread until the user opens the session explicitly.
          completionDismissed: isEnd ? false : prev.completionDismissed,
          isPullColdCompleteSession: !!event.isPullColdCompleteSession,
          error: event.error ?? prev.error,
          errorDetail: event.errorDetail ?? prev.errorDetail,
          updatedAt: event.timestamp
        };
        break;
      }
      case "sessionDeleted": {
        sessions.delete(event.sessionId);
        return { sessions };
      }
      case "jumpTargetUpdated": {
        session = {
          ...prev,
          jumpTarget: event.jumpTarget,
          updatedAt: event.timestamp
        };
        break;
      }
      case "processAttached": {
        session = {
          ...prev,
          isProcessAlive: true,
          updatedAt: event.timestamp
        };
        break;
      }
      case "processDetached": {
        session = {
          ...prev,
          isProcessAlive: false,
          updatedAt: event.timestamp
        };
        break;
      }
      case "subagentStarted": {
        const info = event.subAgentInfo;
        if (!info) {
          return state;
        }
        const existing = prev.activeSubagents ?? [];
        if (existing.some((s) => s.agentId === info.agentId)) {
          return state;
        }
        session = {
          ...prev,
          activeSubagents: [...existing, info],
          updatedAt: event.timestamp
        };
        break;
      }
      case "subagentStopped": {
        const info = event.subAgentInfo;
        if (!info) {
          return state;
        }
        const existing = prev.activeSubagents ?? [];
        session = {
          ...prev,
          activeSubagents: existing.filter((s) => s.agentId !== info.agentId),
          currentActivity: event.activity ?? prev.currentActivity,
          updatedAt: event.timestamp
        };
        break;
      }
      case "subagentToolActivity": {
        const subAgentId = event.subAgentId;
        const line = event.activity?.trim();
        if (!subAgentId || !line) return state;
        const existing = prev.activeSubagents ?? [];
        const idx = existing.findIndex((s) => s.agentId === subAgentId);
        if (idx < 0) return state;
        const next = [...existing];
        next[idx] = { ...next[idx], lastToolActivity: line };
        session = {
          ...prev,
          activeSubagents: next,
          updatedAt: event.timestamp
        };
        break;
      }
      default: {
        return state;
      }
    }
    sessions.set(event.sessionId, session);
    syncSubagentFields(sessions, session);
    return { sessions };
  }
  function getVisibleSessions(state) {
    return Array.from(state.sessions.values()).filter(isVisibleInIsland).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  function removeInvisibleSessions(state) {
    const before = state.sessions.size;
    const referencedChildIds = /* @__PURE__ */ new Set();
    for (const session of Array.from(state.sessions.values())) {
      if (session.activeSubagents) {
        for (const sub of session.activeSubagents) referencedChildIds.add(sub.agentId);
      }
    }
    const sessions = /* @__PURE__ */ new Map();
    for (const [id, session] of Array.from(state.sessions.entries())) {
      if (isVisibleInIsland(session) || referencedChildIds.has(id)) {
        sessions.set(id, session);
      }
    }
    return { state: { sessions }, changed: sessions.size !== before };
  }
  function getSession(state, id) {
    return state.sessions.get(id);
  }
  function removeStaleSessions(state, thresholdMs) {
    if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) {
      return { state, changed: false };
    }
    const cutoff = Date.now() - thresholdMs;
    const sessions = /* @__PURE__ */ new Map();
    for (const [id, session] of Array.from(state.sessions.entries())) {
      if (session.phase === "completed" && !session.completionDismissed) {
        sessions.set(id, session);
      } else if (session.updatedAt > cutoff) {
        sessions.set(id, session);
      }
    }
    return { state: { sessions }, changed: sessions.size !== state.sessions.size };
  }
  return {
    createInitialState,
    apply,
    getVisibleSessions,
    removeInvisibleSessions,
    getSession,
    removeStaleSessions
  };
}

module.exports = { createSessionState };
