"use strict";

const electron = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const log = require("electron-log");
const { IPC } = require("../shared/ipc.cjs");
const { i18n } = require("./i18n.cjs");
const { SettingsRepository } = require("./settings-repository.cjs");
const { PetModeController } = require("./pet-mode-controller.cjs");
const { QuotaService } = require("./quota-service.cjs");
const { getStatsService } = require("./stats-service.cjs");
const { UsageService } = require("./usage-service.cjs");
const { getUsagePricing } = require("./usage-pricing.cjs");
const { resolveApprovalMode } = require("../shared/approval-policy.cjs");
const { saveSessions } = require("./hook-shared.cjs");
const { readClaudeTranscriptState } = require("./transcript-recovery.cjs");
const { ClaudeHookManager, CodexHookManager } = require("./hooks-core.cjs");
const { CocoHookManager, CursorHookManager, TraeHookManager } = require("./hooks-editors.cjs");
const { OpenCodePluginManager, SaraPluginManager, KimiHookManager, GeminiHookManager, CopilotCliHookManager } = require("./hooks-plugins.cjs");
const { HermesHookManager, AidenHookManager, TraexCliHookManager } = require("./hooks-extended.cjs");
const { PluginHookManager, DeepSeekHarnessHookManager } = require("./hooks-custom.cjs");
const { ZCodeHookManager, WorkBuddyHookManager, CodeBuddyHookManager } = require("./hooks-work-agents.cjs");
const { initSoundDirs, playSoundEvent } = require("./sound-service.cjs");
const { createAgentSoundDeduplicator, resolveCodexTranscriptSoundEvent } = require("./agent-sound-policy.cjs");
const { reportTokenUsage, getHermesCumulativeTokens, diffHermesCumulativeTokens, collectAndReportTokens } = require("./adapters-extended.cjs");
const { getAgentDescriptor, validateAgentWiring } = require("../shared/agent-catalog.cjs");
const { createPresentationRequest } = require("./presentation-policy.cjs");
const { EVENTS } = require("../shared/telemetry.cjs");
const { MediaService } = require("./media-service.cjs");
const { LyricsService } = require("./lyrics-service.cjs");
const { createAppIconResolver } = require("./app-icon-resolver.cjs");
const { PerformanceService } = require("./performance-service.cjs");
const { ShelfService } = require("./shelf-service.cjs");
const { ClipboardHistoryService } = require("./clipboard-history-service.cjs");
const { TerminalService } = require("./terminal-service.cjs");
const { resolveRecentProjectCwd, resolveTerminalCommand } = require("../shared/terminal-state.cjs");
const { listCodexPets } = require("./codex-pet.cjs");
const { LocalControlAudit } = require("./local-control-audit.cjs");
const { LocalControlService } = require("./local-control-service.cjs");
const { CodexMcpConfigManager } = require("./mcp-client-config.cjs");
const { SettingsChangePresenter } = require("./settings-change-presenter.cjs");

function createElectronClipboardAdapter() {
  return {
    readSnapshot() {
      const image = electron.clipboard.readImage();
      if (image && !image.isEmpty()) {
        const resized = image.resize({ width: Math.min(720, image.getSize().width), quality: "good" });
        return { type: "image", dataUrl: resized.toDataURL() };
      }
      const text = electron.clipboard.readText();
      if (!text) return null;
      let type = "text";
      try {
        const url = new URL(text.trim());
        if (["http:", "https:"].includes(url.protocol)) type = "url";
      } catch {
        if (/\n|[{}();]|\b(const|let|function|class|import|SELECT)\b/.test(text)) type = "code";
      }
      return { type, text };
    },
    writeEntry(entry) {
      if (entry.type === "image") electron.clipboard.writeImage(electron.nativeImage.createFromDataURL(entry.dataUrl));
      else if (typeof entry.text === "string") electron.clipboard.writeText(entry.text);
    }
  };
}

function createAppCoordinatorClass({
  BridgeServer,
  ProcessMonitor,
  CodexTranscriptWatcher,
  AgentEventDedup,
  AGENT_PLUGINS,
  adapterRegistry,
  adapterAgentIds,
  TOOL_JUMP_HANDLERS,
  createInitialState,
  apply,
  getVisibleSessions,
  removeInvisibleSessions,
  removeStaleSessions,
  getSession,
  throttle,
  isPluginAgentTool,
  getPluginDefaultHookEnabled,
  watchPid,
  getFrontmostAppBundleId,
  getScreenFullscreenState,
  watchActiveSpace,
  unwatchActiveSpace,
  requiresAttention,
  canContinueSessionViaTerminalPrompt,
  findLatestCodexInterrupt,
  getSessionBundleIds,
  jumpToTarget,
  isSessionTabFocused,
  sendTextToTerminal,
  shouldUseToolJumpHandler,
  shouldRecordCompletedSessionStat,
  formatInstallError,
  NOTIFICATION_SUPPRESS_LOG_PATH,
  MAX_LOG_SIZE_BYTES,
  IDLE_INTERRUPT_THRESHOLD_MS,
  CODEX_TRANSCRIPT_SETTLE_GATE_MS,
  CODEX_IDLE_INTERRUPT_THRESHOLD_MS
}) {
  class AppCoordinator {
    bridge;
    state;
    hookManagers;
    settings;
    settingsRepository;
    islandWindow = null;
    islandWin = null;
    displayMgr = null;
    settingsWindow = null;
    saveTimer = null;
    quotaService = new QuotaService();
    statsService = getStatsService();
    mediaService;
    lyricsService;
    performanceService;
    shelfService;
    clipboardHistoryService;
    terminalService;
    processMonitor;
    localControlService;
    localControlAudit;
    mcpClientConfig;
    settingsChangePresenter;
    onSettingsChangeCallback = null;
    reconcileTimer = null;
    islandHiddenForFullscreen = false;
    fullscreenOverrideForNotification = false;
    logDirEnsured = false;
    pidWatchers = /* @__PURE__ */ new Map();
    // Hook and transcript channels can report one submitted prompt twice
    // (sessionStarted followed by activityUpdated). Keep the notification
    // edge idempotent within a short window without suppressing a later,
    // identical prompt.
    submissionNotificationBySession = /* @__PURE__ */ new Map();
    // Hook adapters and the Codex transcript watcher can report the same
    // lifecycle transition independently. Audio needs a separate per-session
    // guard because hook adapters request sounds before event dedup runs.
    agentSoundDedup = createAgentSoundDeduplicator();
    /**
     * Codex 会话元数据（transcript_path + 当前 turn_id），由 hookProcessed 事件维护，
     * 供 sweepInterruptedCodexSessions 读 transcript 末尾的 turn_aborted/interrupted 用。
     *
     * 修复对应问题：Codex 中断 turn 时不发 Stop hook，需要 sweep 读 transcript 兜底。
     * 详见 docs/20260426/codex-interrupted-timer-fix-plan.md。
     *
     * 生命周期：
     *   - 写入：hookProcessed 收到 tool === 'codex' 时刷新（UserPromptSubmit/PreToolUse 都会刷新 turn_id）
     *   - 删除：deleteSession / removeInvisibleSessions / removeStaleSessions 删除会话条目时同步清理，避免泄漏
     *
     * `lastScannedSize` 是 sweep 增量优化字段：每次 sweep 实际跑完 readFileTail 后记录
     * 当时的文件大小，下一 tick 若 stat.size 与之相等则跳过 readFileTail —— transcript
     * 没有新写入意味着不可能新增 turn_aborted 行。该缓存仅在 transcriptPath 与
     * latestTurnId 均未变化时可复用；任一变化都需要重新扫描同一 size 下的内容。
     */
    codexSessionMeta = /* @__PURE__ */ new Map();
    /**
     * Codex transcript watcher —— 独立于 hook 的完成检测通道。
     * 主动 tail ~/.codex/sessions/rollout-*.jsonl，让没装 hook 的 Codex 也能被监控。
     * 在 start() 里实例化并接入 bridge.emitEvent 管线。
     */
    codexTranscriptWatcher = null;
    /**
     * Agent 事件去重器。hook 通道与 transcript 通道会同时报告同一 session 的同一事件，
     * 用 5 秒窗口 dedup 让两条通道都跑但只放行第一个。
     */
    agentEventDedup = null;
    // claude 会话的 transcript 路径（来自 hookProcessed），turn 结束时采集 token 用
    claudeTranscriptPaths = new Map();
    /**
     * 记录每个 Hermes session 已经写入 Flux 统计的累计 token 基线。
     *
     * Hermes 离线 collector 从 `~/.hermes/state.db` 读到的是会话累计值，不是单轮增量，
     * 因此需要在主进程里记住“已经入账到 StatsService 的累计总量”，后续只把差值记为新一轮。
     */
    hermesAccountedTokensBySession = /* @__PURE__ */ new Map();
    hasPendingApproval = false;
    hasJumpCandidate = false;
    onApprovalStateChangeCallback = null;
    onJumpStateChangeCallback = null;
    petMode;
    unsubTokenChange = null;
    throttledPushTodayBurn = null;
    // 跨天定时器：本地 0 点触发一次今日 token 燃烧总量推送，让 renderer 把昨日累计清成今日值
    midnightTimer = null;
    onPowerResume = null;
    /**
     * 匿名遥测服务（ADR-0003 / PRD-005）。由入口在构造完成后通过
     * setTelemetryService 注入（与 updateService 同一时序）；所有埋点调用都
     * 经由可选链发出，服务缺席或用户关闭统计时为 no-op。
     */
    telemetry = null;
    constructor() {
      this.settingsRepository = new SettingsRepository(
        path.join(electron.app.getPath("userData"), "settings.json"),
        { onError: (error) => log.error("[SettingsRepository]", error) }
      );
      this.state = createInitialState();
      this.settings = this.settingsRepository.load();
      // PRD-015：保留期可配（settings.statsRetentionDays，默认 90 天）。
      this.statsService.setRetentionDays(this.settings.statsRetentionDays);
      this.usageService = new UsageService({ statsService: this.statsService, pricing: getUsagePricing() });
      const mediaResourceDir = electron.app.isPackaged
        ? path.join(process.resourcesPath, "mediaremote-adapter")
        : path.join(electron.app.getAppPath(), "resources", "mediaremote-adapter");
      const mediaWindowsScriptPath = electron.app.isPackaged
        ? path.join(process.resourcesPath, "scripts", "media-session.ps1")
        : path.join(electron.app.getAppPath(), "resources", "scripts", "media-session.ps1");
      const resolveAppIcon = createAppIconResolver({
        getFileIcon: (appPath) => electron.app.getFileIcon(appPath, { size: "normal" })
      });
      this.mediaService = new MediaService({ resourceDir: mediaResourceDir, windowsScriptPath: mediaWindowsScriptPath, resolveAppIcon });
      this.lyricsService = new LyricsService({ storePath: path.join(electron.app.getPath("userData"), "lyrics-cache.json") });
      this.performanceService = new PerformanceService();
      const userDataPath = electron.app.getPath("userData");
      this.shelfService = new ShelfService({ storePath: path.join(userDataPath, "shelf.json") });
      this.clipboardHistoryService = new ClipboardHistoryService({
        storePath: path.join(userDataPath, "clipboard-history.json"),
        clipboardAdapter: createElectronClipboardAdapter()
      });
      this.terminalService = new TerminalService();
      this.mediaService.setEnabled(this.settings.mediaEnabled !== false);
      this.lyricsService.setEnabled(this.settings.mediaEnabled !== false && this.settings.lyricsEnabled === true);
      this.performanceService.enabled = this.settings.performanceEnabled !== false;
      this.mediaService.on("update", (state) => {
        this.broadcastWorkstationState(IPC.MEDIA_STATE_UPDATE, state);
        void this.lyricsService.setTrack(state);
      });
      this.lyricsService.on("update", (state) => this.broadcastWorkstationState(IPC.LYRICS_STATE_UPDATE, state));
      this.performanceService.on("update", (state) => this.broadcastWorkstationState(IPC.PERFORMANCE_STATE_UPDATE, state));
      this.shelfService.on("update", (state) => this.broadcastWorkstationState(IPC.SHELF_STATE_UPDATE, state));
      this.clipboardHistoryService.on("update", (state) => this.broadcastWorkstationState(IPC.CLIPBOARD_HISTORY_UPDATE, state));
      this.terminalService.on("status", (state) => this.broadcastWorkstationState(IPC.TERMINAL_STATUS_UPDATE, state));
      this.terminalService.on("data", (data) => this.broadcastWorkstationState(IPC.TERMINAL_DATA, data));
      this.petMode = new PetModeController({
        registerReady: (callback) => electron.ipcMain.once(IPC.PET_READY, callback),
        sessionUpdateChannel: IPC.PET_SESSION_UPDATE,
        getSessions: () => getVisibleSessions(this.state),
        onReady: () => this.pushTodayBurnToWindows(),
        onModeChange: (from, to) => {
          log.info(`[AppCoordinator] switching display mode: ${from} -> ${to}`);
        }
      });
      this.localControlAudit = new LocalControlAudit({
        filePath: path.join(userDataPath, "local-agent-control-activity.json")
      });
      this.mcpClientConfig = new CodexMcpConfigManager({
        command: process.execPath,
        serverPath: path.join(electron.app.getAppPath(), "src", "island", "workisland-mcp", "index.mjs")
      });
      this.settingsChangePresenter = new SettingsChangePresenter({
        hasAttention: () => this.getSessions().some((session) => requiresAttention(session.phase)),
        present: (surface) => this.broadcastSurface({ surface, reason: "notification", autoDismiss: true })
      });
      this.localControlService = new LocalControlService({
        getSettings: () => this.getSettings(),
        updateSettings: (partial, source) => this.updateSettings(partial, source),
        getInstalledPetIds: () => this.getInstalledPetIds(),
        getSessions: () => this.getSessions(),
        jumpToSession: (sessionId) => this.jumpToSession(sessionId),
        openSettingsTab: (section) => this.openSettingsTab(section),
        setDisplaySurface: (surface) => this.setDisplaySurface(surface),
        getProductState: () => this.getLocalControlProductState(),
        presentSettingsChange: (notice) => this.settingsChangePresenter.enqueue(notice),
        audit: this.localControlAudit
      });
      initSoundDirs();
      this.bridge = new BridgeServer({
        shouldAcceptHook: (source) => this.shouldAcceptHookSource(source),
        controlService: this.localControlService
      });
      this.hookManagers = /* @__PURE__ */ new Map([
        ["claude", new ClaudeHookManager()],
        ["codex", new CodexHookManager()],
        ["coco", new CocoHookManager()],
        ["trae", new TraeHookManager()],
        ["cursor", new CursorHookManager()],
        ["zcode", new ZCodeHookManager()],
        ["workbuddy", new WorkBuddyHookManager()],
        ["codebuddy", new CodeBuddyHookManager()],
        ["opencode", new OpenCodePluginManager()],
        ["sara", new SaraPluginManager()],
        ["kimi", new KimiHookManager()],
        ["gemini", new GeminiHookManager()],
        ["copilot-cli", new CopilotCliHookManager()],
        ["hermes", new HermesHookManager()],
        ["aiden", new AidenHookManager()],
        ["traex", new TraexCliHookManager()],
        ["dsh", new DeepSeekHarnessHookManager()]
      ]);
      for (const plugin of AGENT_PLUGINS) {
        this.hookManagers.set(`plugin:${plugin.id}`, new PluginHookManager(plugin));
      }
      validateAgentWiring({ managerIds: this.hookManagers.keys(), adapterIds: adapterAgentIds });
      saveSessions([]);
      this.bridge.setSessionTitleProvider((sessionId) => this.state.sessions.get(sessionId)?.title);
      this.bridge.setApprovalModeProvider((tool) => resolveApprovalMode(this.settings, tool));
      this.processMonitor = new ProcessMonitor({
        getSessions: () => Array.from(this.state.sessions.values()),
        updateSession: (id, patch) => {
          const prev = this.state.sessions.get(id);
          if (!prev) return;
          this.state.sessions.set(id, { ...prev, ...patch });
        },
        onChanged: () => {
          this.broadcastSessionUpdate();
          this.scheduleSave();
        }
      });
      this.throttledPushTodayBurn = throttle(
        () => {
          this.pushTodayBurnToWindows();
        },
        1e3,
        { leading: true, trailing: true }
      );
      this.unsubTokenChange = this.statsService.onChange(() => {
        this.throttledPushTodayBurn?.();
      });
      this.scheduleMidnightTick();
      this.onPowerResume = () => {
        log.info("[AppCoordinator] power resume — refresh today burn and reschedule midnight tick");
        this.pushTodayBurnToWindows();
        this.scheduleMidnightTick();
      };
      electron.powerMonitor.on("resume", this.onPowerResume);
    }
    start() {
      this.agentEventDedup = new AgentEventDedup();
      this.bridge.on("agentEvent", (event) => {
        if (!this.isHookToolEnabled(event.tool)) return;
        // hook 通道与 transcript 通道去重：5 秒窗口内同 key 的事件只放行第一个。
        // 让两条通道都跑，但同一逻辑事件只处理一次（避免双重通知/状态抖动）。
        const dedup = this.agentEventDedup.enqueue(event);
        if (dedup.status === "duplicate") {
          log.debug(
            "[AppCoordinator] agentEvent dedup dropped: type=%s session=%s source=%s key=%s",
            event.type,
            event.sessionId,
            event.detectionSource || "hook",
            dedup.key
          );
          return;
        }
        const transcriptSoundEvent = resolveCodexTranscriptSoundEvent(event);
        if (transcriptSoundEvent) {
          this.playAgentSound(transcriptSoundEvent, event.sessionId, event.timestamp);
        }
        log.info(
          "[AppCoordinator] agentEvent: type=%s session=%s tool=%s source=%s",
          event.type,
          event.sessionId,
          event.tool,
          event.detectionSource || "hook"
        );
        // DSH and TraeCode are only considered verified after a configured
        // integration emits a real lifecycle event. Writing config is not E2E proof.
        if (event.tool === "dsh" || event.tool === "trae") {
          const manager = this.hookManagers.get(event.tool);
          void manager?.recordEvent?.(event).catch((error) => {
            log.warn("[AppCoordinator] failed to record Agent verification: %s", error?.message || error);
          });
        }
        // 匿名遥测：激活信号每安装只报一次；会话生命周期在服务内
        // 按本地当前轮次合并 Hook / transcript 的重复报告。sessionId
        // 仅作内存去重键，不会进入遥测队列或上传 payload。
        this.telemetry?.markFirstAgentSignal(event.tool);
        if (event.type === "sessionStarted") {
          this.telemetry?.trackLifecycleEvent?.(EVENTS.SESSION_STARTED, {
            sessionId: event.sessionId,
            tool: event.tool
          });
        }
        const prevSession = event.type === "sessionCompleted" ? getSession(this.state, event.sessionId) : void 0;
        this.state = apply(this.state, event);
        if (event.type === "jumpTargetUpdated" && event.jumpTarget?.tty) {
          const pid = event.jumpTarget.pid;
          if (pid) {
            log.debug("[PidWatcher] jumpTarget.pid tool=%s pid=%d", event.tool, pid);
            const session = getSession(this.state, event.sessionId);
            if (session && !session.isSessionEnded) {
              this.watchSessionPid(event.sessionId, event.tool, pid);
            }
          }
        }
        if (event.type === "sessionCompleted" && (event.tool === "claude" || event.tool === "codex")) {
          // turn 结束采集一次。挂在 sessionCompleted 而不是 hookProcessed：
          // 后者每个 hook 都触发，反复整读大 transcript 太重。
          // codex 的 hook 常常不带 transcript_path（codexSessionMeta 为空），
          // 但 transcript watcher 本来就按 session id 跟踪着 rollout 文件，用它兜底。
          const transcriptPath = event.tool === "claude"
            ? this.claudeTranscriptPaths.get(event.sessionId)
            : this.codexSessionMeta.get(event.sessionId)?.transcriptPath
              ?? this.codexTranscriptWatcher?.getTranscriptPath(event.sessionId);
          if (transcriptPath) {
            collectAndReportTokens(event.tool, event.sessionId, transcriptPath).catch((err) => {
              log.warn("[AppCoordinator] %s token collect failed:", event.tool, err?.message ?? err);
            });
          } else {
            log.info("[TokenCollector] 跳过：%s/%s 无 transcript 路径可用", event.tool, event.sessionId);
          }
        }
        if (shouldRecordCompletedSessionStat(event)) {
          const session = getSession(this.state, event.sessionId);
          if (session) {
            this.statsService.recordSession(event.tool, session.createdAt, event.timestamp, event.sessionId);
          }
          this.telemetry?.trackLifecycleEvent?.(EVENTS.SESSION_COMPLETED, {
            sessionId: event.sessionId,
            tool: event.tool
          });
        }
        this.broadcastSessionUpdate();
        this.maybePresentSurface(event);
        this.scheduleSave();
      });
      this.bridge.on(
        "hookProcessed",
        (info) => {
          const session = info.sessionId ? getSession(this.state, info.sessionId) : void 0;
          if (info.tool === "claude" && info.sessionId && info.transcriptPath) {
            this.claudeTranscriptPaths.set(info.sessionId, info.transcriptPath);
          }
          if (info.tool === "codex" && info.sessionId && info.transcriptPath) {
            const prev = this.codexSessionMeta.get(info.sessionId);
            const latestTurnId = info.turnId ?? prev?.latestTurnId;
            const canReuseLastScannedSize = prev?.transcriptPath === info.transcriptPath && prev.latestTurnId === latestTurnId;
            this.codexSessionMeta.set(info.sessionId, {
              transcriptPath: info.transcriptPath,
              latestTurnId,
              lastScannedSize: canReuseLastScannedSize ? prev?.lastScannedSize : void 0
            });
          }
          if (info.tool === "hermes") {
            this.maybeRecordHermesTokens(info);
          }
        }
      );
      this.bridge.on(
        "tokenUsageReported",
        (info) => {
          log.info(
            "[AppCoordinator] deferred token reporting: tool=%s sid=%s input=%d output=%d",
            info.tool,
            info.sessionId,
            info.tokenUsage.inputTokens,
            info.tokenUsage.outputTokens
          );
          reportTokenUsage(info.tool, info.sessionId, info.tokenUsage);
        }
      );
      this.bridge.setSoundEventHandler((eventId, context) => {
        this.playAgentSound(eventId, context?.sessionId, context?.timestamp);
      });
      this.bridge.start();
      this.quotaService.start();
      this.processMonitor.start();
      this.mediaService.start();
      void this.lyricsService.setTrack(this.mediaService.getSnapshot());
      this.performanceService.start();
      void this.shelfService.start();
      void this.clipboardHistoryService.start().then(() => {
        this.clipboardHistoryService.setPolicy({
          limit: this.settings.clipboardHistoryLimit,
          retentionHours: this.settings.clipboardRetentionHours
        });
        this.clipboardHistoryService.setEnabled(this.settings.clipboardHistoryEnabled === true);
      });
      this.terminalService.setEnabled(this.settings.terminalEnabled !== false);
      this.startCodexTranscriptWatcher();
      // 启动发现：WorkIsland 只靠 hook 被动感知会话，它启动之前就在跑的对话
      // 要等下一个 hook 事件才会现身。主动扫一次正在运行的 claude CLI 进程
      // 与 Cowork 本地会话，合成 sessionStarted 注入现有管线。
      setTimeout(() => {
        try {
          this.scanCoworkSessions();
        } catch (err) {
          log.warn("[AppCoordinator] cowork scan failed:", err?.message ?? err);
        }
        this.discoverRunningClaudeSessions().catch((err) => {
          log.warn("[AppCoordinator] claude session discovery failed:", err?.message ?? err);
        });
      }, 2e3);
      this.startReconciliation();
      this.startFullscreenCheck();
      this.autoReInstallHooks();
      playSoundEvent("appLaunch", this.settings);
    }
    playAgentSound(eventId, sessionId, timestamp) {
      if (!this.agentSoundDedup.shouldPlay(eventId, sessionId, timestamp)) return false;
      return playSoundEvent(eventId, this.settings);
    }
    /**
     * 启动 Codex transcript watcher（独立于 hook 的完成检测通道）。
     *
     * 背景：原本只能靠 Codex Stop hook 检测完成，没装 hook / hook 失效 / Codex
     * 中断不发 Stop 时，灵动岛永远停留在 running。watcher 主动 tail
     * ~/.codex/sessions/rollout-*.jsonl，解析 task_complete/turn_aborted 等事件，
     * 通过 bridge.emitEvent 接入现有 agentEvent 管线。
     *
     * 与 hook 通道的去重由 this.agentEventDedup 处理。
     */
    startCodexTranscriptWatcher() {
      try {
        this.codexTranscriptWatcher = new CodexTranscriptWatcher();
        this.codexTranscriptWatcher.on("event", (event) => {
          // 复用现有 emitEvent 入口，事件会被 start() 里的 agentEvent handler 消费
          this.bridge.emitEvent(event);
        });
        this.codexTranscriptWatcher.on("watcher-error", (err) => {
          log.warn("[AppCoordinator] codex transcript watcher error:", err.message);
        });
        this.codexTranscriptWatcher.start();
        log.info("[AppCoordinator] codex transcript watcher started");
        // 启动回填：codex 可能几小时不完成一轮，若只挂在 sessionCompleted 上，
        // 统计里会长期停在 0。watcher 扫的是 24h 内的 rollout，逐个采集一次；
        // applyBaselineDiff 用累计值差分，重复回填不会重复计数。
        setTimeout(() => {
          const tracked = this.codexTranscriptWatcher?.listTracked() ?? [];
          for (const file of tracked) {
            collectAndReportTokens("codex", file.sessionId, file.path).catch((err) => {
              log.warn("[AppCoordinator] codex token backfill failed:", err?.message ?? err);
            });
          }
          if (tracked.length) log.info("[AppCoordinator] codex token backfill: %d file(s)", tracked.length);
        }, 5e3);
      } catch (err) {
        // watcher 启动失败不应阻断 app 启动；hook 通道仍可工作
        log.warn("[AppCoordinator] codex transcript watcher failed to start:", err.message);
        this.codexTranscriptWatcher = null;
      }
    }
    /**
     * 发现已在运行的 claude CLI 会话（WorkIsland 启动前就开始的那些）。
     *
     * 路线：ps 找 claude 进程 → lsof 拿各自 cwd → 映射到
     * ~/.claude/projects/<转义后 cwd>/ 下最新的 transcript（文件名即 session id）
     * → 读尾部抽出最近一条用户消息 → 合成 sessionStarted 注入 agentEvent 管线。
     *
     * latestUserPrompt 必须带上：isVisibleInIsland 对 hook 管理的 claude 会话
     * 要求它非空，缺了就算注入成功也不会显示。
     * jumpTarget 不合成 —— 它来自 hook 环境（tty/pid），猜出来的会跳错地方；
     * 该会话的下一个 hook 事件会自然补上。
     */
    async discoverRunningClaudeSessions() {
      if (process.platform !== "darwin") return;
      const RECOVERY_LOOKBACK_MS = 24 * 60 * 60 * 1e3;
      const cp = require("child_process");
      const { promisify: pify } = require("util");
      const run = pify(cp.execFile);
      const fs = require("fs");
      const path = require("path");
      const os = require("os");
      let stdout;
      try {
        // comm= 只输出可执行路径、不带参数 —— 不能用 command= 取第一个词：
        // Claude Desktop 内嵌 CLI 的路径含空格（Application Support），
        // 按空白切词会断在 "Application"，basename 永远匹配不上。
        ({ stdout } = await run("/bin/ps", ["-axo", "pid=,comm="], { timeout: 2e3 }));
      } catch {
        return;
      }
      const pids = [];
      for (const line of stdout.split("\n")) {
        const m = line.match(/^\s*(\d+)\s+(.+)$/);
        if (!m) continue;
        const base = m[2].trim().split("/").pop();
        if (base === "claude") pids.push(m[1]);
      }
      if (pids.length === 0) return;
      // lsof 批量拿 cwd：-F pn 输出 pPID / n路径 成对出现
      let cwdOut = "";
      try {
        ({ stdout: cwdOut } = await run(
          "/usr/sbin/lsof",
          ["-a", "-p", pids.join(","), "-d", "cwd", "-Fpn"],
          { timeout: 3e3 }
        ));
      } catch {
        return;
      }
      const cwds = new Map();
      let curPid = null;
      for (const line of cwdOut.split("\n")) {
        if (line.startsWith("p")) curPid = line.slice(1);
        else if (line.startsWith("n") && curPid) cwds.set(curPid, line.slice(1));
      }
      const projectsRoot = path.join(os.homedir(), ".claude", "projects");
      const dirs = new Set(cwds.values());
      let discovered = 0;
      for (const cwd of dirs) {
        const projDir = path.join(projectsRoot, cwd.replace(/[\/.]/g, "-"));
        let files;
        try {
          files = fs.readdirSync(projDir)
            .filter((f) => f.endsWith(".jsonl"))
            .map((f) => ({ f, mtime: fs.statSync(path.join(projDir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
        } catch {
          continue;
        }
        const now = Date.now();
        // 同一工作目录可能有多个并行 Claude 会话，不能只取最新文件。以 transcript
        // 的最后一轮是否有终止记录判定“未完成”，因此长时间无输出的任务也能恢复。
        for (const { f, mtime } of files) {
          if (now - mtime > RECOVERY_LOOKBACK_MS) continue;
          const sessionId = f.slice(0, -6);
          if (this.state.sessions.has(sessionId)) continue;
          const transcriptPath = path.join(projDir, f);
          const transcript = this.readClaudeTranscriptState(transcriptPath);
          if (!transcript.unfinished || !transcript.latestPrompt) continue;
          this.bridge.emitEvent({
            type: "sessionStarted",
            sessionId,
            tool: "claude",
            timestamp: now,
            latestUserPrompt: transcript.latestPrompt,
            title: transcript.latestPrompt.length > 40 ? transcript.latestPrompt.slice(0, 40) + "…" : transcript.latestPrompt,
            detectionSource: "discovery",
            recoveredFromTranscript: true,
            recoveryTranscriptPath: transcriptPath
          });
          discovered++;
        }
      }
      if (discovered > 0) {
        log.info("[AppCoordinator] discovered %d running claude session(s)", discovered);
      }
    }
    /**
     * 发现 Claude Desktop 的 Cowork（本地 Agent 模式）会话。
     *
     * Cowork 跑在 VM 沙箱里：进程在 VM 内（宿主机 ps 看不见）、hook 也没装，
     * 现有两条感知通道全部失明。但宿主机上有完整痕迹：
     *   local-agent-mode-sessions/<org>/<acct>/local_<id>.json   元数据（标题等）
     *   local-agent-mode-sessions/<org>/<acct>/local_<id>/audit.jsonl  transcript 镜像
     * 用 audit 的 mtime 判活（与 claude 发现同一个 3 分钟窗口），周期扫描：
     * 新会话注入 sessionStarted，已知会话用 activityUpdated 续命，
     * 停止写入后由现有 claude 闲置 sweep 自然停表。
     */
    scanCoworkSessions() {
      const fs = require("fs");
      const path = require("path");
      const os = require("os");
      const ACTIVE_WINDOW_MS = 3 * 6e4;
      const root = path.join(
        os.homedir(),
        "Library", "Application Support", "Claude", "local-agent-mode-sessions"
      );
      let orgs;
      try {
        orgs = fs.readdirSync(root);
      } catch {
        return;
      }
      const now = Date.now();
      for (const org of orgs) {
        const orgDir = path.join(root, org);
        let accts;
        try {
          if (!fs.statSync(orgDir).isDirectory()) continue;
          accts = fs.readdirSync(orgDir);
        } catch {
          continue;
        }
        for (const acct of accts) {
          const acctDir = path.join(orgDir, acct);
          let names;
          try {
            if (!fs.statSync(acctDir).isDirectory()) continue;
            names = fs.readdirSync(acctDir);
          } catch {
            continue;
          }
          for (const name of names) {
            if (!name.startsWith("local_") || !name.endsWith(".json")) continue;
            let rec;
            try {
              rec = JSON.parse(fs.readFileSync(path.join(acctDir, name), "utf8"));
            } catch {
              continue;
            }
            if (!rec?.cliSessionId || rec.isArchived) continue;
            const audit = path.join(acctDir, name.slice(0, -5), "audit.jsonl");
            let mtime;
            try {
              mtime = fs.statSync(audit).mtimeMs;
            } catch {
              continue;
            }
            if (now - mtime > ACTIVE_WINDOW_MS) continue;
            const known = this.state.sessions.get(rec.cliSessionId);
            if (known) {
              // 续命：audit 还在写就说明 VM 里还在跑，把 updatedAt 顶上去，
              // 免得被闲置 sweep 提前停表
              if (!known.isSessionEnded && mtime > known.updatedAt + 1e3) {
                this.bridge.emitEvent({
                  type: "activityUpdated",
                  sessionId: rec.cliSessionId,
                  tool: "claude",
                  timestamp: Math.round(mtime),
                  detectionSource: "cowork"
                });
              }
              continue;
            }
            const prompt = this.readLatestUserPrompt(audit)
              ?? (typeof rec.initialMessage === "string" ? rec.initialMessage.trim().slice(0, 200) : null);
            if (!prompt) continue;
            this.bridge.emitEvent({
              type: "sessionStarted",
              sessionId: rec.cliSessionId,
              tool: "claude",
              timestamp: Math.round(mtime),
              latestUserPrompt: prompt,
              title: rec.title || (prompt.length > 40 ? prompt.slice(0, 40) + "…" : prompt),
              detectionSource: "cowork"
            });
            log.info("[AppCoordinator] cowork session discovered: %s (%s)", rec.cliSessionId, rec.title ?? "");
          }
        }
      }
    }
    readLatestUserPrompt(file) {
      return this.readClaudeTranscriptState(file).latestPrompt;
    }
    readClaudeTranscriptState(file) {
      return readClaudeTranscriptState(file);
    }
    async autoReInstallHooks() {
      if (process.argv.some((arg) => arg.startsWith("--smoke-user-data="))) {
        log.info("[AppCoordinator] packaged smoke mode, skipping Hook reconciliation");
        return;
      }
      const toggles = this.settings.hookToggles ?? {};
      for (const [agentId, manager] of this.hookManagers) {
        try {
          const explicit = toggles[agentId];
          const enabled = explicit ?? (isPluginAgentTool(agentId) ? getPluginDefaultHookEnabled(agentId) : true);
          if (!enabled) {
            log.info(`[AppCoordinator] hook for ${agentId} is disabled, skipping auto-reinstall`);
            continue;
          }
          // TraeCode disables its user-approved Hook switch when hooks.json is
          // rewritten. A healthy config must therefore be left untouched.
          if (agentId === "trae") {
            const health = await manager.checkHealth();
            if (health?.installed) {
              log.info("[AppCoordinator] Trae Hook is healthy, preserving user approval");
              continue;
            }
          }
          try {
            // Reconciliation refreshes Hook commands; it must not erase proof
            // from a real Agent event when the same integration is reinstalled.
            await manager.uninstall({ preserveVerification: true });
          } catch {
          }
          const options = { statusLineEnabled: this.resolveClaudeStatusLineEnabled(agentId) };
          log.info(`[AppCoordinator] auto-reinstalling hook for ${agentId}`);
          await manager.install(options);
        } catch (err) {
          const e = err;
          log.error(
            `[AppCoordinator] failed to auto-reinstall hook for ${agentId}: ${e.message} (code=${e.code ?? "n/a"}, path=${e.path ?? "n/a"})`,
            err
          );
        }
      }
    }
    stop() {
      log.info("[AppCoordinator] stopping local services...");
      this.bridge.stop();
      this.quotaService.stop();
      this.processMonitor.stop();
      this.mediaService.stop();
      this.lyricsService.dispose();
      this.performanceService.stop();
      this.clipboardHistoryService.dispose();
      this.terminalService.dispose();
      if (this.codexTranscriptWatcher) {
        this.codexTranscriptWatcher.stop();
        this.codexTranscriptWatcher = null;
      }
      this.statsService.dispose();
      for (const cancel of this.pidWatchers.values()) cancel();
      this.pidWatchers.clear();
      this.stopReconciliation();
      this.stopFullscreenCheck();
      this.persistSessions();
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      this.settingsRepository.dispose();
      this.settingsChangePresenter?.dispose();
      this.petMode.dispose();
      if (this.unsubTokenChange) {
        this.unsubTokenChange();
        this.unsubTokenChange = null;
      }
      if (this.throttledPushTodayBurn) {
        this.throttledPushTodayBurn.cancel();
        this.throttledPushTodayBurn = null;
      }
      if (this.midnightTimer) {
        clearTimeout(this.midnightTimer);
        this.midnightTimer = null;
      }
      if (this.onPowerResume) {
        electron.powerMonitor.off("resume", this.onPowerResume);
        this.onPowerResume = null;
      }
    }
    setIslandWindow(win) {
      this.islandWindow = win;
      this.quotaService.setIslandWindow(win);
      win.webContents.once("did-finish-load", () => {
        this.broadcastSessionUpdate();
        this.broadcastSoundState();
        this.pushTodayBurnToWindows();
        this.broadcastWorkstationState(IPC.MEDIA_STATE_UPDATE, this.mediaService.getSnapshot());
        this.broadcastWorkstationState(IPC.LYRICS_STATE_UPDATE, this.lyricsService.snapshot());
        this.broadcastWorkstationState(IPC.PERFORMANCE_STATE_UPDATE, this.performanceService.getSnapshot());
        this.broadcastWorkstationState(IPC.SHELF_STATE_UPDATE, this.shelfService.snapshot());
        this.broadcastWorkstationState(IPC.CLIPBOARD_HISTORY_UPDATE, this.clipboardHistoryService.snapshot());
        this.broadcastWorkstationState(IPC.TERMINAL_STATUS_UPDATE, this.terminalService.snapshot());
      });
    }
    /**
     * 应用启动时主动推送 SSH 链路 + Auth Provider 当前状态到 island 窗口，
     * 让首行断连指示器能在 did-finish-load 后立即展示正确的 icon。
     */
    setIslandWin(iw) {
      this.islandWin = iw;
      this.petMode.setIslandWindow(iw);
      // `start()` runs before the Island window is created. Re-evaluate here
      // so notification-only mode is applied on the first launch as well.
      this.evaluateFullscreenVisibility();
    }
    setDisplayManager(dm) {
      this.displayMgr = dm;
    }
    setSettingsWindow(win) {
      this.settingsWindow = win;
    }
    /** 注入匿名遥测服务（index.cjs 在构造后调用，时序与 updateService 一致）。 */
    setTelemetryService(service) {
      this.telemetry = service;
    }
    getTelemetryStatus() {
      return this.telemetry?.getStatus?.() ?? {
        enabled: this.settings.telemetryEnabled === true,
        canUpload: false,
        pendingEventCount: 0,
        lastSuccessAt: null,
        status: "unavailable"
      };
    }
    openSettingsWindow() {
      if (this.settingsWindow) {
        const bounds = this.displayMgr?.getCurrentTarget()?.display.bounds;
        this.settingsWindow.show(bounds);
      }
    }
    setPetWindowFactory(factory) {
      this.petMode.setWindowFactory(factory);
    }
    handleDisplayChanged() {
    }
    enterPetMode(screenX, screenY) {
      this.petMode.enter(screenX, screenY);
    }
    tryReturnToIsland() {
      this.petMode.tryReturnToIsland();
    }
    exitPetMode() {
      this.petMode.exit();
    }
    syncIslandHidden() {
      if (!this.islandWin) return;
      this.islandWin.setFullscreenHidden(this.islandHiddenForFullscreen);
    }
    /** Send an arbitrary IPC payload to the settings renderer if the window exists. */
    sendToSettings(channel, payload) {
      const win = this.settingsWindow?.browserWindow;
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    }
    openSettingsTab(tab) {
      if (!this.settingsWindow) return;
      const isFirstTime = !this.settingsWindow.browserWindow;
      const bounds = this.displayMgr?.getCurrentTarget()?.display.bounds;
      this.settingsWindow.show(bounds);
      if (isFirstTime) {
        this.settingsWindow.browserWindow?.webContents.once("did-finish-load", () => {
          this.sendToSettings(IPC.SETTINGS_NAVIGATE_TO_TAB, tab);
        });
      } else {
        this.sendToSettings(IPC.SETTINGS_NAVIGATE_TO_TAB, tab);
      }
    }
    setOnSettingsChange(cb) {
      this.onSettingsChangeCallback = cb;
    }
    setOnApprovalStateChange(cb) {
      this.onApprovalStateChangeCallback = cb;
    }
    setOnJumpStateChange(cb) {
      this.onJumpStateChangeCallback = cb;
    }
    /** Session id of the most recent pending approval, or null. "Most recent" = largest updatedAt. */
    getLatestPendingApprovalSessionId() {
      let latest = null;
      for (const s of this.state.sessions.values()) {
        if (s.phase !== "waitingForApproval") continue;
        if (!latest || s.updatedAt > latest.updatedAt) latest = s;
      }
      return latest?.id ?? null;
    }
    /**
     * Session id of the most recent completed session that has an available jump target
     * and has not been dismissed by the user. Null when there's nothing to jump to.
     */
    getLatestJumpCandidateSessionId() {
      let latest = null;
      for (const s of this.state.sessions.values()) {
        if (s.phase !== "completed") continue;
        if (!s.jumpTarget) continue;
        if (s.completionDismissed) continue;
        if (!latest || s.updatedAt > latest.updatedAt) latest = s;
      }
      return latest?.id ?? null;
    }
    /** Shortcut entry point: tell island renderer to toggle expand/collapse. */
    toggleIslandExpand() {
      if (!this.islandWindow || this.islandWindow.isDestroyed()) return;
      if (this.islandHiddenForFullscreen && this.islandWin) {
        this.islandHiddenForFullscreen = false;
        this.syncIslandHidden();
        this.fullscreenOverrideForNotification = true;
      }
      this.islandWindow.webContents.send(IPC.ISLAND_TOGGLE_EXPAND);
    }
    collapseIsland() {
      if (!this.islandWindow || this.islandWindow.isDestroyed()) return;
      this.islandWindow.webContents.send(IPC.ISLAND_COLLAPSE);
    }
    hideIslandForFocusLoss() {
      if (!this.islandWin) return;
      // 注意：这里刻意不判断 settings.autoCollapseOnMouseLeave。该开关的语义只管
      // "鼠标离开 island 时是否收起"，不应阻断"通知提醒后自动消失"。renderer 在
      // 通知 surface 到期后会显式调用 hideForFocusLoss()，需要主进程真正把窗口
      // 落到透明 hotspot（opacity 0 / height 1px / 转发鼠标），否则只会留下可见的
      // "黑色胶囊"占据屏幕顶部。
      this.islandWin.setFocusHidden(true);
    }
    switchSession(direction) {
      if (!this.islandWindow || this.islandWindow.isDestroyed()) return;
      this.islandWindow.webContents.send(IPC.ISLAND_SWITCH_SESSION, { direction });
    }
    confirmSession() {
      if (!this.islandWindow || this.islandWindow.isDestroyed()) return;
      this.islandWindow.webContents.send(IPC.ISLAND_CONFIRM_SESSION);
    }
    handleSurfaceDismissed() {
      if (!this.fullscreenOverrideForNotification) return;
      this.fullscreenOverrideForNotification = false;
      this.evaluateFullscreenVisibility();
    }
    getSessions() {
      return getVisibleSessions(this.state);
    }
    getPetWindow() {
      return this.petMode.window;
    }
    getSettings() {
      return this.settings;
    }
    getDisplayMode() {
      return this.petMode.isActive ? "pet" : "island";
    }
    getAgentControlStatus() {
      const activity = this.localControlAudit.list();
      return {
        enabled: this.settings.localAgentControlEnabled === true,
        client: this.mcpClientConfig.status(activity),
        activity: activity.slice(-20).reverse()
      };
    }
    connectAgentControlClient(clientId) {
      if (clientId !== "codex") throw Object.assign(new Error("Unsupported MCP client."), { code: "CLIENT_NOT_SUPPORTED" });
      if (this.settings.localAgentControlEnabled !== true) {
        throw Object.assign(new Error("请先开启“允许智能体控制 WorkIsland”。"), { code: "LOCAL_CONTROL_DISABLED" });
      }
      return this.mcpClientConfig.connect();
    }
    disconnectAgentControlClient(clientId) {
      if (clientId !== "codex") throw Object.assign(new Error("Unsupported MCP client."), { code: "CLIENT_NOT_SUPPORTED" });
      return this.mcpClientConfig.disconnect();
    }
    getAgentControlManualConfig(clientId) {
      if (clientId !== "codex") throw Object.assign(new Error("Unsupported MCP client."), { code: "CLIENT_NOT_SUPPORTED" });
      return this.mcpClientConfig.manualConfiguration();
    }
    async undoLocalControlChanges(changeIds) {
      const results = [];
      for (const changeId of [...changeIds].reverse()) {
        results.push(await this.localControlService.undoFromUser(changeId));
      }
      return { undone: true, results };
    }
    collapsePetPanel() {
      this.petMode.collapsePanel();
    }
    getInstalledPetIds() {
      const ids = new Set([
        this.settings.petSprite,
        "codex:qianxue",
        "codex:codex-buddy",
        "echo:little",
        "orca.png"
      ]);
      for (const pet of listCodexPets()) {
        if (typeof pet.value === "string") ids.add(pet.value);
      }
      return ids;
    }
    getLocalControlProductState() {
      return {
        displaySurface: this.getDisplayMode(),
        expanded: false,
        modules: {
          media: this.settings.mediaEnabled !== false,
          performance: this.settings.performanceEnabled !== false,
          shelf: this.settings.fileShelfEnabled !== false,
          terminal: this.settings.terminalEnabled !== false,
          usage: this.settings.showUsageQuota !== false
        }
      };
    }
    setDisplaySurface(surface) {
      if (surface === "island") {
        this.exitPetMode();
        return;
      }
      if (surface !== "pet" || this.petMode.isActive) return;
      const display = this.displayMgr?.getCurrentTarget()?.display ?? electron.screen.getPrimaryDisplay();
      this.enterPetMode(
        display.bounds.x + Math.round(display.bounds.width / 2),
        display.bounds.y + Math.round(display.bounds.height / 2)
      );
    }
    isHookToolEnabled(tool) {
      const explicit = this.settings.hookToggles?.[tool];
      if (explicit !== void 0) return explicit;
      if (isPluginAgentTool(tool)) return getPluginDefaultHookEnabled(tool);
      return true;
    }
    /**
     * 判断某个 hook source 是否允许在当前设置下进入 bridge。
     * 用户关闭对应 agent 开关后，即使旧进程/残留 hook 继续发来事件，
     * 也会被入口直接忽略，保证"立刻静默"的用户感知。
     * Plugin 走 hookToggles[`plugin:<id>`]，未填时取 plugin 声明的 defaultHookEnabled（默认 false）。
     */
    shouldAcceptHookSource(source) {
      return this.isHookToolEnabled(source);
    }
    getSnapTotalTokens(snapshot) {
      return snapshot.totalInputTokens + snapshot.totalOutputTokens + snapshot.totalCacheReadTokens + snapshot.totalCacheCreationTokens;
    }
    updateSettings(partial, source) {
      const prevSoundEnabled = this.settings.sound?.enabled ?? false;
      const prevClaudeSubscriptionEnabled = this.settings.pillFirstRow.claudeSubscription;
      this.settings = { ...this.settings, ...partial };
      this.settingsRepository.scheduleSave(this.settings);
      // 匿名遥测：开关变化必须立即同步给服务（关闭即清空未上报队列）；
      // 其余白名单 key 只上报 key 本身，值永不离开本机。
      if (this.telemetry) {
        if ("telemetryEnabled" in partial) {
          this.telemetry.setEnabled(this.settings.telemetryEnabled === true);
          this.telemetry.trackSettingChange("telemetryEnabled");
        }
        for (const key of Object.keys(partial)) {
          if (key !== "telemetryEnabled") this.telemetry.trackSettingChange(key);
        }
        if (typeof partial.sound?.enabled === "boolean") {
          this.telemetry.trackSettingChange("sound.enabled");
        }
      }
      if ("launchAtLogin" in partial) {
        electron.app.setLoginItemSettings({
          openAtLogin: partial.launchAtLogin,
          type: "mainAppService"
        });
      }
      const newSoundEnabled = this.settings.sound?.enabled ?? false;
      if (prevSoundEnabled !== newSoundEnabled) {
        this.broadcastSoundState();
      }
      if (source !== "settings") {
        this.broadcastSettingsChanged();
      } else {
        this.broadcastSettingsToIsland();
      }
      this.onSettingsChangeCallback?.(this.settings);
      // 桌宠窗口独立于 Island 渲染进程；把设置广播过去，保证切换 Codex
      // pet 后无需关闭/重新打开桌宠即可重新加载 sprite。
      this.petMode.send(IPC.SETTINGS_DID_CHANGE, this.settings);
      if ("autoCollapseOnMouseLeave" in partial && !this.settings.autoCollapseOnMouseLeave) {
        this.islandWin?.setFocusHidden(false);
      }
      if ("hideWhenFullscreen" in partial || "islandDisplayMode" in partial) {
        this.evaluateFullscreenVisibility();
      }
      if ("petScale" in partial) this.petMode.resize(this.settings.petScale);
      if ("mediaEnabled" in partial) {
        this.mediaService.setEnabled(this.settings.mediaEnabled !== false);
        if (this.settings.mediaEnabled !== false) this.mediaService.start();
      }
      if ("mediaEnabled" in partial || "lyricsEnabled" in partial) {
        this.lyricsService.setEnabled(this.settings.mediaEnabled !== false && this.settings.lyricsEnabled === true);
        if (this.settings.mediaEnabled !== false && this.settings.lyricsEnabled === true) {
          void this.lyricsService.setTrack(this.mediaService.getSnapshot());
        }
      }
      if ("performanceEnabled" in partial) this.performanceService.setEnabled(this.settings.performanceEnabled !== false);
      if ("clipboardHistoryEnabled" in partial) this.clipboardHistoryService.setEnabled(this.settings.clipboardHistoryEnabled === true);
      if ("clipboardHistoryLimit" in partial || "clipboardRetentionHours" in partial) {
        this.clipboardHistoryService.setPolicy({
          limit: this.settings.clipboardHistoryLimit,
          retentionHours: this.settings.clipboardRetentionHours
        });
      }
      if ("terminalEnabled" in partial) this.terminalService.setEnabled(this.settings.terminalEnabled !== false);
      if ("approvalModes" in partial) {
        this.autoReInstallHooks();
      }
      const claudeSubscriptionEnabled = this.settings.pillFirstRow.claudeSubscription;
      if (prevClaudeSubscriptionEnabled !== claudeSubscriptionEnabled && (this.settings.hookToggles?.claude ?? true)) {
        void this.installHook("claude");
      }
    }
    async approveSession(sessionId, action) {
      const session = getSession(this.state, sessionId);
      if (!session) return;
      const mode = session.permissionRequest?.approvalMode ?? "bridge";
      if (mode === "terminalNative") {
        log.warn("[AppCoordinator] ignoring bridge approval for external permission", sessionId, mode);
        return;
      }
      const resolution = {
        action,
        message: void 0
      };
      this.telemetry?.track(EVENTS.APPROVAL_HANDLED, { action, tool: session.tool });
      this.bridge.resolvePermission(sessionId, resolution, false);
    }
    async denySession(sessionId) {
      const session = getSession(this.state, sessionId);
      if (!session) return;
      const mode = session.permissionRequest?.approvalMode ?? "bridge";
      if (mode === "terminalNative") {
        log.warn("[AppCoordinator] ignoring bridge deny for external permission", sessionId, mode);
        return;
      }
      this.telemetry?.track(EVENTS.APPROVAL_HANDLED, { action: "deny", tool: session.tool });
      this.bridge.resolvePermission(sessionId, { action: "deny" }, false);
    }
    async answerSession(sessionId, answer) {
      const session = getSession(this.state, sessionId);
      this.telemetry?.track(EVENTS.QUESTION_ANSWERED, { tool: session?.tool ?? "unknown" });
      this.bridge.answerQuestion(sessionId, answer);
    }
    async cancelQuestion(sessionId, cancel) {
      this.bridge.cancelQuestion(sessionId, cancel);
    }
    async confirmPlan(sessionId, choice) {
      log.warn("[AppCoordinator] confirmPlan is unavailable for local hook sessions", sessionId, choice);
    }
    async jumpToSession(sessionId) {
      const session = getSession(this.state, sessionId);
      if (!session) {
        log.warn("[AppCoordinator] jumpToSession: unknown session", sessionId);
        return;
      }
      this.petMode.collapsePanel();
      const handler = TOOL_JUMP_HANDLERS[session.tool];
      if (handler) {
        const t = session.jumpTarget;
        if (shouldUseToolJumpHandler(session.tool, t, handler.toolName)) {
          this.telemetry?.track(EVENTS.JUMP_BACK, { target: handler.toolName, tool: session.tool });
          await handler.jump(t ?? { app: handler.defaultApp }, session);
          return;
        }
      }
      if (!session.jumpTarget) {
        log.warn("[AppCoordinator] jumpToSession: no jumpTarget for session", sessionId, session.tool);
        return;
      }
      this.telemetry?.track(EVENTS.JUMP_BACK, { target: session.jumpTarget.app, tool: session.tool });
      await jumpToTarget(session.jumpTarget);
    }
    /** 通过 Terminal prompt 继续现有会话。 */
    async continueSessionViaTerminalPrompt(sessionId, text, opts) {
      const source = opts?.source ?? "island";
      const session = getSession(this.state, sessionId);
      if (!session) {
        log.warn("[continueSessionViaTerminalPrompt] session not found: %s", sessionId);
        return { ok: false, reason: "missing-target", error: "Session not found" };
      }
      if (!session.jumpTarget) {
        log.warn("[continueSessionViaTerminalPrompt] no jumpTarget: %s", sessionId);
        return { ok: false, reason: "missing-target", error: "No terminal target for session" };
      }
      if (!canContinueSessionViaTerminalPrompt(session)) {
        log.warn(
          "[continueSessionViaTerminalPrompt] unsupported session=%s tool=%s app=%s",
          sessionId,
          session.tool,
          session.jumpTarget.app
        );
        return { ok: false, reason: "unsupported", error: "Session does not support Terminal prompt continuation" };
      }
      log.info("[continueSessionViaTerminalPrompt] continuing session=%s app=%s text=%s", sessionId, session.jumpTarget.app, text);
      const result = await sendTextToTerminal(session.jumpTarget, text);
      if (!result.ok) {
        log.warn("[continueSessionViaTerminalPrompt] failed: reason=%s error=%s", result.reason ?? "unknown", result.error);
      }
      return result;
    }
    watchSessionPid(sessionId, tool, pid) {
      this.pidWatchers.get(sessionId)?.();
      log.debug("[PidWatcher] watching session=%s tool=%s pid=%d", sessionId, tool, pid);
      const cancel = watchPid(pid, () => {
        log.info("[PidWatcher] pid=%d exited, session=%s tool=%s", pid, sessionId, tool);
        this.pidWatchers.delete(sessionId);
        const session = getSession(this.state, sessionId);
        if (!session) return;
        this.state = apply(this.state, {
          type: "sessionCompleted",
          sessionId,
          tool,
          timestamp: Date.now(),
          isSessionEnd: true
        });
        log.info("[PidWatcher] session=%s marked completed (process killed)", sessionId);
        this.broadcastSessionUpdate();
        this.scheduleSave();
      });
      this.pidWatchers.set(sessionId, cancel);
      log.debug("[PidWatcher] registered session=%s pid=%d, total watchers=%d", sessionId, pid, this.pidWatchers.size);
    }
    deleteSession(sessionId) {
      this.deleteSessions([sessionId]);
    }
    deleteSessions(sessionIds) {
      let hasDeleted = false;
      for (const sessionId of sessionIds) {
        const session = this.state.sessions.get(sessionId);
        if (!session) continue;
        hasDeleted = true;
        this.state.sessions.delete(sessionId);
        this.codexSessionMeta.delete(sessionId);
        this.hermesAccountedTokensBySession.delete(sessionId);
      }
      if (!hasDeleted) return;
      this.broadcastSessionUpdate();
      this.persistSessions();
    }
    recordHermesTokenDelta(sessionId, inputTokens, outputTokens, model) {
      if (inputTokens <= 0 && outputTokens <= 0) return;
      log.info("[Hermes Token] recordDelta: sessionId=%s input=%d output=%d model=%s", sessionId, inputTokens, outputTokens, model ?? "unknown");
      reportTokenUsage("hermes", sessionId, {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        model,
        isEstimated: false
      });
      const prev = this.hermesAccountedTokensBySession.get(sessionId) ?? { inputTokens: 0, outputTokens: 0 };
      this.hermesAccountedTokensBySession.set(sessionId, {
        inputTokens: prev.inputTokens + inputTokens,
        outputTokens: prev.outputTokens + outputTokens
      });
      log.info(
        "[Hermes Token] 基线推进: sessionId=%s newBaseline=(%d,%d)",
        sessionId,
        prev.inputTokens + inputTokens,
        prev.outputTokens + outputTokens
      );
    }
    /**
     * 在 Hermes turn 边界尝试写 token 统计。
     *
     * 仅通过 `~/.hermes/state.db` 读取会话累计值，再减去已入账基线，
     * 得到当前应新增的 token 增量。
     */
    maybeRecordHermesTokens(info) {
      if (info.isRemote || !info.sessionId) return;
      if (info.hookEventName !== "post_llm_call" && info.hookEventName !== "on_session_end") return;
      log.info("[Hermes Token] maybeRecord 触发: sessionId=%s hookEvent=%s", info.sessionId, info.hookEventName);
      const cumulative = getHermesCumulativeTokens(info.sessionId);
      if (!cumulative) {
        log.info("[Hermes Token] maybeRecord: 累计快照为空，跳过 sessionId=%s", info.sessionId);
        return;
      }
      const accounted = this.hermesAccountedTokensBySession.get(info.sessionId) ?? { inputTokens: 0, outputTokens: 0 };
      const delta = diffHermesCumulativeTokens(cumulative, accounted);
      if (!delta) {
        log.info("[Hermes Token] maybeRecord: 无增量，跳过 sessionId=%s", info.sessionId);
        return;
      }
      this.recordHermesTokenDelta(info.sessionId, delta.inputTokens, delta.outputTokens, delta.model);
    }
    dismissCompletion(sessionId) {
      const session = this.state.sessions.get(sessionId);
      if (!session) return;
      this.state.sessions.set(sessionId, { ...session, completionDismissed: true });
      this.broadcastSessionUpdate();
      this.persistSessions();
    }
    getClaudeQuota() {
      return this.quotaService.getClaudeQuota();
    }
    getQuotaMap() {
      return this.quotaService.getQuotaMap();
    }
    getStatsSnapshot(timeRange) {
      return this.statsService.getSnapshot(timeRange);
    }
    getUsageSummary(days) {
      return this.usageService.getUsageSummary({ days });
    }
    getSessionInsights(days) {
      return this.usageService.getSessionInsights({ days });
    }
    exportUsageData() {
      return this.usageService.exportUsageData();
    }
    clearUsageData() {
      return this.usageService.clearUsageData();
    }
    getMediaState() { return this.mediaService.getSnapshot(); }
    sendMediaCommand(command) { return this.mediaService.sendCommand(command); }
    getLyricsState() { return this.lyricsService.snapshot(); }
    clearLyricsCache() { return this.lyricsService.clearCache(); }
    getPerformanceState() { return this.performanceService.getSnapshot(); }
    setPerformanceDetailsVisible(visible) { this.performanceService.setDetailsVisible(visible); }
    actOnProcess(request) { return this.performanceService.actOnProcess(request); }
    getShelfState() { return this.shelfService.snapshot(); }
    addShelfPaths(paths) { return this.shelfService.addPaths(paths); }
    addShelfPayload(payload) { return this.shelfService.addPayload(payload); }
    removeShelfItems(ids) { return this.shelfService.remove(ids); }
    clearShelf() { return this.shelfService.clear(); }
    getShelfItem(id) { return this.shelfService.find(id); }
    async openShelfItem(id) {
      const item = this.shelfService.find(id);
      if (!item?.path || !item.available) return false;
      return (await electron.shell.openPath(item.path)) === "";
    }
    revealShelfItem(id) {
      const item = this.shelfService.find(id);
      if (!item?.path || !item.available) return false;
      electron.shell.showItemInFolder(item.path);
      return true;
    }
    async quickLookShelfItem(id) {
      const item = this.shelfService.find(id);
      if (!item?.path || !item.available) return false;
      if (process.platform === "win32") return (await electron.shell.openPath(item.path)) === "";
      require("node:child_process").spawn("/usr/bin/qlmanage", ["-p", item.path], { detached: true, stdio: "ignore" }).unref();
      return true;
    }
    getClipboardHistory() { return this.clipboardHistoryService.snapshot(); }
    replayClipboardEntry(id) { return this.clipboardHistoryService.replay(id); }
    favoriteClipboardEntry(id, favorite) { return this.clipboardHistoryService.favorite(id, favorite); }
    removeClipboardEntries(ids) { return this.clipboardHistoryService.remove(ids); }
    clearClipboardHistory() { return this.clipboardHistoryService.clear(); }
    getTerminalState() { return this.terminalService.snapshot(); }
    getTerminalLaunchOptions(options = {}) {
      return {
        projectCwd: resolveRecentProjectCwd(this.state.sessions.values(), fs.existsSync),
        customCwd: this.settings.terminalCustomDirectory,
        cwdMode: this.settings.terminalDefaultDirectory,
        shell: this.settings.terminalShell,
        ...options
      };
    }
    startTerminal(options = {}) {
      return this.terminalService.start(this.getTerminalLaunchOptions(options));
    }
    sendTerminalInput(data) { return this.terminalService.input(data); }
    resizeTerminal(size) { return this.terminalService.resize(size); }
    restartTerminal(options = {}) { return this.terminalService.restart(this.getTerminalLaunchOptions(options)); }
    stopTerminal() { this.terminalService.stop(); return this.terminalService.snapshot(); }
    runSavedTerminalCommand(id) {
      const command = resolveTerminalCommand(id, this.settings.terminalSavedCommands);
      if (!command) return false;
      this.startTerminal({ cwdMode: command.cwdMode });
      return this.terminalService.input(`${command.command}\r`);
    }
    broadcastWorkstationState(channel, state) {
      if (!this.islandWindow || this.islandWindow.isDestroyed()) return;
      this.islandWindow.webContents.send(channel, state);
    }
    /**
     * 排到下一个本地 0 点触发 push，触发后重新排下一次。
     * 一天才触发一次，绕过 throttle 直接调原方法；+3s 偏移避开 getStartOfDay 的边界毫秒。
     */
    scheduleMidnightTick() {
      if (this.midnightTimer) {
        clearTimeout(this.midnightTimer);
        this.midnightTimer = null;
      }
      const now = /* @__PURE__ */ new Date();
      const next = new Date(now);
      next.setHours(24, 0, 0, 0);
      const delayMs = next.getTime() - now.getTime() + 3e3;
      this.midnightTimer = setTimeout(() => {
        this.midnightTimer = null;
        log.info("[AppCoordinator] midnight tick — refresh today burn");
        this.pushTodayBurnToWindows();
        this.scheduleMidnightTick();
      }, delayMs);
    }
    /** 计算今日 token 燃烧总量并推送到 island 和 pet 窗口 */
    pushTodayBurnToWindows() {
      const snapshot = this.statsService.getSnapshot("today");
      const total = this.getSnapTotalTokens(snapshot);
      if (this.islandWindow && !this.islandWindow.isDestroyed()) {
        this.islandWindow.webContents.send(IPC.ISLAND_TODAY_BURN_UPDATE, total);
      }
      this.petMode.send(IPC.PET_TODAY_BURN_UPDATE, total);
    }
    async getHookStatus() {
      const reports = [];
      for (const [agentId, manager] of this.hookManagers) {
        try {
          const health = await manager.checkHealth();
          const descriptor = getAgentDescriptor(agentId);
          const plugin = isPluginAgentTool(agentId)
            ? AGENT_PLUGINS.find((entry) => `plugin:${entry.id}` === agentId)
            : null;
          reports.push({
            label: descriptor?.label ?? plugin?.label ?? agentId,
            badgeColor: descriptor?.badgeColor ?? plugin?.badgeColor,
            description: descriptor?.description ?? `通过本地插件捕获 ${plugin?.label ?? agentId} 的会话和工具活动。`,
            capabilities: descriptor?.capabilities ?? {
              liveStatus: true,
              toolActivity: true,
              completion: "native",
              approval: plugin?.permissionApprovalMode === "bridge" ? "bridge" : "observe",
              question: "observe",
              jump: "app"
            },
            ...health,
            agentId
          });
        } catch (err) {
          const descriptor = getAgentDescriptor(agentId);
          reports.push({
            agentId,
            label: descriptor?.label ?? agentId,
            badgeColor: descriptor?.badgeColor,
            description: descriptor?.description ?? "本地 Agent 连接器。",
            capabilities: descriptor?.capabilities,
            installed: false,
            issues: [`Health check error: ${err instanceof Error ? err.message : String(err)}`],
            manifestPath: ""
          });
        }
      }
      return reports;
    }
    async installHook(agentId) {
      log.info(`[AppCoordinator] installHook(${agentId}) start`);
      const manager = this.hookManagers.get(agentId);
      if (!manager) return { success: false, error: `${i18n.k2159120351({ placeholder1: agentId }, "未知的 agent: {placeholder1}")}`, errorCode: "NOT_FOUND" };
      const options = { statusLineEnabled: this.resolveClaudeStatusLineEnabled(agentId) };
      try {
        await manager.install(options);
        log.info(`[AppCoordinator] installHook(${agentId}) success`);
        return { success: true };
      } catch (err) {
        const e = err;
        log.error(`[AppCoordinator] installHook(${agentId}) failed: ${e.message}`, err);
        const result = {
          success: false,
          errorCode: e.code ?? "UNKNOWN",
          error: formatInstallError(agentId, e)
        };
        return result;
      }
    }
    async uninstallHook(agentId) {
      const manager = this.hookManagers.get(agentId);
      if (manager) await manager.uninstall();
    }
    // 移除所有已安装的 hook 配置，并将 hookToggles 全部置为 false
    async uninstallAllHooks() {
      const uninstalledAgents = [];
      for (const [agentId, manager] of this.hookManagers) {
        try {
          await manager.uninstall();
          uninstalledAgents.push(agentId);
          log.info(`[AppCoordinator] uninstallAllHooks: uninstalled ${agentId}`);
        } catch (err) {
          log.error(`[AppCoordinator] uninstallAllHooks: failed to uninstall ${agentId}:`, err);
        }
      }
      const hookToggles = { ...this.settings.hookToggles };
      for (const agentId of uninstalledAgents) {
        hookToggles[agentId] = false;
      }
      this.updateSettings({ hookToggles });
      return { uninstalledAgents };
    }
    /** Claude 订阅信息展示开关同时控制 statusLine 采集；其他 Agent 不使用该选项。 */
    resolveClaudeStatusLineEnabled(agentId) {
      if (agentId !== "claude") return void 0;
      return this.settings.pillFirstRow.claudeSubscription;
    }
    toggleSound() {
      const current = this.settings.sound?.enabled ?? false;
      this.updateSettings({ sound: { ...this.settings.sound, enabled: !current } }, "island");
    }
    broadcastSoundState() {
      if (!this.islandWindow || this.islandWindow.isDestroyed()) return;
      this.islandWindow.webContents.send(IPC.ISLAND_SOUND_STATE, this.settings.sound?.enabled ?? false);
    }
    broadcastSettingsChanged() {
      const win = this.settingsWindow?.browserWindow;
      if (win) win.webContents.send(IPC.SETTINGS_DID_CHANGE, this.settings);
      this.broadcastSettingsToIsland();
    }
    broadcastSettingsToIsland() {
      if (!this.islandWindow || this.islandWindow.isDestroyed()) return;
      this.islandWindow.webContents.send(IPC.SETTINGS_DID_CHANGE, this.settings);
    }
    broadcastSessionUpdate() {
      if (!this.islandWindow || this.islandWindow.isDestroyed()) {
        log.error("[AppCoordinator] broadcastSessionUpdate skipped: islandWindow destroyed or null");
        return;
      }
      const sessions = getVisibleSessions(this.state);
      const debugDetails = Array.from(this.state.sessions.values()).map((s) => {
        const isVisible = sessions.some((vis) => vis.id === s.id);
        return `${s.id.slice(0, 8)}(vis=${isVisible}/tool=${s.tool}/phase=${s.phase}/hook=${s.isHookManaged}/ended=${s.isSessionEnded}/prompt=${!!s.latestUserPrompt}/jt=${!!s.jumpTarget})`;
      }).join(", ");
      log.info(
        "[AppCoordinator] broadcastSessionUpdate: total:",
        this.state.sessions.size,
        "visible:",
        sessions.length,
        debugDetails
      );
      this.islandWindow.webContents.send(IPC.ISLAND_SESSION_UPDATE, sessions);
      this.petMode.send(IPC.PET_SESSION_UPDATE, sessions);
      this.detectApprovalEdge();
      this.detectJumpEdge();
    }
    detectApprovalEdge() {
      const hasPending = this.getLatestPendingApprovalSessionId() !== null;
      if (hasPending === this.hasPendingApproval) return;
      this.hasPendingApproval = hasPending;
      this.onApprovalStateChangeCallback?.(hasPending);
    }
    detectJumpEdge() {
      const has = this.getLatestJumpCandidateSessionId() !== null;
      if (has === this.hasJumpCandidate) return;
      this.hasJumpCandidate = has;
      this.onJumpStateChangeCallback?.(has);
    }
    maybePresentSurface(event) {
      const session = this.state.sessions.get(event.sessionId);
      const request = createPresentationRequest({ ...event, error: event.error ?? session?.error }, this.settings);
      if (!request) return;
      if (request.priority === "submission") {
        const prompt = String(event.latestUserPrompt || "").trim();
        const timestamp = Number.isFinite(event.timestamp) ? event.timestamp : Date.now();
        const previous = this.submissionNotificationBySession.get(event.sessionId);
        if (previous && previous.prompt === prompt && Math.abs(timestamp - previous.timestamp) < 10e3) return;
        this.submissionNotificationBySession.set(event.sessionId, { prompt, timestamp });
        if (this.submissionNotificationBySession.size > 256) {
          this.submissionNotificationBySession.delete(this.submissionNotificationBySession.keys().next().value);
        }
      }
      if (request.suppressWhenFocused && this.settings.suppressNotificationWhenFocused) {
        const sessionBundleIds = session ? getSessionBundleIds(session) : [];
        const frontmostBundleId = getFrontmostAppBundleId();
        const appMatches = !!frontmostBundleId && sessionBundleIds.length > 0 && sessionBundleIds.includes(frontmostBundleId);
        let tabCheckResult = "skipped";
        if (appMatches && session?.jumpTarget) {
          tabCheckResult = isSessionTabFocused(session.jumpTarget);
        }
        const shouldSuppress = appMatches && tabCheckResult !== "mismatch";
        this.appendSuppressLog({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          sessionId: event.sessionId,
          tool: event.tool,
          eventType: event.type,
          frontmostBundleId,
          sessionBundleIds,
          jumpTarget: session?.jumpTarget ? {
            app: session.jumpTarget.app,
            tabId: session.jumpTarget.tabId,
            tty: session.jumpTarget.tty,
            tmuxOuterHost: session.jumpTarget.tmuxOuterHost,
            tmuxClientTty: session.jumpTarget.tmuxClientTty
          } : null,
          tabCheckResult,
          shouldSuppress
        });
        if (shouldSuppress) return;
      }
      if (event.type === "sessionCompleted") {
        const hasBlockingSession = Array.from(this.state.sessions.values()).some(
          (s) => s.id !== event.sessionId && requiresAttention(s.phase)
        );
        if (hasBlockingSession) return;
      }
      this.broadcastSurface({
        surface: request.surface,
        reason: "notification",
        autoDismiss: request.autoDismiss
      });
    }
    broadcastSurface(payload) {
      if (this.petMode.isActive) {
        this.petMode.presentSurface(
          payload.surface,
          payload.autoDismiss ? (payload.surface?.autoDismissMs ?? this.settings.completionPopupDurationSec * 1e3) : null
        );
        // A pet is the user's chosen primary surface. Keep the Island passive
        // so one event never creates two competing full-screen interruptions.
        return;
      }
      if (!this.islandWindow || this.islandWindow.isDestroyed()) return;
      if (this.islandHiddenForFullscreen && this.islandWin) {
        this.islandHiddenForFullscreen = false;
        this.syncIslandHidden();
        this.fullscreenOverrideForNotification = true;
      }
      // A background completion can arrive while focus-loss hiding has put the
      // Island into the transparent hotspot. Notifications must restore the
      // surface before asking the renderer to expand it.
      this.islandWin?.setFocusHidden(false);
      this.islandWindow.webContents.send(IPC.ISLAND_PRESENT_SURFACE, payload);
    }
    appendSuppressLog(entry) {
      const line = JSON.stringify(entry) + "\n";
      if (!this.logDirEnsured) {
        try {
          fs.mkdirSync(path.dirname(NOTIFICATION_SUPPRESS_LOG_PATH), { recursive: true });
        } catch {
        }
        this.logDirEnsured = true;
      }
      fs.stat(NOTIFICATION_SUPPRESS_LOG_PATH, (err, stats) => {
        if (!err && stats.size > MAX_LOG_SIZE_BYTES) {
          fs.readFile(NOTIFICATION_SUPPRESS_LOG_PATH, "utf8", (readErr, data) => {
            const lines = (readErr ? "" : data).split("\n").filter(Boolean);
            const kept = lines.slice(-99).join("\n") + "\n" + line;
            fs.writeFile(NOTIFICATION_SUPPRESS_LOG_PATH, kept, "utf8", () => {
            });
          });
        } else {
          fs.appendFile(NOTIFICATION_SUPPRESS_LOG_PATH, line, "utf8", () => {
          });
        }
      });
    }
    scheduleSave() {
      if (this.saveTimer) return;
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.persistSessions();
      }, 5e3);
    }
    startReconciliation() {
      this.reconcileTimer = setInterval(() => {
        const claudeInterruptedChanged = this.sweepInterruptedClaudeSessions();
        const codexTranscriptChanged = this.sweepInterruptedCodexSessions();
        const codexIdleChanged = this.sweepStuckCodexSessions();
        // 主动发现：transcript watcher 已知的 session 但 state 里还没有
        // （说明 hook 没装或没发），合成 sessionStarted 让灵动岛能看到它们。
        const codexDiscoveredChanged = this.discoverUntrackedCodexSessions();
        // Cowork（VM 内会话）既无宿主进程也无 hook，靠周期扫描感知；
        // 事件经 bridge.emitEvent 走标准管线，广播由 agentEvent handler 自理
        try {
          this.scanCoworkSessions();
        } catch (err) {
          log.warn("[AppCoordinator] cowork scan failed:", err?.message ?? err);
        }
        const beforeIds = new Set(this.state.sessions.keys());
        const beforeVisibilityPruneCount = this.state.sessions.size;
        const { state: cleaned } = removeInvisibleSessions(this.state);
        const changed = cleaned.sessions.size !== beforeVisibilityPruneCount;
        this.state = cleaned;
        const beforeStalePruneCount = this.state.sessions.size;
        const { state: pruned, changed: staleChanged } = removeStaleSessions(
          this.state,
          this.settings.idleAutoCollapseMsecs
        );
        this.state = pruned;
        if (staleChanged) {
          log.info(
            "[AppCoordinator] sweep: removed %d idle session(s) over threshold %dms",
            beforeStalePruneCount - pruned.sessions.size,
            this.settings.idleAutoCollapseMsecs
          );
        }
        if (changed || staleChanged) {
          for (const id of beforeIds) {
            if (!this.state.sessions.has(id)) {
              this.codexSessionMeta.delete(id);
              this.hermesAccountedTokensBySession.delete(id);
            }
          }
        }
        if (claudeInterruptedChanged || codexTranscriptChanged || codexIdleChanged || codexDiscoveredChanged || changed || staleChanged) {
          this.broadcastSessionUpdate();
          this.persistSessions();
        }
      }, 2e3);
    }
    /**
     * 主动发现未发 hook 的 Codex session。
     *
     * codex-transcript-watcher 持续 tail ~/.codex/sessions/，它看到的 session
     * 可能从未发过 hook（用户没装 hook / Codex 桌面版）。本方法把 watcher 已知
     * 但 state 里还没有的 session 合成 sessionStarted 事件，让灵动岛能看到它们。
     *
     * 注意：只补 sessionStarted，完成检测仍由 watcher 的 task_complete 事件驱动
     * （走 agentEvent 管线，不在这里处理）。
     */
    discoverUntrackedCodexSessions() {
      if (!this.codexTranscriptWatcher) return false;
      const knownIds = Array.from(this.state.sessions.keys());
      let mutated = false;
      try {
        const events = this.codexTranscriptWatcher.discoverActiveSessions(knownIds);
        for (const event of events) {
          // 走 apply 而非 emitEvent，避免触发 dedup（这是补登记，不是新事件）
          this.state = apply(this.state, event);
          mutated = true;
          log.info(
            "[AppCoordinator] discoverUntrackedCodexSessions: registered session %s from transcript",
            event.sessionId
          );
        }
      } catch (err) {
        log.debug("[AppCoordinator] discoverUntrackedCodexSessions error:", err.message);
      }
      return mutated;
    }
    /**
     * 兜底处理 Claude Code 被用户 ESC 中断的会话。
     *
     * 修复对应问题：Claude Code CLI 在用户按 ESC 中断当前 turn 时不发任何 hook
     * 事件（既无 Stop，也无 PostToolUseFailure），导致 SessionState 永远停留在
     * `phase: 'running'`，SessionRow.tsx 的 useElapsed 永不冻结，耗时累加无止境。
     * 见日志样本：session f3d4717b-... 在 UserPromptSubmit 之后 36+ 分钟内 0 个事件。
     *
     * 触发条件（且关系，命中即视为已被中断）：
     *   1. 工具是 claude（Codex/Coco 走自己的 hook 链路）
     *   2. phase === 'running'（waitingForApproval / waitingForAnswer / completed 都不动）
     *   3. !activeTool（没有工具在跑，避免误判长 Bash / 长 WebFetch）。
     *      注意必须用 activeTool 不能用 currentActivity —— UserPromptSubmit 之后
     *      currentActivity 会被 `activityUpdated` 写成 "Thinking..."，最常见的
     *      "思考中按 ESC" 场景就会被错误地 skip 掉。
     *   4. 距 updatedAt 超过 IDLE_INTERRUPT_THRESHOLD_MS（120s）
     *
     * 触发动作：合成 `sessionCompleted({ isInterrupt: true, isSessionEnd: false })` 走 SessionState.apply()，
     * 让 phase 切到 'completed' → useElapsed 冻结；isInterrupt:true 命中 maybePresentSurface 门控
     * 不弹通知/音效；isSessionEnd:false 让会话保留，下一轮 UserPromptSubmit 经 sessionStarted 自然
     * 重置 createdAt 重新开始计时。
     *
     * 返回值：是否有任何会话被本次 sweep 修改，给调用方决定要不要 broadcast / persist。
     */
    sweepInterruptedClaudeSessions() {
      const now = Date.now();
      let mutated = false;
      for (const session of this.state.sessions.values()) {
        if (session.tool !== "claude") continue;
        if (session.phase !== "running") continue;
        // 启动时从 transcript 恢复的会话没有 hook 的 activeTool；在下一次
        // hook 到来前不能把“暂时无输出”的长任务误判成 ESC 中断。
        if (session.recoveredFromTranscript) continue;
        if (session.activeTool) continue;
        if (now - session.updatedAt < IDLE_INTERRUPT_THRESHOLD_MS) continue;
        log.info(
          "[AppCoordinator] sweep: claude session idle for",
          Math.floor((now - session.updatedAt) / 1e3),
          "s, marking as interrupted, sessionId:",
          session.id
        );
        this.state = apply(this.state, {
          type: "sessionCompleted",
          sessionId: session.id,
          tool: "claude",
          timestamp: now,
          isSessionEnd: false
        });
        mutated = true;
      }
      return mutated;
    }
    /**
     * Codex 会话中断的 transcript 兜底 sweep（首选路径，~5s 内停表）。
     *
     * 修复对应问题：Codex 在用户中断当前 turn 时不发 Stop hook，灵动岛仅靠 hook
     * 链路收不到 sessionCompleted，phase 永远停留在 'running'。可观测的唯一信号
     * 是 transcript 末尾追加 `event_msg/turn_aborted/interrupted` 行。
     * 详见 docs/20260426/codex-interrupted-timer-fix-plan.md。
     *
     * 触发条件（且关系）：
     *   1. tool === 'codex'
     *   2. phase === 'running'
     *   4. !parentSessionId（subagent 走 SubagentStop 路径，本次不处理）
     *   5. codexSessionMeta 中有 transcriptPath（hookProcessed 透出后写入的）
     *   6. settle gate：updatedAt 距今 ≥ 3s，避免 PreToolUse 刚到立即读盘空跑
     *
     * 命中策略（与 docs §3 一致）：
     *   - 优先按 latestTurnId 等价匹配（方案 A，避免时钟漂移）
     *   - latestTurnId 缺失时退化为 timestamp 阈值 `abortedAt >= updatedAt - 1000`（方案 B）
     *
     * 不要求 `!activeTool` —— 与 Claude sweep 反向：Codex 没有 PostToolUse，
     * activeTool 在 PreToolUse 后会一直挂着到下一轮，残留是中断特征而非排除条件。
     */
    sweepInterruptedCodexSessions() {
      const now = Date.now();
      let mutated = false;
      for (const session of this.state.sessions.values()) {
        if (session.tool !== "codex") continue;
        if (session.phase !== "running") continue;
        if (session.parentSessionId) continue;
        const meta = this.codexSessionMeta.get(session.id);
        if (!meta?.transcriptPath) continue;
        if (now - session.updatedAt < CODEX_TRANSCRIPT_SETTLE_GATE_MS) continue;
        let currentSize;
        try {
          currentSize = fs.statSync(meta.transcriptPath).size;
        } catch {
          currentSize = void 0;
        }
        if (currentSize !== void 0 && meta.lastScannedSize === currentSize) continue;
        const hit = findLatestCodexInterrupt(meta.transcriptPath, {
          expectTurnId: meta.latestTurnId,
          // 当 latestTurnId 缺失时，CodexTranscriptReader 回退到该阈值过滤
          minTimestampMs: session.updatedAt - 1e3
        });
        if (currentSize !== void 0) {
          meta.lastScannedSize = currentSize;
        }
        if (!hit) continue;
        log.info(
          "[AppCoordinator] sweep: codex transcript turn_aborted detected, sessionId:",
          session.id,
          "turn_id:",
          hit.turnId,
          "abortedAtMs:",
          hit.abortedAtMs
        );
        this.state = apply(this.state, {
          type: "sessionCompleted",
          sessionId: session.id,
          tool: "codex",
          // 使用 transcript 给出的精确中断时间，让 SessionRow 的 elapsed 冻结到中断那一刻
          timestamp: hit.abortedAtMs,
          isSessionEnd: false
        });
        mutated = true;
      }
      return mutated;
    }
    /**
     * Codex 时间兜底 sweep —— transcript 不可用时的 fail-safe。
     *
     * 修复对应问题：transcript 路径缺失 / 文件被删 / 权限异常 / 磁盘故障等场景下，
     * sweepInterruptedCodexSessions 永远命中不了 turn_aborted，会话会一直 running。
     * 该兜底确保最坏情况下也能在 180s 内停表。
     *
     * 触发条件（且关系，与 transcript sweep 互补）：
     *   1. tool === 'codex'
     *   2. phase === 'running'
     *   3. !isRemote
     *   4. !parentSessionId
     *   5. activeTool **存在**（与 Claude sweep 反向）—— Codex 没有 PostToolUse，
     *      activeTool 残留 + 长时间不更新是中断的强特征；正常 Stop 会经 SessionState
     *      把 activeTool 清空。
     *   6. 距 updatedAt 超过 CODEX_IDLE_INTERRUPT_THRESHOLD_MS（180s）
     *
     * 命中后用 `Date.now()` 作 timestamp（没有更精确的中断时间）。
     *
     * 与 transcript sweep 互不冲突：transcript sweep 命中先把 phase 推到 'completed'，
     * 时间兜底会因 `phase !== 'running'` 检查直接跳过。
     */
    sweepStuckCodexSessions() {
      const now = Date.now();
      let mutated = false;
      for (const session of this.state.sessions.values()) {
        if (session.tool !== "codex") continue;
        if (session.phase !== "running") continue;
        if (session.parentSessionId) continue;
        if (!session.activeTool) continue;
        if (now - session.updatedAt < CODEX_IDLE_INTERRUPT_THRESHOLD_MS) continue;
        log.info(
          "[AppCoordinator] sweep: codex session stuck for",
          Math.floor((now - session.updatedAt) / 1e3),
          "s (activeTool present, transcript unavailable), marking as interrupted, sessionId:",
          session.id
        );
        this.state = apply(this.state, {
          type: "sessionCompleted",
          sessionId: session.id,
          tool: "codex",
          timestamp: now,
          isSessionEnd: false
        });
        mutated = true;
      }
      return mutated;
    }
    stopReconciliation() {
      if (this.reconcileTimer) {
        clearInterval(this.reconcileTimer);
        this.reconcileTimer = null;
      }
    }
    persistSessions() {
      saveSessions(Array.from(this.state.sessions.values()));
    }
    // ── Fullscreen visibility check ─────────────────────────────────────────
    // On non-notch screens, hide the island when a fullscreen app is active
    // and the menu bar is hidden. Event-driven via NSWorkspaceActiveSpaceDidChangeNotification.
    startFullscreenCheck() {
      watchActiveSpace(() => {
        this.evaluateFullscreenVisibility();
      });
      this.evaluateFullscreenVisibility();
    }
    stopFullscreenCheck() {
      unwatchActiveSpace();
    }
    evaluateFullscreenVisibility() {
      if (!this.islandWin) return;
      const shouldHide = this.computeShouldConceal();
      if (shouldHide && this.fullscreenOverrideForNotification) return;
      if (shouldHide !== this.islandHiddenForFullscreen) {
        this.islandHiddenForFullscreen = shouldHide;
        this.syncIslandHidden();
      }
    }
    /**
     * 计算灵动岛是否应当收敛为 1px hotspot 形态。
     * 两条独立触发路径，任一为真即隐藏：
     *   1. islandDisplayMode === "minimal"：用户选择极简模式，空闲时不占用可见顶部空间。
     *   2. hideWhenFullscreen：仅在无刘海屏幕、有全屏应用且菜单栏隐藏时触发。
     * 隐藏后由 fullscreenOverrideForNotification 配合 broadcastSurface/toggleIslandExpand 临时显现，
     * surfaceDismissed 后再次 evaluate 回到隐藏。
     */
    computeShouldConceal() {
      if (this.settings.islandDisplayMode === "minimal") return true;
      if (!this.settings.hideWhenFullscreen) return false;
      const target = this.displayMgr?.getCurrentTarget();
      if (!target) return false;
      if (target.screenInfo.hasNotch) return false;
      const fsState = getScreenFullscreenState(target.display.id);
      return fsState.hasFullscreenApp && !fsState.menuBarVisible;
    }
  }
  return AppCoordinator;
}

module.exports = { createAppCoordinatorClass };
