"use strict";

const ISLAND_PANEL_MAX_HEIGHT_DEFAULT_PX = 540;

const DEFAULT_HOOK_TOGGLES = {
  claude: true,
  codex: true,
  coco: true,
  opencode: true,
  cursor: true,
  zcode: true,
  workbuddy: true,
  codebuddy: true,
  kimi: true,
  hermes: true,
  gemini: true,
  "copilot-cli": true,
  aiden: true,
  sara: true,
  "traex": true,
  // TraeCode's official Hooks require an explicit configuration write and a
  // real event before WorkIsland can claim the connection works.
  trae: false,
  // TraeWork shares TraeCode's hooks.json, but its current desktop runtime
  // executes Hooks in a sandbox. Keep it opt-in until a real event verifies it.
  traework: false,
  // DSH installation changes the active profile, so it must only run after
  // the user clicks “连接”.
  dsh: false
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
  updateChecksEnabled: true,
  lastUpdateCheckAt: 0,
  // Anonymous usage telemetry (PRD-005). On by default since the 2026-08-22
  // owner decision: no startup consent prompt; disclosed in Settings → About
  // with a one-click off that also drops any pending local event queue.
  // Installs that explicitly declined under the old consent flow stay off —
  // see the one-time migration in mergeSettings().
  telemetryEnabled: true,
  // Marker for choices recorded under the old consent flow. An empty value
  // means "never asked", which maps to the default-on policy during the
  // one-time telemetryPolicyVersion migration.
  telemetryConsentNoticeVersion: "",
  // 2 = default-on policy (2026-08-22). Stored once migrated so later manual
  // toggles in Settings persist without being re-migrated on next launch.
  telemetryPolicyVersion: 2,
  displayPreference: "primary",
  sound: {
    enabled: true,
    volume: 50,
    events: { ...DEFAULT_SOUND_EVENTS },
    autoDetectProbing: false
  },
  // 灵动岛落位：notch = 顶部刘海居中（原有形态）；docked = 贴边（上/左/右）。
  islandPlacement: "notch",
  // 贴边状态：edge 为所贴的边，offset 是沿边位置的 0-1 比例（跨分辨率仍成立）。
  islandDock: { edge: "right", offset: 0.25 },
  hoverToOpen: true,
  autoCollapseDelayMs: 4e3,
  hideWhenFullscreen: true,
  // Single user-facing display mode. New installs default to "persistent" so
  // the Island is visibly there right after installation (owner decision
  // 2026-08-22: a silent first run reads as "did it even install?"). Users who
  // find the pill noisy can switch to "minimal", which keeps the top space
  // clear unless something needs attention. The legacy booleans (alwaysHide /
  // hideWhenNoActiveSessions) are one-time migration sources only — see
  // migrateIslandDisplayMode().
  islandDisplayMode: "persistent",
  // Bumps when the display-mode default must migrate existing installations.
  islandDisplayModeVersion: 1,
  autoCollapseOnMouseLeave: true,
  completionPopupDurationSec: 5,
  showUsageQuota: true,
  usageDisplayValue: "used",
  disableClaudeTerminalTitle: true,
  expandOnSessionComplete: true,
  expandOnSessionSubmit: true,
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

// Legacy top-level keys that used to control Island visibility. They are only
// read as one-time migration sources; mergeSettings drops them afterwards so
// runtime code can rely on islandDisplayMode alone.
const LEGACY_ISLAND_DISPLAY_KEYS = ["alwaysHide", "notificationModeVersion", "hideWhenNoActiveSessions"];

function migrateIslandDisplayMode(merged, parsed) {
  // An explicitly persisted mode always wins; only derive from the legacy
  // booleans when the stored settings predate islandDisplayMode.
  if (parsed.islandDisplayMode === "minimal" || parsed.islandDisplayMode === "persistent") {
    merged.islandDisplayMode = parsed.islandDisplayMode;
    return;
  }
  // A stored file with none of the legacy keys is indistinguishable from a
  // fresh install (every legacy build persisted `alwaysHide`), so it follows
  // the current default instead of being force-migrated to "minimal".
  const hasLegacySignals =
    parsed.alwaysHide !== undefined ||
    parsed.notificationModeVersion !== undefined ||
    parsed.hideWhenNoActiveSessions !== undefined;
  if (!hasLegacySignals) {
    merged.islandDisplayMode = DEFAULT_SETTINGS.islandDisplayMode;
    return;
  }
  // `alwaysHide` existed before it was exposed as a user preference and was
  // persisted as false by default. Pre-version installations were forced to
  // the notification-first behavior by the old migration, so they map to
  // "minimal" regardless of the stored boolean — that is not a user choice.
  const legacyNotificationModeSeen =
    Number.isInteger(parsed.notificationModeVersion) && parsed.notificationModeVersion >= 1;
  const alwaysHide = legacyNotificationModeSeen ? parsed.alwaysHide : true;
  const hideWhenNoActiveSessions = parsed.hideWhenNoActiveSessions === true;
  // Explicitly disabling notification mode (alwaysHide=false) without asking
  // to hide when idle means the user chose the persistent pill. Any
  // "hide when idle" combination maps to minimal.
  merged.islandDisplayMode = alwaysHide || hideWhenNoActiveSessions ? "minimal" : "persistent";
}

function mergeSettings(parsed = {}) {
  const merged = { ...createDefaultSettings(), ...parsed };

  migrateIslandDisplayMode(merged, parsed);
  merged.islandDisplayModeVersion = DEFAULT_SETTINGS.islandDisplayModeVersion;
  for (const key of LEGACY_ISLAND_DISPLAY_KEYS) delete merged[key];

  // Settings written by pre-Codex-V2 builds used Orca as the implicit default.
  // Migrate that legacy value, but leave every other explicit custom selection
  // untouched.
  if (!parsed.petSprite || parsed.petSprite === "orca.png") {
    merged.petSprite = DEFAULT_SETTINGS.petSprite;
  }

  // Telemetry policy v2 (2026-08-22 owner decision: default-on, disclosed in
  // Settings). One-time migration: any explicit choice recorded under the old
  // consent flow (a non-empty notice version) keeps its value — this preserves
  // prior opt-outs even if an earlier build used another notice version. Fresh
  // installs and never-asked upgrades move to the default-on policy. Once
  // telemetryPolicyVersion 2 is stored, the saved telemetryEnabled value is
  // authoritative and the Settings toggle persists.
  if (parsed.telemetryPolicyVersion !== 2) {
    const hasLegacyChoice = typeof parsed.telemetryConsentNoticeVersion === "string" && parsed.telemetryConsentNoticeVersion.length > 0;
    merged.telemetryEnabled = hasLegacyChoice
      ? parsed.telemetryEnabled === true
      : DEFAULT_SETTINGS.telemetryEnabled;
  }
  merged.telemetryPolicyVersion = 2;

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
