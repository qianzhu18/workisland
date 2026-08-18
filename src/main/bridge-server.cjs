"use strict";

const fs = require("node:fs");
const net = require("node:net");
const crypto = require("node:crypto");
const log = require("electron-log");
const { EventEmitter } = require("node:events");
const { encodeLine, decodeLines, getSocketPath, ensureSocketDir, cleanupSocket } = require("./bridge-protocol.cjs");
const { buildPermissionDirective, wrapWorkBuddyPermissionDecision } = require("./permission-directives.cjs");

function createBridgeServerClass({
  adapterRegistry,
  PluginAdapter,
  ClaudeTranscriptWatcher,
  createHookPayloadRecorder,
  isPluginAgentTool,
  normalizeAgentPid,
  normalizeIdeWorkspace,
  normalizeTerminalAppForHookSource,
  parseTokenUsagePayload,
  getOriginalQuestions,
  getStructuredOriginalQuestions,
  mapStructuredAnswersToClaude,
  mapStructuredAnswersToOpenCode,
  renderAnswerSummary
}) {
  class BridgeServer extends EventEmitter {
    server = null;
    clients = /* @__PURE__ */ new Map();
    pendingPermissions = /* @__PURE__ */ new Map();
    pendingQuestions = /* @__PURE__ */ new Map();
    socketPath;
    soundEventHandler = null;
    approvalModeProvider = null;
    recorder = null;
    sessionTitleProvider = null;
    shouldAcceptHook;
    // PluginAdapter 不进 adapterRegistry，由 BridgeServer 在 plugin: 前缀分支显式调用。
    pluginAdapter = new PluginAdapter();
    /**
     * 监听 Claude transcript 文件，实时检测用户 ESC 中断（Phase 2 短路）。
     * 详见 ClaudeTranscriptWatcher 的类注释。
     */
    claudeTranscriptWatcher;
    /**
     * 构造 BridgeServer。
     * `shouldAcceptHook` 允许主进程按当前设置做运行时短路，例如用户关闭 Hermes 后，
     * 即使旧的 Hermes 进程仍在发 hook，也直接 ACK 丢弃，不再进入 adapter / 埋点 / UI。
     */
    constructor(opts = {}) {
      super();
      this.socketPath = getSocketPath();
      this.shouldAcceptHook = opts.shouldAcceptHook ?? null;
      this.recorder = createHookPayloadRecorder();
      this.claudeTranscriptWatcher = new ClaudeTranscriptWatcher({
        onInterruptDetected: (sessionId) => {
          this.emitEvent({
            type: "sessionCompleted",
            sessionId,
            tool: "claude",
            timestamp: Date.now(),
            isInterrupt: true,
            isSessionEnd: false,
            detectionSource: "claude-transcript"
          });
        },
        onCompletionDetected: (sessionId, completion) => {
          // hook 之外的第二完成通道：从 transcript 直接识别 assistant turn 成功完成。
          // detectionSource 标记来源，供 agent-event-dedup 与 hook 通道去重。
          this.emitEvent({
            type: "sessionCompleted",
            sessionId,
            tool: "claude",
            timestamp: Date.now(),
            summary: completion.summary,
            lastAssistantMessage: completion.lastAssistantMessage,
            isInterrupt: false,
            isSessionEnd: false,
            final: true,
            detectionSource: "claude-transcript"
          });
        }
      });
      log.info("[BridgeServer] Initialized in local-only mode");
    }
    setSoundEventHandler(handler) {
      this.soundEventHandler = handler;
    }
    setApprovalModeProvider(provider) {
      this.approvalModeProvider = provider;
    }
    setSessionTitleProvider(provider) {
      this.sessionTitleProvider = provider;
    }
    start() {
      ensureSocketDir();
      cleanupSocket(this.socketPath);
      this.server = net.createServer((socket) => this.handleConnection(socket));
      this.server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          log.warn("[BridgeServer]", "EADDRINUSE — probing stale socket before retry");
          const probe = net.createConnection({ path: this.socketPath }, () => {
            probe.end();
            log.error("[BridgeServer]", "another instance is already listening — giving up");
          });
          probe.on("error", () => {
            try {
              require("fs").unlinkSync(this.socketPath);
              log.info("[BridgeServer]", "removed stale socket, retrying listen");
            } catch (e) {
              log.error("[BridgeServer]", "cannot remove stale socket:", e.message);
            }
            this.server?.listen(this.socketPath);
          });
        } else {
          log.error("[BridgeServer]", "error:", err.message);
        }
      });
      this.server.listen(this.socketPath, () => {
        log.info("[BridgeServer]", "Listening on", this.socketPath);
      });
    }
    stop() {
      for (const client of this.clients.values()) {
        client.socket.destroy();
      }
      this.clients.clear();
      this.pendingPermissions.clear();
      this.pendingQuestions.clear();
      this.claudeTranscriptWatcher.detachAll();
      if (this.server) {
        this.server.close();
        this.server = null;
      }
      cleanupSocket(this.socketPath);
    }
    /**
     * 确保 socket 文件存在且可连接。
     * 如果 socket 文件丢失（例如被系统清理或 dev 重载竞态），重新 listen。
     */
    ensureListening() {
      if (fs.existsSync(this.socketPath)) return;
      log.warn("[BridgeServer] Socket file missing, re-creating:", this.socketPath);
      if (this.server) {
        this.server.close();
        this.server = null;
      }
      this.start();
    }
    handleConnection(socket) {
      const clientId = crypto.randomUUID();
      const client = { id: clientId, socket, buffer: Buffer.alloc(0) };
      this.clients.set(clientId, client);
      log.info("[BridgeServer]", "New connection, clientId:", clientId, "total clients:", this.clients.size);
      const hello = {
        type: "hello",
        hello: { protocolVersion: 1, serverLabel: "flux-desktop" }
      };
      socket.write(encodeLine(hello));
      socket.on("data", (chunk) => {
        client.buffer = Buffer.concat([client.buffer, chunk]);
        const { messages, remainder } = decodeLines(client.buffer);
        client.buffer = remainder;
        for (const msg of messages) {
          if (msg.type === "command") {
            this.handleCommand(clientId, msg.command);
          }
        }
      });
      socket.on("close", () => {
        log.info("[BridgeServer]", "Client disconnected:", clientId);
        this.clients.delete(clientId);
        this.resolvePendingByClientId(clientId);
      });
      socket.on("error", (err) => {
        log.warn("[BridgeServer]", "Client error:", clientId, err.message);
        this.clients.delete(clientId);
        this.resolvePendingByClientId(clientId);
      });
    }
    // client 断开后的收尾：
    // 普通情况直接清掉；Coco terminal-native 先保留，等后续 hook 再清。
    resolvePendingByClientId(clientId) {
      for (const [sessionId, pending] of this.pendingPermissions) {
        if (pending.clientId !== clientId) continue;
        if (pending.disconnectPolicy === "preserveOnDisconnect") {
          this.pendingPermissions.set(sessionId, {
            ...pending,
            responseChannelClosedAt: pending.responseChannelClosedAt ?? Date.now()
          });
          return;
        }
        this.pendingPermissions.delete(sessionId);
        this.emitEvent({
          type: "permissionResolved",
          sessionId,
          tool: pending.tool,
          timestamp: Date.now()
        });
        return;
      }
      for (const [sessionId, pending] of this.pendingQuestions) {
        if (pending.clientId === clientId) {
          if (pending.disconnectPolicy === "preserveOnDisconnect") {
            this.pendingQuestions.set(sessionId, {
              ...pending,
              responseChannelClosedAt: pending.responseChannelClosedAt ?? Date.now()
            });
            return;
          }
          this.pendingQuestions.delete(sessionId);
          this.emitEvent({
            type: "questionAnswered",
            sessionId,
            tool: pending.tool,
            timestamp: Date.now(),
            answerSummary: ""
          });
          return;
        }
      }
    }
    handleCommand(clientId, command) {
      switch (command.type) {
        case "resolvePermission":
          this.resolvePermission(command.sessionId, command.resolution);
          break;
        case "answerQuestion":
          this.answerQuestion(command.sessionId, command.answer);
          break;
        case "reportTokenUsage": {
          this.sendResponse(clientId, { type: "acknowledged" });
          const parsed = parseTokenUsagePayload(command.tokenUsage);
          if (parsed) {
            this.emit("tokenUsageReported", {
              tool: command.source,
              sessionId: command.sessionId,
              tokenUsage: parsed,
              isRemote: false
            });
          }
          break;
        }
        case "processHook": {
          if (this.shouldAcceptHook && !this.shouldAcceptHook(command.source)) {
            this.sendResponse(clientId, { type: "acknowledged" });
            return;
          }
          if (this.recorder) {
            this.recorder.record(command.source, command.payload);
          }
          const adapter = adapterRegistry.get(command.source);
          if (!adapter && isPluginAgentTool(command.source)) {
            command.payload._source = command.source;
            this.pluginAdapter.handleHook(
              clientId,
              command.payload,
              this.createAdapterContext(command.payload)
            );
            this.emit("hookProcessed", {
              hookEventName: command.payload.hook_event_name ?? command.payload.event_type,
              tool: command.source,
              sessionId: command.payload.session_id ?? command.payload.conversation_id,
              isRemote: false,
              transcriptPath: void 0,
              turnId: void 0,
              tokenUsage: void 0
            });
            return;
          }
          if (!adapter) {
            log.warn("[BridgeServer]", "No adapter for source:", command.source, "— sending ACK");
            this.sendResponse(clientId, { type: "acknowledged" });
            return;
          }
          command.payload._source = command.source;
          adapter.handleHook(clientId, command.payload, this.createAdapterContext(command.payload));
          this.emit("hookProcessed", {
            hookEventName: command.payload.hook_event_name ?? command.payload.event_type,
            tool: command.source,
            sessionId: command.payload.session_id ?? command.payload.conversation_id,
            isRemote: false,
            // 修复：Codex 中断 turn 时不发 Stop hook，AppCoordinator 需要靠 transcript
            // 末尾的 turn_aborted/interrupted 事件兜底停表（详见 CodexTranscriptReader）。
            // 把 transcript_path / turn_id 透出到 hookProcessed，让 AppCoordinator 在
            // codexSessionMeta 中维护，避免 sweep 时回头去翻原始 hook payload。
            // 其他 tool 可空（未读取）。
            transcriptPath: command.payload.transcript_path,
            turnId: command.payload.turn_id
          });
          break;
        }
      }
    }
    createAdapterContext(hookPayload) {
      return {
        isRemote: false,
        getSessionTitle: (sessionId) => this.sessionTitleProvider?.(sessionId),
        emitEvent: (event) => this.emitEvent(event),
        sendResponse: (clientId, response) => {
          if (response.type === "hookDirective" && response.directive) {
            this.sendResponse(clientId, { type: "hookDirective", directive: response.directive });
          } else {
            this.sendResponse(clientId, { type: "acknowledged" });
          }
        },
        setPendingPermission: (sessionId, clientId, tool, options, payload) => {
          this.pendingPermissions.set(sessionId, {
            clientId,
            sessionId,
            tool,
            createdAt: Date.now(),
            // 默认沿用老逻辑：断线就清，审批按 bridge 处理。
            disconnectPolicy: options?.disconnectPolicy ?? "resolveOnDisconnect",
            approvalMode: options?.approvalMode ?? "bridge",
            responseChannelClosedAt: options?.responseChannelClosedAt,
            permissionPayload: payload
          });
        },
        setPendingQuestion: (sessionId, clientId, tool, options, payload) => {
          this.pendingQuestions.set(sessionId, {
            clientId,
            sessionId,
            tool,
            createdAt: Date.now(),
            disconnectPolicy: options?.disconnectPolicy ?? "resolveOnDisconnect",
            questionPayload: payload
          });
        },
        clearStalePendingInteraction: (sessionId, onlyStale) => {
          const pendingPerm = this.pendingPermissions.get(sessionId);
          if (pendingPerm) {
            if (onlyStale && !pendingPerm.responseChannelClosedAt) return;
            this.pendingPermissions.delete(sessionId);
            this.emitEvent({
              type: "permissionResolved",
              sessionId,
              tool: pendingPerm.tool,
              timestamp: Date.now()
            });
            if (!pendingPerm.responseChannelClosedAt) {
              this.sendResponse(pendingPerm.clientId, { type: "acknowledged" });
            }
            return;
          }
          const pendingQ = this.pendingQuestions.get(sessionId);
          if (pendingQ) {
            if (onlyStale && !pendingQ.responseChannelClosedAt) return;
            this.pendingQuestions.delete(sessionId);
            this.emitEvent({
              type: "questionAnswered",
              sessionId,
              tool: pendingQ.tool,
              timestamp: Date.now(),
              answerSummary: ""
            });
            if (!pendingQ.responseChannelClosedAt) {
              this.sendResponse(pendingQ.clientId, { type: "acknowledged" });
            }
          }
        },
        updateJumpTarget: (sessionId, tool, overrides = {}) => {
          const pickStr = (key) => {
            const o = overrides;
            if (typeof o[key] === "string") return o[key];
            if (hookPayload && typeof hookPayload[key] === "string") return hookPayload[key];
            return void 0;
          };
          const pickNum = (key) => {
            const o = overrides;
            if (typeof o[key] === "number") return o[key];
            if (hookPayload && typeof hookPayload[key] === "number") return hookPayload[key];
            return void 0;
          };
          const app = normalizeTerminalAppForHookSource(tool, pickStr("terminal_app"));
          if (!app) return;
          const jumpTarget = {
            app: app || "",
            // Claude Desktop 靠 claude://resume?session=<uuid> 深链定位会话，
            // 需要把会话 id 一路带到 TerminalJumpService
            sessionId,
            tty: pickStr("terminal_tty"),
            tabId: pickStr("terminal_session_id"),
            paneId: pickStr("warp_pane_uuid"),
            workingDirectory: pickStr("cwd"),
            ideWorkspace: normalizeIdeWorkspace(hookPayload, overrides),
            pid: normalizeAgentPid(pickNum("pid")),
            kittyListenOn: pickStr("kitty_listen_on"),
            tmuxTarget: pickStr("tmux_target"),
            tmuxOuterHost: pickStr("tmux_outer_host"),
            tmuxClientTty: pickStr("tmux_client_tty"),
            remote: false
          };
          this.emitEvent({
            type: "jumpTargetUpdated",
            sessionId,
            tool,
            timestamp: Date.now(),
            jumpTarget
          });
        },
        playSoundEvent: (eventId) => {
          this.soundEventHandler?.(eventId);
        },
        getApprovalMode: (tool) => {
          return this.approvalModeProvider?.(tool) ?? "terminalNative";
        },
        // 仅 ClaudeAdapter 会调用，用于实时检测 ESC 中断（详见 ClaudeTranscriptWatcher）。
        attachClaudeTranscriptWatcher: (sessionId, transcriptPath) => {
          this.claudeTranscriptWatcher.attach(sessionId, transcriptPath);
        },
        detachClaudeTranscriptWatcher: (sessionId) => {
          this.claudeTranscriptWatcher.detach(sessionId);
        }
      };
    }
    resolvePermission(sessionId, resolution, force = false) {
      const pending = this.pendingPermissions.get(sessionId);
      if (!pending) {
        log.warn("[BridgeServer] resolvePermission: no pending permission found, sessionId=%s force=%s", sessionId, force);
        return;
      }
      if (!force && pending.approvalMode === "terminalNative") {
        log.warn("[BridgeServer] ignoring bridge resolution for terminal-native permission", sessionId);
        return;
      }
      this.pendingPermissions.delete(sessionId);
      this.emitEvent({
        type: "permissionResolved",
        sessionId,
        tool: pending.tool,
        timestamp: Date.now()
      });
      const directive = buildPermissionDirective(pending, resolution);
      if (directive) {
        this.sendResponse(pending.clientId, { type: "hookDirective", directive });
      } else {
        this.sendResponse(pending.clientId, { type: "acknowledged" });
      }
    }
    answerQuestion(sessionId, answer) {
      const pending = this.pendingQuestions.get(sessionId);
      if (!pending) return;
      let directive;
      try {
        directive = this.buildQuestionDirective(pending, answer);
      } catch (err) {
        log.error("[BridgeServer] failed to build answer directive", sessionId, err);
        directive = this.buildQuestionFallbackDenyDirective(pending, "");
      }
      let summary;
      try {
        summary = renderAnswerSummary(pending, answer);
      } catch (err) {
        log.error("[BridgeServer] failed to render answer summary", sessionId, err);
        summary = "";
      }
      this.pendingQuestions.delete(sessionId);
      this.emitEvent({
        type: "questionAnswered",
        sessionId,
        tool: pending.tool,
        timestamp: Date.now(),
        answerSummary: summary
      });
      this.sendResponse(pending.clientId, { type: "hookDirective", directive });
    }
    /**
     * 用户点取消按钮 / 主动退出 AskUserQuestion。与 answerQuestion 的 allow 链路分开，
     * 各 agent 走自己的"取消"语义（claude=deny+空 message，opencode=填空 answers，
     * 其他=通用 deny 兜底）。
     */
    cancelQuestion(sessionId, cancel) {
      const pending = this.pendingQuestions.get(sessionId);
      if (!pending) return;
      let directive;
      try {
        const cancelDirective = this.buildQuestionCancelDirective(pending, cancel);
        directive = cancelDirective ?? this.buildQuestionFallbackDenyDirective(
          pending,
          cancel.message ?? ""
        );
      } catch (err) {
        log.error("[BridgeServer] failed to build question-cancel directive", sessionId, err);
        directive = this.buildQuestionFallbackDenyDirective(pending, "");
      }
      this.pendingQuestions.delete(sessionId);
      this.emitEvent({
        type: "questionAnswered",
        sessionId,
        tool: pending.tool,
        timestamp: Date.now(),
        answerSummary: cancel.message ?? "",
        isCancelled: true
      });
      this.sendResponse(pending.clientId, { type: "hookDirective", directive });
    }
    /**
     * answerQuestion / cancelQuestion 内部 build 抛异常时的降级 directive。
     * 各 agent 协议格式不同，这里按各自 deny + message 形态返回。
     */
    buildQuestionFallbackDenyDirective(pending, message) {
      switch (pending.tool) {
        case "claude":
          return {
            hookSpecificOutput: {
              hookEventName: "PermissionRequest",
              decision: { behavior: "deny", message }
            }
          };
        case "workbuddy":
          return wrapWorkBuddyPermissionDecision(false, message);
        case "opencode":
        case "sara":
          return { type: "deny", reason: message };
        default:
          return { decision: "deny", message };
      }
    }
    /**
     * Build the hook directive to send back to the agent after the user answers an
     * AskUserQuestion prompt. 结构化 QuestionAnswerPayload；非
     * Claude/OpenCode 走 fallback deny
     */
    buildQuestionDirective(pending, payload) {
      if (pending.tool === "opencode" || pending.tool === "sara") {
        return this.buildOpenCodeAnswerDirective(pending, payload);
      }
      if (pending.tool === "claude" && pending.questionPayload) {
        return this.buildClaudeAnswerDirective(pending, payload);
      }
      if (pending.tool === "workbuddy" && pending.questionPayload) {
        return this.buildWorkBuddyAnswerDirective(pending, payload);
      }
      if (pending.tool === "copilot-cli") {
        return this.buildCopilotCliAnswerDirective(pending, payload);
      }
      log.warn(
        "[BridgeServer] unsupported answer-question tool, falling back to deny",
        pending.tool
      );
      return this.buildQuestionFallbackDenyDirective(
        pending,
        ""
      );
    }
    /**
     * Copilot CLI ask_user 的回答 directive。
     * 格式：{ permissionDecision: 'allow', userAnswer: '<选中选项文本>' }
     * Copilot CLI preToolUse hook 收到后继续执行 ask_user 工具并将 userAnswer 传入。
     */
    buildCopilotCliAnswerDirective(pending, payload) {
      const entry = payload.entries.find((e) => e.questionIndex === 0) ?? payload.entries[0];
      let answerText = "";
      if (entry) {
        const v = entry.values[0];
        if (v) {
          if (v.kind === "text") {
            answerText = v.text;
          } else if (v.kind === "option") {
            const raw = pending.questionPayload?.toolArgs || pending.questionPayload?.tool_args;
            if (typeof raw === "string") {
              try {
                const parsed = JSON.parse(raw);
                const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
                answerText = String(choices[v.index] ?? "");
              } catch {
                answerText = "";
              }
            }
          }
        }
      }
      return {
        permissionDecision: "allow",
        userAnswer: answerText
      };
    }
    /** Claude AskUserQuestion 的 allow + updatedInput.answers directive。 */
    buildClaudeAnswerDirective(pending, payload) {
      const originalQuestions = getOriginalQuestions(pending) ?? [];
      const structured = getStructuredOriginalQuestions(pending) ?? [];
      const answers = mapStructuredAnswersToClaude(structured, payload);
      return {
        hookSpecificOutput: {
          hookEventName: "PermissionRequest",
          decision: {
            behavior: "allow",
            updatedInput: {
              questions: originalQuestions,
              answers
            }
          }
        }
      };
    }
    buildWorkBuddyAnswerDirective(pending, payload) {
      const originalQuestions = getOriginalQuestions(pending) ?? [];
      const structured = getStructuredOriginalQuestions(pending) ?? [];
      const answers = mapStructuredAnswersToClaude(structured, payload);
      return wrapWorkBuddyPermissionDecision(true, undefined, {
        questions: originalQuestions,
        answers
      });
    }
    /**
     * 按 Agent 分发构建"取消 / 退出 AskUserQuestion"的 hook directive。
     *
     * 各 agent 的 question 通道协议不同，没有"通用 cancel 形状"——返回 null 时
     * 外层会兜底为通用 deny，但对端大概率不识别。这里尽量为已知 agent 给出
     * 协议合法的近似 directive，让 plugin/hook 能正常推进。
     */
    buildQuestionCancelDirective(pending, _cancel) {
      switch (pending.tool) {
        case "claude":
          return this.buildClaudeQuestionCancelDirective();
        case "workbuddy":
          return wrapWorkBuddyPermissionDecision(false, _cancel.message ?? "User cancelled");
        case "opencode":
        case "sara":
          return this.buildOpenCodeAnswerDirective(pending, { entries: [] });
        case "copilot-cli":
          return { permissionDecision: "deny", permissionDecisionReason: _cancel.message ?? "User cancelled" };
        default:
          log.warn(
            "[BridgeServer] cancel-question unsupported tool, falling back to generic deny",
            pending.tool
          );
          return null;
      }
    }
    /**
     * Claude Code 的"取消 / 退出 AskUserQuestion" hook directive：deny + 空 message，
     * 与 TUI 内 q.onReject() 无参分支语义一致（遥测点 tengu_ask_user_question_rejected）。
     */
    buildClaudeQuestionCancelDirective() {
      const qRH = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";
      return {
        hookSpecificOutput: {
          hookEventName: "PermissionRequest",
          decision: {
            behavior: "deny",
            message: qRH
          }
        }
      };
    }
    /**
     * Build an OpenCode answer directive. OpenCode's /question/:id/reply endpoint
     * expects `answers: string[][]` —— one entry per question, each a list of
     * selected labels. 缺席的 question 填 ['']（OpenCode plugin 协议要求）。
     *
     * 没有结构化 questions（旧插件兼容路径）时，把所有 entry 的 values 拍平为
     * 一段 free-text answer。
     */
    buildOpenCodeAnswerDirective(pending, payload) {
      const structured = getStructuredOriginalQuestions(pending);
      if (structured && structured.length > 0) {
        return {
          type: "answer",
          answers: mapStructuredAnswersToOpenCode(structured, payload)
        };
      }
      const flat = payload.entries.flatMap(
        (e) => e.values.map((v) => v.kind === "option" ? `option#${v.index}` : v.text)
      ).filter((s) => s.length > 0).join(", ");
      return { type: "answer", text: flat };
    }
    emitEvent(event) {
      this.emit("agentEvent", event);
    }
    sendResponse(clientId, response) {
      const client = this.clients.get(clientId);
      if (!client) {
        if (response.type === "hookDirective") {
          log.warn("[BridgeServer] dropping hook directive for disconnected client", clientId);
        }
        return;
      }
      try {
        client.socket.write(encodeLine({ type: "response", response }));
      } catch (err) {
        if (response.type === "hookDirective") {
          log.warn("[BridgeServer] failed to write hook directive", clientId, err.message);
        }
      }
    }
  }
  return BridgeServer;
}

module.exports = { createBridgeServerClass };
