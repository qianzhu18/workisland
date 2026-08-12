"use strict";
const { i18n } = require("./i18n.cjs");
const electron = require("electron");
const fs = require("fs");
const path = require("path");
const utils = require("@electron-toolkit/utils");
const child_process = require("child_process");
const promises = require("fs/promises");
const log = require("electron-log");
const events = require("events");
const net = require("net");
const crypto = require("crypto");
const os = require("os");
const string_decoder = require("string_decoder");
const crypto$1 = require("node:crypto");
const util = require("util");
const toml = require("@iarna/toml");
const yaml = require("js-yaml");
const url = require("url");
const { createHooksCliCommand } = require("./hooks-cli-command.cjs");
const { APPROVAL_MODE, resolveApprovalMode } = require("../shared/approval-policy.cjs");
const { SettingsRepository } = require("./settings-repository.cjs");
const { PetModeController } = require("./pet-mode-controller.cjs");
const { buildPermissionDirective } = require("./permission-directives.cjs");
const { createNativePlatformService } = require("./native-platform-service.cjs");
const { configureLogTransport, createLogLifecycle } = require("./log-lifecycle.cjs");
const { isAllowedExternalUrl } = require("./external-url-policy.cjs");
const {
  canContinueSessionViaTerminalPrompt,
  isPluginAgentTool,
  isVisibleInIsland,
  requiresAttention,
  shouldAutoDismiss
} = require("./session-policy.cjs");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const os__namespace = /* @__PURE__ */ _interopNamespaceDefault(os);
const toml__namespace = /* @__PURE__ */ _interopNamespaceDefault(toml);
const yaml__namespace = /* @__PURE__ */ _interopNamespaceDefault(yaml);
const { IPC } = require("../shared/ipc.cjs");
const nativePlatform = createNativePlatformService({
  addonPath: electron.app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "resources", "bin", "panel_fix.node")
    : path.join(__dirname, "../../resources/bin/panel_fix.node"),
  logger: log
});
const {
  fixPanel,
  fixPetWindow,
  getAllScreensInfo,
  getFrontmostAppBundleId,
  getFrontmostAppDisplayId,
  getScreenFullscreenState,
  performHapticFeedback,
  setWindowCornerRadius,
  unwatchActiveSpace,
  unwatchFrontmostApp,
  unwatchScreenParameters,
  watchActiveSpace,
  watchFrontmostApp,
  watchScreenParameters
} = nativePlatform;
configureLogTransport(log);
const logLifecycle = createLogLifecycle({ log, fs, path });
logLifecycle.rotate();
const { DEFAULT_HOOK_TOGGLES } = require("../shared/settings.cjs");
let isQuitting = false;
function setQuitting(value) {
  isQuitting = value;
}
const { createWindowClasses } = require("./windows.cjs");
const {
  IslandWindow,
  PetPanelWindow,
  PetWindow,
  SettingsWindow,
  DebugWindow,
  WelcomeWindow
} = createWindowClasses({
  electron,
  path,
  utils,
  IPC,
  fixPanel,
  fixPetWindow,
  setWindowCornerRadius,
  log,
  isVisibleInIsland,
  getIsQuitting: () => isQuitting
});
function throttle(func, wait, options = {}) {
  let leading = true;
  let trailing = true;
  if (typeof func !== "function") {
    throw new TypeError("Expected a function");
  }
  if (options) {
    leading = "leading" in options ? !!options.leading : leading;
    trailing = "trailing" in options ? !!options.trailing : trailing;
  }
  let lastArgs;
  let lastThis;
  let result;
  let timerId;
  let lastCallTime;
  let lastInvokeTime = 0;
  function invokeFunc(time) {
    const args = lastArgs;
    const thisArg = lastThis;
    lastArgs = lastThis = void 0;
    lastInvokeTime = time;
    result = func.apply(thisArg, args);
    return result;
  }
  function leadingEdge(time) {
    lastInvokeTime = time;
    timerId = setTimeout(timerExpired, wait);
    return leading ? invokeFunc(time) : result;
  }
  function remainingWait(time) {
    const timeSinceLastCall = time - lastCallTime;
    const timeSinceLastInvoke = time - lastInvokeTime;
    const timeWaiting = wait - timeSinceLastCall;
    return Math.min(timeWaiting, wait - timeSinceLastInvoke);
  }
  function shouldInvoke(time) {
    const timeSinceLastCall = time - lastCallTime;
    const timeSinceLastInvoke = time - lastInvokeTime;
    return lastCallTime === void 0 || timeSinceLastCall >= wait || timeSinceLastCall < 0 || timeSinceLastInvoke >= wait;
  }
  function timerExpired() {
    const time = Date.now();
    if (shouldInvoke(time)) {
      trailingEdge(time);
      return;
    }
    timerId = setTimeout(timerExpired, remainingWait(time));
  }
  function trailingEdge(time) {
    timerId = void 0;
    if (trailing && lastArgs) {
      return invokeFunc(time);
    }
    lastArgs = lastThis = void 0;
    return result;
  }
  function cancel() {
    if (timerId !== void 0) {
      clearTimeout(timerId);
    }
    lastInvokeTime = 0;
    lastArgs = lastCallTime = lastThis = timerId = void 0;
  }
  function flush() {
    return timerId === void 0 ? result : trailingEdge(Date.now());
  }
  function throttled(...args) {
    const time = Date.now();
    const isInvoking = shouldInvoke(time);
    lastArgs = args;
    lastThis = this;
    lastCallTime = time;
    if (isInvoking) {
      if (timerId === void 0) {
        return leadingEdge(lastCallTime);
      }
      clearTimeout(timerId);
      timerId = setTimeout(timerExpired, wait);
      return invokeFunc(lastCallTime);
    }
    if (timerId === void 0) {
      timerId = setTimeout(timerExpired, wait);
    }
    return result;
  }
  throttled.cancel = cancel;
  throttled.flush = flush;
  return throttled;
}
const {
  encodeLine,
  decodeLines,
  getSocketPath,
  ensureSocketDir,
  cleanupSocket
} = require("./bridge-protocol.cjs");
const { ClaudeAdapter, CodexAdapter, findLastMatchingLineSync } = require("./adapters-cli.cjs");
const {
  CocoAdapter,
  CursorAdapter,
  OpenCodeAdapter,
  SaraAdapter,
  TraeHookAdapter,
  KimiAdapter,
  CopilotCliAdapter
} = require("./adapters-ide.cjs");
const {
  GeminiAdapter,
  HermesAdapter,
  AidenAdapter,
  TraexCliAdapter,
  reportTokenUsage,
  getHermesCumulativeTokens,
  diffHermesCumulativeTokens
} = require("./adapters-extended.cjs");
const { getStatsService } = require("./stats-service.cjs");
const {
  adapterRegistry,
  AGENT_PLUGINS,
  PLUGIN_BY_TOOL,
  listPluginAgentMeta,
  getPluginDefaultHookEnabled,
  PluginAdapter
} = require("./agent-registry.cjs");
const {
  createHookPayloadRecorder,
  readJsonlTailObjects,
  ClaudeTranscriptWatcher,
  isInterruptMarkerLine
} = require("./bridge-support.cjs");
const SOURCE_TO_TERMINAL_APP = {
  cursor: "Cursor",
  trae: "Trae",
  "trae-cn": "Trae CN",
  zcode: "ZCode",
  workbuddy: "WorkBuddy"
};
const GENERIC_VSCODE_APPS = /* @__PURE__ */ new Set([
  "vs code",
  "vscode",
  "visual studio code",
  "code"
]);
function normalizeTerminalAppForHookSource(source, terminalApp) {
  const app = terminalApp?.trim();
  const sourceApp = SOURCE_TO_TERMINAL_APP[source];
  if (!sourceApp) return app || void 0;
  if (!app || GENERIC_VSCODE_APPS.has(app.toLowerCase())) return sourceApp;
  return app;
}
function normalizeAgentPid(pid) {
  if (typeof pid !== "number") return void 0;
  if (!Number.isFinite(pid) || pid <= 1) return void 0;
  return pid;
}
function parseTokenUsagePayload(raw) {
  if (!raw || typeof raw !== "object") return void 0;
  const obj = raw;
  const input = obj.inputTokens ?? obj.input_tokens;
  const output = obj.outputTokens ?? obj.output_tokens;
  const total = obj.totalTokens ?? obj.total_tokens;
  if (typeof input !== "number" || typeof output !== "number" || typeof total !== "number") return void 0;
  if (input === 0 && output === 0) return void 0;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    model: typeof obj.model === "string" ? obj.model : void 0,
    isEstimated: typeof (obj.isEstimated ?? obj.is_estimated) === "boolean" ? obj.isEstimated ?? obj.is_estimated : false,
    cacheReadTokens: typeof (obj.cacheReadTokens ?? obj.cache_read_tokens) === "number" ? obj.cacheReadTokens ?? obj.cache_read_tokens : void 0,
    cacheCreationTokens: typeof (obj.cacheCreationTokens ?? obj.cache_creation_tokens) === "number" ? obj.cacheCreationTokens ?? obj.cache_creation_tokens : void 0
  };
}
function firstStringArrayItem(raw) {
  if (!Array.isArray(raw)) return void 0;
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const value = item.trim();
    if (value) return value;
  }
  return void 0;
}
function normalizeIdeWorkspace(payload, overrides) {
  const overrideWorkspace = overrides.ideWorkspace;
  if (overrideWorkspace && typeof overrideWorkspace === "object") {
    const ws = overrideWorkspace;
    if (typeof ws.path === "string" && ws.path.trim() && typeof ws.source === "string") return ws;
  }
  const pathFromPayload = typeof overrides.ide_workspace_path === "string" ? overrides.ide_workspace_path : typeof payload?.ide_workspace_path === "string" ? payload.ide_workspace_path : void 0;
  const workspacePath = pathFromPayload?.trim();
  if (workspacePath) {
    const definitionFromPayload = typeof overrides.ide_workspace_file_path === "string" ? overrides.ide_workspace_file_path : typeof payload?.ide_workspace_file_path === "string" ? payload.ide_workspace_file_path : void 0;
    const rawKind = typeof overrides.ide_workspace_kind === "string" ? overrides.ide_workspace_kind : typeof payload?.ide_workspace_kind === "string" ? payload.ide_workspace_kind : void 0;
    const kind = rawKind === "folder" || rawKind === "multi-root" ? rawKind : void 0;
    const rawSource = typeof overrides.ide_workspace_source === "string" ? overrides.ide_workspace_source : typeof payload?.ide_workspace_source === "string" ? payload.ide_workspace_source : void 0;
    return {
      path: workspacePath,
      kind,
      id: typeof overrides.ide_workspace_id === "string" ? overrides.ide_workspace_id : typeof payload?.ide_workspace_id === "string" ? payload.ide_workspace_id : void 0,
      source: rawSource ? "vscode-window-resolver" : "legacy-payload",
      definitionFilePath: definitionFromPayload?.trim() || void 0,
      rendererPid: typeof overrides.ide_window_renderer_pid === "number" ? overrides.ide_window_renderer_pid : typeof payload?.ide_window_renderer_pid === "number" ? payload.ide_window_renderer_pid : void 0
    };
  }
  const cursorRoot = firstStringArrayItem(overrides.workspace_roots ?? payload?.workspace_roots);
  if (cursorRoot) {
    return {
      path: cursorRoot,
      kind: "folder",
      source: "cursor-hook"
    };
  }
  return void 0;
}
const { createBridgeServerClass } = require("./bridge-server.cjs");
const BridgeServer = createBridgeServerClass({
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
});
function getOriginalQuestions(pending) {
  const rawInput = pending.questionPayload?.tool_input;
  return rawInput?.questions;
}
function getStructuredOriginalQuestions(pending) {
  const raw = getOriginalQuestions(pending);
  if (!raw) return void 0;
  return raw.map((q) => ({
    question: String(q.question ?? ""),
    options: (q.options ?? []).map((opt) => ({
      label: String(opt?.label ?? "")
    }))
  }));
}
function renderAnswerValue(q, v) {
  switch (v.kind) {
    case "option": {
      const label = q.options[v.index]?.label;
      if (label == null) {
        throw new Error(
          `renderAnswerValue: option index ${v.index} out of range for question "${q.question}"`
        );
      }
      return label;
    }
    case "text":
      return v.text;
  }
}
function renderAnswerValues(q, values) {
  return values.map((v) => renderAnswerValue(q, v));
}
function lookupAnswer(payload, qIdx) {
  return payload.entries.find((e) => e.questionIndex === qIdx)?.values;
}
function mapStructuredAnswersToClaude(qs, payload) {
  const out = {};
  qs.forEach((q, i) => {
    const vs = lookupAnswer(payload, i);
    if (!vs) return;
    out[q.question] = renderAnswerValues(q, vs).join(", ");
  });
  return out;
}
function mapStructuredAnswersToOpenCode(qs, payload) {
  return qs.map((q, i) => {
    const vs = lookupAnswer(payload, i);
    return vs ? renderAnswerValues(q, vs) : [""];
  });
}
function renderAnswerSummary(pending, payload) {
  const questions = getStructuredOriginalQuestions(pending);
  if (!questions || questions.length === 0) {
    return payload.entries.flatMap(
      (e) => e.values.map((v) => v.kind === "option" ? `option#${v.index}` : v.text)
    ).filter((s) => s.length > 0).join(", ");
  }
  return payload.entries.map((e) => {
    const q = questions[e.questionIndex];
    if (!q) return "";
    return renderAnswerValues(q, e.values).join(", ");
  }).filter((s) => s.length > 0).join("; ");
}
const TRANSCRIPT_TAIL_MAX_BYTES = 128 * 1024;
function findLatestCodexInterrupt(transcriptPath, options = {}) {
  const objects = readJsonlTailObjects(transcriptPath, TRANSCRIPT_TAIL_MAX_BYTES);
  if (!objects) return null;
  let latest = null;
  for (const obj of objects) {
    const hit = parseTurnAbortedEvent(obj);
    if (!hit) continue;
    if (options.expectTurnId !== void 0) {
      if (hit.turnId !== options.expectTurnId) continue;
    } else if (options.minTimestampMs !== void 0) {
      if (hit.abortedAtMs < options.minTimestampMs) continue;
    }
    if (latest === null || hit.abortedAtMs > latest.abortedAtMs) {
      latest = hit;
    }
  }
  return latest;
}
function parseTurnAbortedEvent(obj) {
  if (obj.type !== "event_msg") return null;
  const payload = obj.payload;
  if (!payload || typeof payload !== "object") return null;
  if (payload.type !== "turn_aborted") return null;
  if (payload.reason !== "interrupted") return null;
  const tsStr = obj.timestamp;
  let abortedAtMs = NaN;
  if (typeof tsStr === "string") {
    abortedAtMs = Date.parse(tsStr);
  }
  if (!Number.isFinite(abortedAtMs)) {
    abortedAtMs = Date.now();
  }
  const turnId = typeof payload.turn_id === "string" ? payload.turn_id : void 0;
  return { turnId, abortedAtMs };
}
const { createSessionState } = require("./session-state.cjs");
const {
  createInitialState,
  apply,
  getVisibleSessions,
  removeInvisibleSessions,
  getSession,
  removeStaleSessions
} = createSessionState({ isVisibleInIsland });
function getBinaryPath() {
  return electron.app.isPackaged
    ? path.join(electron.app.getAppPath(), "src", "island", "pid-watcher", "index.cjs")
    : path.join(__dirname, "../island/pid-watcher/index.cjs");
}
function watchPid(pid, onExit) {
  const watcher = child_process.spawn(process.execPath, [getBinaryPath(), String(pid)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
  });
  watcher.stdout?.once("data", onExit);
  watcher.on("error", () => {
  });
  return () => {
    watcher.stdout?.removeAllListeners();
    watcher.kill();
  };
}
const {
  saveSessions,
  shellQuote,
  buildDevHooksCliCommand,
  wrapWithInstallCheck,
  isClaudeBitsHookGroup,
  isCodexBitsHookGroup,
  isCursorBitsEntry,
  isKimiBitsEntry,
  OPENCODE_BITS_PLUGIN_FILENAME
} = require("./hook-shared.cjs");
const { ClaudeHookManager, CodexHookManager } = require("./hooks-core.cjs");
const { CocoHookManager, CursorHookManager, TraeHookManager, TraeCnHookManager } = require("./hooks-editors.cjs");
const {
  OpenCodePluginManager,
  SaraPluginManager,
  KimiHookManager,
  GeminiHookManager,
  CopilotCliHookManager
} = require("./hooks-plugins.cjs");
const { HermesHookManager, AidenHookManager, TraexCliHookManager } = require("./hooks-extended.cjs");
const { PluginHookManager } = require("./hooks-custom.cjs");
const { QuotaService } = require("./quota-service.cjs");
const { initSoundDirs, getUserSoundsDir, playSoundEvent, previewSound } = require("./sound-service.cjs");
const { createProcessMonitorClass } = require("./process-monitor.cjs");
const ProcessMonitor = createProcessMonitorClass({ isVisibleInIsland });
const { createTerminalNavigation } = require("./terminal-navigation.cjs");
const {
  getSessionBundleIds,
  jumpToTarget,
  isSessionTabFocused,
  sendTextToTerminal,
  shouldUseToolJumpHandler,
  jumpCursorAgentSession,
  jumpCodexAgentSession,
  jumpClaudeAgentSession,
  jumpOpenCodeAgentSession,
  jumpTraeAgentSession
} = createTerminalNavigation({
  isPluginAgentTool,
  PLUGIN_BY_TOOL
});
function shouldRecordCompletedSessionStat(event) {
  if (event.type !== "sessionCompleted") return false;
  if (event.isInterrupt) return false;
  if (event.isRalphLoopIteration) return false;
  return true;
}
const NOTIFICATION_SUPPRESS_LOG_PATH = path.join(electron.app.getPath("home"), ".flux", "logs", "notification-suppress.log");
const MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024;
const IDLE_INTERRUPT_THRESHOLD_MS = 120 * 1e3;
const CODEX_TRANSCRIPT_SETTLE_GATE_MS = 3 * 1e3;
const CODEX_IDLE_INTERRUPT_THRESHOLD_MS = 180 * 1e3;
function resolveSessionApp(session) {
  if (session.jumpTarget?.app) return session.jumpTarget.app;
  return TOOL_JUMP_HANDLERS[session.tool]?.defaultApp ?? "";
}
function formatInstallError(agentId, err) {
  const targetPath = err.path ?? `~/.${agentId}`;
  switch (err.code) {
    case "EACCES": {
      const suggestDir = targetPath.includes(String(agentId)) ? path.dirname(targetPath) : targetPath;
      const homeDir = electron.app.getPath("home");
      const safeDir = suggestDir === "~" || suggestDir === homeDir ? targetPath : suggestDir;
      return `${i18n.k462278895({ placeholder1: targetPath, placeholder2: safeDir }, "权限不足，无法写入 {placeholder1}。请在终端执行：chmod -R 755 {placeholder2}")}`;
    }
    case "ENOSPC":
      return `${i18n.k105353553({ placeholder1: targetPath }, "磁盘空间不足，无法写入 {placeholder1}。")}`;
    case "EROFS":
    case "EPERM":
      return `${i18n.k2846839386({ placeholder1: targetPath }, "文件系统只读或操作被禁止：{placeholder1}。请检查磁盘权限或 SIP 设置。")}`;
    default:
      return `${i18n.k1793199776({ placeholder1: agentId, placeholder2: err.message }, "安装 {placeholder1} hook 失败：{placeholder2}")}`;
  }
}
const TOOL_JUMP_HANDLERS = {
  cursor: {
    toolName: "cursor",
    defaultApp: "Cursor",
    jump: (t) => jumpCursorAgentSession(t)
  },
  codex: {
    toolName: "codex",
    defaultApp: "Codex",
    jump: (t, session) => jumpCodexAgentSession(t, session.id)
  },
  claude: {
    toolName: "claude",
    defaultApp: "Claude",
    jump: (t) => jumpClaudeAgentSession(t)
  },
  opencode: {
    toolName: "opencode",
    defaultApp: "OpenCode",
    jump: (t) => jumpOpenCodeAgentSession(t)
  },
  trae: {
    toolName: "trae",
    defaultApp: "Trae",
    jump: (t) => jumpTraeAgentSession(t)
  },
  "trae-cn": {
    toolName: "trae-cn",
    defaultApp: "Trae CN",
    jump: (t) => jumpTraeAgentSession(t)
  }
};
const { createAppCoordinatorClass } = require("./app-coordinator.cjs");
const { CodexTranscriptWatcher } = require("./codex-transcript-watcher.cjs");
const { AgentEventDedup } = require("./agent-event-dedup.cjs");
const AppCoordinator = createAppCoordinatorClass({
  BridgeServer,
  CodexTranscriptWatcher,
  AgentEventDedup,
  ProcessMonitor,
  AGENT_PLUGINS,
  adapterAgentIds: new Set(adapterRegistry.keys()),
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
  shouldAutoDismiss,
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
});
const { createIpcServices } = require("./ipc-services.cjs");
const { registerIpcHandlers, getCustomIconDataUrl, applyDockIcon } = createIpcServices({
  performHapticFeedback,
  isAllowedExternalUrl
});
const { createDisplayManagerClass, normalizeDisplayPreference } = require("./display-manager.cjs");
const DisplayManager = createDisplayManagerClass({
  getAllScreensInfo,
  getFrontmostAppDisplayId,
  watchFrontmostApp,
  unwatchFrontmostApp,
  watchScreenParameters,
  unwatchScreenParameters
});
const { ShortcutService } = require("./shortcut-service.cjs");
function disablePageZoomShortcuts(window) {
  window.webContents.setZoomFactor(1);
  window.webContents.on("did-finish-load", () => {
    window.webContents.setZoomFactor(1);
  });
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !input.meta) return;
    const key = input.key.toLowerCase();
    const isZoomKey = key === "+" || key === "=" || key === "-" || input.code === "Equal" || input.code === "Minus" || input.code === "NumpadAdd" || input.code === "NumpadSubtract";
    if (!isZoomKey) return;
    event.preventDefault();
    window.webContents.setZoomFactor(1);
  });
}
function isCommandW(input) {
  if (input.type !== "keyDown" || !input.meta) return false;
  return input.key.toLowerCase() === "w" || input.code === "KeyW";
}
function bindCommandW(window, handler) {
  window.webContents.on("before-input-event", (event, input) => {
    if (!isCommandW(input)) return;
    event.preventDefault();
    handler();
  });
}
const CRASH_SENTINEL_NAME = ".flux-running-sentinel";
function getCrashSentinelPath() {
  return path.join(electron.app.getPath("userData"), CRASH_SENTINEL_NAME);
}
function flushLogSync() {
  try {
    const file = log.transports.file.getFile();
    if (file && typeof file.flush === "function") {
      ;
      file.flush();
    }
  } catch {
  }
}
async function runIslandApp() {
  const { resolveRuntimeMode } = require("./runtime-mode.cjs");
  const runtimeMode = resolveRuntimeMode(process.env);
  const developmentMode = runtimeMode.isDevelopment;
  const developmentUserData = runtimeMode.userDataPath;
  if (developmentMode && developmentUserData) {
    electron.app.setPath("userData", path.resolve(developmentUserData));
  }
  let displayManager = null;
  electron.ipcMain.handle(IPC.SETTINGS_GET_DISPLAYS, () => {
    return displayManager?.getAllTargets().map((t) => t.screenInfo) ?? [];
  });
  log.info("[main] process starting, electron version:", process.versions.electron);
  log.info("[main] pid:", process.pid);
  electron.app.on("window-all-closed", () => {
  });
  await electron.app.whenReady();
  log.info("[main] app.whenReady() fired");
  const sentinelPath = getCrashSentinelPath();
  if (fs.existsSync(sentinelPath)) {
    log.warn("[main] crash sentinel detected — previous process did not exit cleanly");
    const gpuCachePath = path.join(electron.app.getPath("userData"), "GPUCache");
    if (fs.existsSync(gpuCachePath)) {
      try {
        fs.rmSync(gpuCachePath, { recursive: true, force: true });
        log.info("[main] cleared GPUCache to break potential crash loop");
      } catch (e) {
        log.warn("[main] failed to clear GPUCache:", e);
      }
    }
  }
  try {
    fs.writeFileSync(sentinelPath, String(process.pid));
  } catch {
  }
  const coordinator = new AppCoordinator();
  registerIpcHandlers(coordinator);
  if (!coordinator.getSettings().locale) {
    const languages = electron.app.getPreferredSystemLanguages();
    const fallback = languages.find((l) => l.startsWith("en")) ? "en" : "zh";
    coordinator.updateSettings({ locale: fallback });
  }
  const QUIT_WATCHDOG_MS = 1e4;
  let quitWatchdog = null;
  let willQuitFired = false;
  electron.app.on("before-quit", () => {
    setQuitting(true);
    if (quitWatchdog) clearTimeout(quitWatchdog);
    quitWatchdog = setTimeout(() => {
      quitWatchdog = null;
      if (willQuitFired) return;
      const aliveWindows = electron.BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
      if (aliveWindows.length === 0) {
        log.warn("[main] quit watchdog: all windows destroyed, awaiting will-quit");
        return;
      }
      log.warn("[main] quit timed out with windows still alive — treating as cancelled, restoring isQuitting=false");
      setQuitting(false);
    }, QUIT_WATCHDOG_MS);
  });
  electron.app.on("will-quit", () => {
    willQuitFired = true;
    if (quitWatchdog) {
      clearTimeout(quitWatchdog);
      quitWatchdog = null;
    }
    stopLogLifecycle();
    coordinator.stop();
    displayManager?.dispose();
    electron.globalShortcut.unregisterAll();
    try {
      fs.unlinkSync(sentinelPath);
    } catch {
    }
  });
  electron.app.setName("Orca");
  utils.electronApp.setAppUserModelId("app.orca.desktop");
  if (process.platform === "darwin" && electron.app.dock) {
    applyDockIcon(getCustomIconDataUrl());
  }
  const stopLogLifecycle = logLifecycle.start();
  log.info("[local-dev] local runtime initialized");
  electron.ipcMain.handle(IPC.GET_APP_VERSION, () => electron.app.getVersion());
  const initSettings = coordinator.getSettings();
  // "active" was the old persisted spelling for the frontmost-app display
  // mode. Normalize it before constructing DisplayManager so old settings do
  // not enter the pinned-display migration path.
  const initPreference = normalizeDisplayPreference(initSettings.displayPreference);
  let initLabel = initSettings.displayPreferenceLabel;
  if (initPreference !== initSettings.displayPreference) {
    coordinator.updateSettings({ displayPreference: initPreference });
  }
  displayManager = new DisplayManager(initPreference, initLabel);
  displayManager.on("preferenceIdCorrected", (correctedId, correctedLabel) => {
    coordinator.updateSettings({ displayPreference: correctedId, displayPreferenceLabel: correctedLabel });
  });
  electron.app.on("browser-window-created", (_, window) => {
    utils.optimizer.watchWindowShortcuts(window);
    disablePageZoomShortcuts(window);
  });
  const initialTarget = displayManager.getCurrentTarget();
  if (!initialTarget) {
    log.error("[main] DisplayManager returned null target — no displays found?");
  }
  const target = initialTarget ?? {
    display: electron.screen.getPrimaryDisplay(),
    screenInfo: {
      displayId: "0",
      label: "Primary Display",
      hasNotch: false,
      notchHeight: 0,
      notchWidth: 0,
      screenWidth: 1440,
      screenHeight: 900,
      scaleFactor: 2,
      isMain: true,
      menuBarHeight: 0
    }
  };
  let islandWindow;
  let rendererCrashCount = 0;
  const MAX_RENDERER_RETRIES = 2;
  function createIslandWindow() {
    log.info("[main] creating IslandWindow...");
    try {
      const iw = new IslandWindow(target, {
        onBlur: (islandWindow) => {
          const browserWindow = islandWindow.browserWindow;
          if (browserWindow.isDestroyed() || browserWindow.webContents.isDestroyed()) return;
          browserWindow.webContents.send(IPC.ISLAND_WINDOW_BLUR);
        }
      });
      coordinator.setIslandWindow(iw.browserWindow);
      coordinator.setIslandWin(iw);
      coordinator.setDisplayManager(displayManager);
      bindCommandW(iw.browserWindow, () => coordinator.collapseIsland());
      log.info("[main] IslandWindow created OK");
      iw.browserWindow.webContents.on("render-process-gone", (_event, details) => {
        const crashReasons = ["crashed", "oom", "launch-failed", "integrity-failure"];
        if (!crashReasons.includes(details.reason)) {
          log.warn("[main] island render-process-gone (non-crash), reason:", details.reason);
          return;
        }
        rendererCrashCount++;
        log.error(`[main] island render-process-gone (crash #${rendererCrashCount}), reason:`, details.reason);
        if (rendererCrashCount <= MAX_RENDERER_RETRIES) {
          log.info(`[main] attempting renderer recovery (${rendererCrashCount}/${MAX_RENDERER_RETRIES})...`);
          const gpuCachePath = path.join(electron.app.getPath("userData"), "GPUCache");
          try {
            fs.rmSync(gpuCachePath, { recursive: true, force: true });
          } catch {
          }
          const delayMs = details.reason === "launch-failed" ? 500 : 0;
          const doReload = () => {
            try {
              if (!iw.browserWindow.isDestroyed()) {
                iw.browserWindow.webContents.reload();
                log.info("[main] renderer reload triggered");
              }
            } catch (reloadErr) {
              log.error("[main] reload failed, giving up:", reloadErr);
              flushLogSync();
              electron.app.exit(1);
            }
          };
          if (delayMs > 0) {
            log.info(`[main] delaying reload by ${delayMs}ms for launch-failed recovery`);
            setTimeout(doReload, delayMs);
          } else {
            doReload();
          }
        } else {
          log.error("[main] renderer crash limit exceeded, exiting app. details:", details);
          flushLogSync();
          electron.app.exit(1);
        }
      });
      iw.browserWindow.webContents.on("did-finish-load", () => {
        if (rendererCrashCount > 0) {
          log.info(`[main] renderer is stable again; resetting crash count (was ${rendererCrashCount})`);
          rendererCrashCount = 0;
        }
      });
      return iw;
    } catch (e) {
      log.error("[main] IslandWindow creation FAILED:", e);
      return void 0;
    }
  }
  function bindDisplayListener() {
    displayManager.on("displayChanged", (t, reason) => {
      log.info("[main] displayChanged → moving island to:", t.screenInfo.label);
      coordinator.handleDisplayChanged();
      islandWindow?.moveToDisplay(t, { force: !!reason });
    });
  }
  if (!coordinator.getSettings().hasCompletedOnboarding) {
    log.info("[main] first launch — showing WelcomeWindow");
    if (!coordinator.getSettings().firstLaunchAt) {
      coordinator.updateSettings({ firstLaunchAt: Date.now() });
    }
    const welcomeWindow = new WelcomeWindow();
    bindCommandW(welcomeWindow.browserWindow, () => welcomeWindow.close());
    electron.ipcMain.once(IPC.WELCOME_GET_STARTED, () => {
      log.info("[main] WELCOME_GET_STARTED received");
      welcomeWindow.close();
      coordinator.updateSettings({ hasCompletedOnboarding: true });
      islandWindow = createIslandWindow();
      if (!islandWindow) return;
      bindDisplayListener();
      const iw = islandWindow;
      iw.browserWindow.webContents.once("did-finish-load", () => {
        setTimeout(() => {
          iw.send(IPC.ISLAND_ONBOARDING_EXPAND);
        }, 500);
      });
    });
  } else {
    islandWindow = createIslandWindow();
    bindDisplayListener();
  }
  coordinator.setPetWindowFactory((x, y) => {
    const petWindow = new PetWindow(x, y, coordinator.getSettings().petScale);
    bindCommandW(petWindow.browserWindow, () => coordinator.exitPetMode());
    return petWindow;
  });
  electron.ipcMain.on(IPC.ISLAND_DRAG_TO_PET, (_event, payload) => {
    if (!payload || !Number.isFinite(payload.screenX) || !Number.isFinite(payload.screenY)) {
      log.warn("[main] ignored invalid island:drag-to-pet payload", payload);
      return;
    }
    if (coordinator.getPetWindow()) {
      coordinator.exitPetMode();
    } else {
      coordinator.enterPetMode(payload.screenX, payload.screenY);
    }
  });
  electron.ipcMain.on(IPC.PET_DRAG_TO_ISLAND, () => {
    coordinator.tryReturnToIsland();
  });
  electron.ipcMain.on(IPC.PET_RETURN_TO_ISLAND, () => {
    coordinator.exitPetMode();
  });
  electron.ipcMain.on(IPC.PET_TOGGLE, () => {
    if (coordinator.getPetWindow()) {
      coordinator.exitPetMode();
      return;
    }
    const display = displayManager?.getCurrentTarget()?.display ?? electron.screen.getPrimaryDisplay();
    coordinator.enterPetMode(
      display.bounds.x + Math.round(display.bounds.width / 2),
      display.bounds.y + Math.round(display.bounds.height / 2)
    );
  });
  log.info("[main] creating SettingsWindow...");
  try {
    const settingsWindow = new SettingsWindow();
    coordinator.setSettingsWindow(settingsWindow);
    electron.ipcMain.on(IPC.ISLAND_OPEN_SETTINGS, () => {
      settingsWindow.show(displayManager?.getCurrentTarget()?.display.bounds);
    });
    electron.ipcMain.on(IPC.ISLAND_OPEN_ABOUT, () => {
      settingsWindow.show(displayManager?.getCurrentTarget()?.display.bounds);
      setTimeout(() => {
        const win = settingsWindow.browserWindow;
        if (win) {
          win.webContents.send(IPC.SETTINGS_NAVIGATE_TO_TAB, "about");
        }
      }, 300);
    });
    log.info("[main] SettingsWindow created OK");
  } catch (e) {
    log.error("[main] SettingsWindow creation FAILED:", e);
  }
  if (utils.is.dev) {
    const debugWindow = new DebugWindow();
    electron.globalShortcut.register("CommandOrControl+Shift+D", () => {
      debugWindow.show();
    });
    electron.ipcMain.handle(IPC.DEBUG_GET_STATUS, async () => ({
      sessions: coordinator.getSessions(),
      hookReports: await coordinator.getHookStatus()
    }));
    electron.ipcMain.on(IPC.DEBUG_RESET_ONBOARDING, () => {
      coordinator.updateSettings({ hasCompletedOnboarding: false });
    });
  }
  coordinator.start();
  log.info("[local-dev] session bridge, hooks, process monitor, pet, sound, and haptics enabled");
  child_process.execFile("lsof", ["-i", "TCP", "-P", "-n", "-a", "-p", String(process.pid)], {
    timeout: 3e3
  }, (err, stdout) => {
    if (err || !stdout.trim()) {
      log.info("[main] port-diag: no TCP ports occupied by this process");
    } else {
      log.info("[main] port-diag:\n" + stdout.trim());
    }
  });
  const shortcutService = new ShortcutService({
    toggleIsland: () => coordinator.toggleIslandExpand(),
    approve: () => {
      const sid = coordinator.getLatestPendingApprovalSessionId();
      if (sid) coordinator.approveSession(sid, "allowOnce");
    },
    reject: () => {
      const sid = coordinator.getLatestPendingApprovalSessionId();
      if (sid) coordinator.denySession(sid);
    },
    allowAlways: () => {
      const sid = coordinator.getLatestPendingApprovalSessionId();
      if (sid) coordinator.approveSession(sid, "allowAlways");
    },
    jumpToTerminal: () => {
      const sid = coordinator.getLatestJumpCandidateSessionId();
      if (!sid) return;
      coordinator.jumpToSession(sid);
      coordinator.dismissCompletion(sid);
    },
    collapsePanel: () => coordinator.collapseIsland(),
    switchSessionUp: () => {
      coordinator.switchSession("up");
      shortcutService.armConfirm();
    },
    switchSessionDown: () => {
      coordinator.switchSession("down");
      shortcutService.armConfirm();
    },
    confirmSession: () => coordinator.confirmSession()
  });
  shortcutService.setConfig(coordinator.getSettings().shortcuts);
  shortcutService.setOnStatusChange((status) => {
    coordinator.sendToSettings(IPC.SETTINGS_SHORTCUT_STATUS, status);
  });
  electron.ipcMain.handle(IPC.SETTINGS_GET_SHORTCUT_STATUS, () => shortcutService.getStatus());
  coordinator.setOnSettingsChange((settings) => {
    displayManager?.setPreference(settings.displayPreference, settings.displayPreferenceLabel);
    shortcutService.setConfig(settings.shortcuts);
  });
  coordinator.setOnApprovalStateChange((hasPending) => {
    if (hasPending) shortcutService.armApproval();
    else shortcutService.disarmApproval();
  });
  coordinator.setOnJumpStateChange((has) => {
    if (has) shortcutService.armJump();
    else shortcutService.disarmJump();
  });
  let collapseUnregisterTimer = null;
  electron.ipcMain.on(IPC.ISLAND_PANEL_EXPANDED, () => {
    if (collapseUnregisterTimer) {
      clearTimeout(collapseUnregisterTimer);
      collapseUnregisterTimer = null;
    }
    shortcutService.setPanelExpanded(true);
  });
  electron.ipcMain.on(IPC.ISLAND_PANEL_COLLAPSED, () => {
    if (collapseUnregisterTimer) clearTimeout(collapseUnregisterTimer);
    collapseUnregisterTimer = setTimeout(() => {
      shortcutService.setPanelExpanded(false);
      collapseUnregisterTimer = null;
    }, 150);
  });
}
for (const signal of ["SIGINT", "SIGTERM", "SIGUSR1"]) {
  process.on(signal, () => {
    if (!isQuitting) electron.app.quit();
  });
}
runIslandApp();
