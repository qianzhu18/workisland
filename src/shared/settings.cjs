"use strict";

const ISLAND_PANEL_MAX_HEIGHT_DEFAULT_PX = 540;

const DEFAULT_HOOK_TOGGLES = {
  claude: true,
  codex: true,
  coco: true,
  trae: true,
  "trae-cn": true,
  opencode: true,
  cursor: true,
  zcode: true,
  workbuddy: true,
  kimi: true,
  hermes: true,
  gemini: true,
  "copilot-cli": true,
  aiden: true,
  sara: true,
  "traex": true
};

const {
  DEFAULT_APPROVAL_MODES,
  normalizeApprovalModes
} = require("./approval-policy.cjs");

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
  sound: {
    enabled: true,
    volume: 50,
    events: { ...DEFAULT_SOUND_EVENTS },
    autoDetectProbing: false
  },
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
  // Ship the Codex V2 千雪 pet as the deterministic first-run default. The
  // legacy Orca sprite remains available as a custom compatibility option.
  petSprite: "codex:qianxue",
  hapticFeedback: true,
  hasCompletedOnboarding: false,
  firstLaunchAt: 0,
  shortcuts: {
    modifiers: [...DEFAULT_SHORTCUTS.modifiers],
    bindings: Object.fromEntries(
      Object.entries(DEFAULT_SHORTCUTS.bindings).map(([id, binding]) => [id, { ...binding }])
    )
  },
  locale: undefined,
  idleAutoCollapseMsecs: 7 * 24 * 60 * 60 * 1e3,
  panelMaxHeightPx: ISLAND_PANEL_MAX_HEIGHT_DEFAULT_PX,
  pillFirstRow: { ...DEFAULT_PILL_FIRST_ROW }
};

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createDefaultSettings() {
  return clone(DEFAULT_SETTINGS);
}

function mergeSettings(parsed = {}) {
  const merged = { ...createDefaultSettings(), ...parsed };

  // Settings written by pre-Codex-V2 builds used Orca as the implicit default.
  // Migrate that legacy value, but leave every other explicit custom selection
  // untouched.
  if (!parsed.petSprite || parsed.petSprite === "orca.png") {
    merged.petSprite = DEFAULT_SETTINGS.petSprite;
  }

  if (parsed.sound) {
    merged.sound = {
      ...DEFAULT_SETTINGS.sound,
      ...parsed.sound,
      events: {
        ...DEFAULT_SETTINGS.sound.events,
        ...(parsed.sound.events && typeof parsed.sound.events === "object" ? parsed.sound.events : {})
      }
    };
  }
  if (parsed.hookToggles) merged.hookToggles = { ...DEFAULT_SETTINGS.hookToggles, ...parsed.hookToggles };
  merged.approvalModes = normalizeApprovalModes(parsed.approvalModes);
  if (parsed.pillFirstRow) merged.pillFirstRow = { ...DEFAULT_SETTINGS.pillFirstRow, ...parsed.pillFirstRow };

  const parsedShortcuts = parsed.shortcuts;
  const modifiers = parsedShortcuts?.modifiers?.length
    ? [...parsedShortcuts.modifiers]
    : [...DEFAULT_SHORTCUTS.modifiers];
  const bindings = {};
  for (const [id, fallback] of Object.entries(DEFAULT_SHORTCUTS.bindings)) {
    const user = parsedShortcuts?.bindings?.[id];
    bindings[id] = user
      ? {
          key: typeof user.key === "string" ? user.key : fallback.key,
          enabled: typeof user.enabled === "boolean" ? user.enabled : fallback.enabled
        }
      : { ...fallback };
  }
  merged.shortcuts = { modifiers, bindings };

  return merged;
}

module.exports = {
  DEFAULT_SETTINGS,
  DEFAULT_SHORTCUTS,
  DEFAULT_HOOK_TOGGLES,
  DEFAULT_APPROVAL_MODES,
  DEFAULT_SOUND_EVENTS,
  DEFAULT_PILL_FIRST_ROW,
  ISLAND_PANEL_MAX_HEIGHT_DEFAULT_PX,
  createDefaultSettings,
  mergeSettings
};
