let labelMap = {};
let colorMap = {};
async function loadPluginAgentMeta(fetcher) {
  try {
    const list = await fetcher();
    const nextLabels = {};
    const nextColors = {};
    for (const m of list) {
      nextLabels[m.tool] = m.label;
      nextColors[m.tool] = m.badgeColor;
    }
    labelMap = nextLabels;
    colorMap = nextColors;
  } catch {
  }
}
function getPluginColor(tool) {
  return colorMap[tool];
}
function getPluginLabelMap() {
  return labelMap;
}
const AGENT_TOOL_LABELS = {
  claude: "Claude Code",
  codex: "Codex",
  coco: "TRAE CLI",
  trae: "TRAE",
  "trae-cn": "TRAE CN",
  opencode: "OpenCode",
  cursor: "Cursor",
  kimi: "Kimi",
  hermes: "Hermes",
  gemini: "Gemini CLI",
  "copilot-cli": "GitHub Copilot CLI",
  aiden: "Aiden",
  sara: "Sara CLI",
  "traex": "TRAE CLI 2.0"
};
function isPluginAgentTool(tool) {
  return typeof tool === "string" && tool.startsWith("plugin:");
}
function getAgentLabel(tool, pluginLabels) {
  if (isPluginAgentTool(tool)) {
    return pluginLabels?.[tool] ?? tool;
  }
  return AGENT_TOOL_LABELS[tool] ?? tool;
}
const ISLAND_PANEL_MAX_HEIGHT_MIN_PX = 200;
const ISLAND_PANEL_MAX_HEIGHT_MAX_PX = 700;
const ISLAND_PANEL_MAX_HEIGHT_DEFAULT_PX = 540;
function clampPanelMaxHeightPx(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return ISLAND_PANEL_MAX_HEIGHT_DEFAULT_PX;
  }
  return Math.min(
    ISLAND_PANEL_MAX_HEIGHT_MAX_PX,
    Math.max(ISLAND_PANEL_MAX_HEIGHT_MIN_PX, Math.round(value))
  );
}
const DEFAULT_HOOK_TOGGLES = {
  claude: true,
  codex: true,
  coco: true,
  trae: true,
  "trae-cn": true,
  opencode: true,
  cursor: true,
  kimi: true,
  hermes: true,
  gemini: true,
  "copilot-cli": true,
  aiden: true,
  sara: true,
  "traex": true
};
const DEFAULT_APPROVAL_MODES = {
  codex: "bridge",
  coco: "bridge",
  "copilot-cli": "bridge",
  "traex": "bridge"
};
const DEFAULT_SOUND_EVENTS = {
  appLaunch: { enabled: true },
  sessionStart: { enabled: true },
  taskComplete: { enabled: true },
  taskError: { enabled: true },
  approvalNeeded: { enabled: true },
  taskConfirmation: { enabled: false },
  contextLimit: { enabled: true },
  rapidCommit: { enabled: false }
};
const DEFAULT_PILL_FIRST_ROW = {
  claudeSubscription: true,
  codexSubscription: true,
  tokenCount: true,
  soundIcon: true,
  upgradeButton: true
};
const DEFAULT_SHORTCUTS = {
  modifiers: ["Ctrl"],
  bindings: {
    toggleIsland: { key: "I", enabled: true },
    collapsePanel: { key: "Esc", enabled: true },
    approve: { key: "Y", enabled: true },
    reject: { key: "N", enabled: true },
    allowAlways: { key: "A", enabled: true },
    jumpToTerminal: { key: "J", enabled: true },
    switchSession: { key: "", enabled: true }
  }
};
const DEFAULT_SETTINGS = {
  launchAtLogin: false,
  displayPreference: "primary",
  sound: { enabled: true, volume: 50, events: { ...DEFAULT_SOUND_EVENTS }, autoDetectProbing: false },
  hoverToOpen: true,
  autoCollapseDelayMs: 4e3,
  hideWhenFullscreen: true,
  alwaysHide: false,
  hideWhenNoActiveSessions: false,
  autoCollapseOnMouseLeave: true,
  completionPopupDurationSec: 5,
  showUsageQuota: true,
  usageDisplayValue: "used",
  disableClaudeTerminalTitle: true,
  expandOnSessionComplete: true,
  expandOnActionRequired: true,
  suppressNotificationWhenFocused: true,
  updateChecksEnabled: true,
  hookToggles: { ...DEFAULT_HOOK_TOGGLES },
  approvalModes: { ...DEFAULT_APPROVAL_MODES },
  showDebugWindow: false,
  petScale: 1,
  petSprite: "codex:qianxue",
  hapticFeedback: true,
  hasCompletedOnboarding: false,
  firstLaunchAt: 0,
  shortcuts: {
    modifiers: [...DEFAULT_SHORTCUTS.modifiers],
    bindings: {
      toggleIsland: { ...DEFAULT_SHORTCUTS.bindings.toggleIsland },
      collapsePanel: { ...DEFAULT_SHORTCUTS.bindings.collapsePanel },
      approve: { ...DEFAULT_SHORTCUTS.bindings.approve },
      reject: { ...DEFAULT_SHORTCUTS.bindings.reject },
      allowAlways: { ...DEFAULT_SHORTCUTS.bindings.allowAlways },
      jumpToTerminal: { ...DEFAULT_SHORTCUTS.bindings.jumpToTerminal },
      switchSession: { ...DEFAULT_SHORTCUTS.bindings.switchSession }
    }
  },
  locale: void 0,
  idleAutoCollapseMsecs: 7 * 24 * 60 * 60 * 1e3,
  panelMaxHeightPx: ISLAND_PANEL_MAX_HEIGHT_DEFAULT_PX,
  pillFirstRow: { ...DEFAULT_PILL_FIRST_ROW }
};
export {
  AGENT_TOOL_LABELS as A,
  DEFAULT_SETTINGS as D,
  ISLAND_PANEL_MAX_HEIGHT_DEFAULT_PX as I,
  ISLAND_PANEL_MAX_HEIGHT_MAX_PX as a,
  ISLAND_PANEL_MAX_HEIGHT_MIN_PX as b,
  clampPanelMaxHeightPx as c,
  DEFAULT_SHORTCUTS as e,
  getPluginColor as g,
  getAgentLabel as h,
  getPluginLabelMap as i,
  isPluginAgentTool as j,
  loadPluginAgentMeta as l
};
