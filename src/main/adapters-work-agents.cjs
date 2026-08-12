"use strict";

const { ClaudeAdapter } = require("./adapters-cli.cjs");

class ClaudeCompatibleWorkAgentAdapter extends ClaudeAdapter {
  constructor(agentId, defaultApp, { nativeQuestions = false } = {}) {
    super();
    this.agentId = agentId;
    this.defaultApp = defaultApp;
    this.nativeQuestions = nativeQuestions;
  }

  handleHook(clientId, payload, ctx) {
    if (this.nativeQuestions && payload.hook_event_name === "PermissionRequest" && payload.tool_name === "AskUserQuestion") {
      ctx.sendResponse(clientId, { type: "acknowledged" });
      return;
    }
    const wrappedContext = {
      ...ctx,
      attachClaudeTranscriptWatcher: () => {},
      detachClaudeTranscriptWatcher: () => {},
      updateJumpTarget: (sessionId, tool, overrides = {}) => {
        const terminalApp = payload.terminal_app || overrides.terminal_app || this.defaultApp;
        ctx.updateJumpTarget(sessionId, tool, {
          ...overrides,
          terminal_app: terminalApp,
          cwd: overrides.cwd || payload.cwd
        });
      }
    };
    super.handleHook(clientId, payload, wrappedContext);
  }
}

class ZCodeAdapter extends ClaudeCompatibleWorkAgentAdapter {
  constructor() {
    super("zcode", "ZCode", { nativeQuestions: true });
  }
}

class WorkBuddyAdapter extends ClaudeCompatibleWorkAgentAdapter {
  constructor() {
    super("workbuddy", "WorkBuddy");
  }
}

module.exports = { ZCodeAdapter, WorkBuddyAdapter };
