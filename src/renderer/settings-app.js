"use strict";

import { getLanguagePreference, getLocale, initializeI18n, onLocaleChange, setLanguagePreference, t } from "./shared/i18n.js";
import { localizedRuntimeText } from "./shared/localized-runtime-text.mjs";
import {
  appearanceForMaterial,
  materialForAppearance,
  withAppearanceColor,
  withAppearanceOpacity
} from "./shared/appearance-settings-model.mjs";
import { coverCrop } from "./shared/background-crop.mjs";

const api = window.settingsApi;

const DEFAULT_PET_SPRITE = "codex:qianxue";
const FEEDBACK_URL = "https://workisland.yanglaishe.cn/#feedback";
const COMMUNITY_URL = "https://workisland.yanglaishe.cn/#community";
const USER_GUIDE_URL = "https://workisland.yanglaishe.cn/guide/";
const GITHUB_ISSUE_NEW_URL = "https://github.com/qianzhu18/workisland/issues/new";
const GITHUB_ISSUE_TEMPLATE = "bug_report.yml";
const COMPLAINT_BODY_LIMIT = 1500;
const WORKISLAND_ICON_URL = "../assets/workisland-icon.png";
const DEFAULT_AGENT_ICON_URL = "../assets/brands/agent.svg";
const AGENT_STATUS_REFRESH_INTERVAL_MS = 3000;
const AGENT_ICON_URLS = Object.freeze({
  claude: "../assets/brands/claude.svg",
  codex: "../assets/brands/codex.png",
  coco: "../assets/brands/trae.svg",
  cursor: "../assets/brands/cursor.svg",
  trae: "../assets/brands/trae.svg",
  zcode: "../assets/brands/zcode.svg",
  workbuddy: "../assets/brands/codebuddy.svg",
  codebuddy: "../assets/brands/codebuddy.svg",
  qoder: "../assets/brands/qoder.svg",
  dumate: "../assets/brands/dumate.png",
  opencode: "../assets/brands/opencode.svg",
  sara: "../assets/brands/sara.svg",
  kimi: "../assets/brands/kimi.svg",
  gemini: "../assets/brands/gemini.svg",
  "copilot-cli": "../assets/brands/copilot.svg",
  hermes: "../assets/brands/hermes.svg",
  aiden: "../assets/brands/agent.svg",
  dsh: "../assets/brands/agent.svg",
  traex: "../assets/brands/trae.svg",
  "plugin:omp": "../assets/brands/pi.svg",
  "plugin:pi": "../assets/brands/pi.svg"
});
const VERIFY_ON_REAL_EVENT_AGENT_IDS = new Set(["dsh", "trae", "qoder", "dumate"]);
const state = { settings: null, statuses: new Map(), doctorSummary: null, displays: [], codexPets: [], templates: { active: null, templates: [] }, shareProviders: [], activeTab: "general", busy: new Set(), expandedSettingDetails: new Set(), latestUpdate: null, updateState: null, onUpdateStateUi: null, telemetryStatus: null, agentControl: null, agentControlManual: null, commandDraft: { name: "", command: "" }, remoteHosts: null, remotePairing: null, remoteSshConfig: null, remoteFilter: "", remoteManualOpen: false, remoteInvites: {}, appearanceImagePreview: null, appearanceImagePreviewRef: "", appearanceError: "" };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function row(title, description, control) {
  const node = el("div", "setting-row");
  const copy = el("div", "setting-copy");
  copy.append(el("div", "setting-title", title));
  if (description) copy.append(el("div", "setting-description", description));
  node.append(copy, control);
  return node;
}

function featureSettingsRow(id, title, description, control, detailsBuilder) {
  const expanded = Boolean(detailsBuilder) && state.expandedSettingDetails.has(id);
  const card = el("div", `feature-settings-card${expanded ? " is-expanded" : ""}`);
  const actions = el("div", "feature-settings-actions");
  const detailId = `feature-settings-${id}`;
  actions.append(control);
  if (detailsBuilder) {
    const disclosure = button(expanded ? t("common.collapse") : t("settings.common.details"), () => {
      if (expanded) state.expandedSettingDetails.delete(id);
      else state.expandedSettingDetails.add(id);
      renderPage();
    });
    disclosure.classList.add("feature-settings-disclosure");
    disclosure.setAttribute("aria-expanded", String(expanded));
    disclosure.setAttribute("aria-controls", detailId);
    disclosure.setAttribute("aria-label", t(expanded ? "settings.common.collapseDetails" : "settings.common.expandDetails", { title }));
    actions.append(disclosure);
  }
  card.append(row(title, description, actions));
  if (expanded) {
    const detail = el("div", "feature-settings-detail");
    detail.id = detailId;
    detail.append(...detailsBuilder());
    card.append(detail);
  }
  return card;
}

function toggle(checked, onChange, label) {
  const wrap = el("label", "switch");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(checked);
  input.setAttribute("aria-label", label || t("settings.common.toggle"));
  input.addEventListener("change", () => onChange(input.checked));
  wrap.append(input, el("span", "switch-track"));
  return wrap;
}

function select(value, options, onChange, label) {
  const node = document.createElement("select");
  node.setAttribute("aria-label", label);
  for (const [optionValue, optionLabel] of options) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = optionLabel;
    option.selected = optionValue === String(value);
    node.append(option);
  }
  node.addEventListener("change", () => onChange(node.value));
  return node;
}

function button(text, action, kind = "secondary") {
  const node = el("button", `button ${kind}`, text);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

function section(title, subtitle) {
  const node = el("section", "settings-section");
  const heading = el("div", "section-heading");
  heading.append(el("h2", "", title));
  if (subtitle) heading.append(el("p", "", subtitle));
  node.append(heading);
  return node;
}

function localizeStaticShell() {
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((node) => {
    node.setAttribute("aria-label", t(node.dataset.i18nAriaLabel));
  });
}

async function save(partial) {
  const previous = state.settings;
  state.settings = { ...state.settings, ...partial };
  try {
    await api.setSettings(partial);
    if ("telemetryEnabled" in partial) await loadTelemetryStatus();
    if (state.activeTab === "about") renderPage();
  } catch (error) {
    state.settings = previous;
    renderPage();
    showToast(error?.message || t("settings.error.saveFailed"), true);
  }
}

async function loadTelemetryStatus() {
  try {
    state.telemetryStatus = await api.getTelemetryStatus?.() || null;
  } catch {
    state.telemetryStatus = null;
  }
}

async function loadDisplays(showNotice = false) {
  try {
    state.displays = (await api.getDisplays()) || [];
    if (showNotice) showToast(t("settings.display.found", { count: state.displays.length }));
    if (state.activeTab === "general") renderPage();
  } catch (error) {
    if (showNotice) showToast(error?.message || t("settings.display.readFailed"), true);
  }
}

async function loadCodexPets() {
  try {
    state.codexPets = (await api.getCodexPets?.()) || [];
  } catch {
    state.codexPets = [];
  }
}

async function loadAgentControlStatus(render = false) {
  try {
    const [status, manual] = await Promise.all([
      api.getAgentControlStatus?.(),
      api.getAgentControlManualConfig?.("codex")
    ]);
    state.agentControl = status || { enabled: false, client: null, activity: [] };
    state.agentControlManual = manual || null;
  } catch (error) {
    state.agentControl = {
      enabled: state.settings?.localAgentControlEnabled === true,
      client: null,
      activity: [],
      error: error?.message || t("settings.mcp.readFailed")
    };
  }
  if (render && state.activeTab === "mcp") renderPage();
}

async function copyAgentControlConfig() {
  const text = state.agentControlManual?.toml || "";
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast(t("settings.mcp.configCopied"));
  } catch {
    showToast(t("settings.mcp.copyFailed"), true);
  }
}

async function loadTemplates() {
  try {
    state.templates = (await api.listTemplates?.()) || { active: null, templates: [] };
  } catch {
    state.templates = { active: null, templates: [] };
  }
}

function requestQuitApp() {
  const confirmed = window.confirm(t("settings.app.quitConfirm"));
  if (confirmed) api.quitApp();
}

function savedCommandsControl() {
  const wrap = el("div", "saved-command-control");
  const commands = Array.isArray(state.settings.terminalSavedCommands)
    ? state.settings.terminalSavedCommands
    : [];
  const list = el("div", "saved-command-list");
  if (commands.length === 0) list.append(el("span", "saved-command-empty", t("settings.terminal.commands.empty")));
  for (const command of commands) {
    const chip = el("div", "saved-command-chip");
    const copy = el("div", "saved-command-copy");
    copy.append(
      el("span", "saved-command-name", command.name),
      el("code", "saved-command-value", command.command)
    );
    const remove = button(t("common.delete"), async () => {
      await save({
        terminalSavedCommands: commands.filter(item => item.id !== command.id)
      });
      renderPage();
      showToast(t("settings.terminal.commands.removed", { name: command.name }));
    }, "danger");
    remove.classList.add("saved-command-remove");
    remove.setAttribute("aria-label", t("settings.terminal.commands.removeLabel", { name: command.name }));
    chip.append(copy, remove);
    list.append(chip);
  }
  const editor = el("div", "terminal-command-editor");
  const nameInput = document.createElement("input");
  nameInput.className = "text-input";
  nameInput.placeholder = t("settings.terminal.commands.namePlaceholder");
  nameInput.value = state.commandDraft.name;
  nameInput.setAttribute("aria-label", t("settings.terminal.commands.nameLabel"));
  nameInput.addEventListener("input", () => { state.commandDraft.name = nameInput.value; });
  const commandInput = document.createElement("input");
  commandInput.className = "text-input terminal-command-input";
  commandInput.placeholder = t("settings.terminal.commands.commandPlaceholder");
  commandInput.value = state.commandDraft.command;
  commandInput.setAttribute("aria-label", t("settings.terminal.commands.commandLabel"));
  commandInput.addEventListener("input", () => { state.commandDraft.command = commandInput.value; });
  const add = button(t("settings.terminal.commands.add"), () => {
    const name = nameInput.value.trim();
    const command = commandInput.value.trim();
    if (!name || !command) {
      showToast(t("settings.terminal.commands.incomplete"), true);
      return;
    }
    state.commandDraft = { name: "", command: "" };
    save({
      terminalSavedCommands: [
        ...commands,
        { id: `user-${Date.now()}`, name, command }
      ]
    });
  });
  editor.append(nameInput, commandInput, add);
  wrap.append(list, editor);
  return wrap;
}

async function selectTerminalDirectory() {
  const customDirectory = await api.selectDirectory?.();
  if (!customDirectory) return;
  await save({ terminalDefaultDirectory: "custom", terminalCustomDirectory: customDirectory });
  showToast(t("settings.terminal.directory.saved"));
}

function terminalDirectoryControl() {
  const wrap = el("div", "terminal-directory-control");
  const mode = select(
    state.settings.terminalDefaultDirectory,
    [["agent-project", t("settings.terminal.directory.agentProject")], ["home", t("settings.terminal.directory.home")], ["custom", t("settings.terminal.directory.custom")]],
    async value => {
      if (value === "custom") await selectTerminalDirectory();
      else await save({ terminalDefaultDirectory: value });
    },
    t("settings.terminal.directory.label")
  );
  wrap.append(mode);
  if (state.settings.terminalDefaultDirectory === "custom") {
    wrap.append(el("span", "terminal-directory-path", state.settings.terminalCustomDirectory || t("settings.terminal.directory.notSelected")));
    wrap.append(button(t("settings.terminal.directory.choose"), selectTerminalDirectory));
  }
  return wrap;
}

function quickShareProviderControl() {
  const current = api.platform === "win32" ? "__system__" : (state.settings.shelfQuickShareProvider || "AirDrop");
  const providers = state.shareProviders.length
    ? state.shareProviders
    : [{ id: current, title: current }, { id: "__system__", title: t("settings.shelf.systemShare") }];
  return select(current, providers.map((provider) => [provider.id, provider.title]), async value => {
    await save({ shelfQuickShareProvider: value });
    showToast(t("settings.shelf.defaultShareChanged", { provider: providers.find((provider) => provider.id === value)?.title || value }));
  }, t("settings.shelf.defaultShare"));
}

function generalPage() {
  const root = document.createDocumentFragment();
  const language = section(t("settings.general.language.sectionTitle"), t("settings.general.language.description"));
  language.append(row(
    t("settings.general.language.title"),
    t("settings.general.language.changeHint"),
    select(getLanguagePreference(), [
      ["system", t("settings.general.language.followSystem")],
      ["zh-CN", t("settings.general.language.simplifiedChinese")],
      ["en", t("settings.general.language.english")]
    ], async (value) => {
      await setLanguagePreference(value, api);
    }, t("settings.general.language.title"))
  ));
  const workstation = section(t("settings.general.workstation.sectionTitle"), t("settings.general.workstation.description"));
  workstation.append(
    featureSettingsRow(
      "media",
      t("settings.general.media.title"),
      t("settings.general.media.description", { platform: api.platform === "win32" ? "Windows" : "macOS" }),
      toggle(state.settings.mediaEnabled, v => save({ mediaEnabled: v }), t("settings.general.media.title")),
      () => [
        row(t("settings.general.media.trackChange.title"), t("settings.general.media.trackChange.description"), toggle(state.settings.mediaTrackChangeNotifications, v => save({ mediaTrackChangeNotifications: v }), t("settings.general.media.trackChange.title"))),
        row(t("settings.general.media.lyrics.title"), t("settings.general.media.lyrics.description"), toggle(state.settings.lyricsEnabled, v => save({ lyricsEnabled: v }), t("settings.general.media.lyrics.title"))),
        row(t("settings.general.media.lyricsCache.title"), t("settings.general.media.lyricsCache.description"), button(t("settings.general.media.lyricsCache.clear"), async () => {
          await api.clearLyricsCache();
          showToast(t("settings.general.media.lyricsCache.cleared"));
        }))
      ]
    ),
    featureSettingsRow(
      "performance",
      t("settings.general.performance.title"),
      t("settings.general.performance.description"),
      toggle(state.settings.performanceEnabled, v => save({ performanceEnabled: v }), t("settings.general.performance.title")),
      () => [row(t("settings.general.performance.alerts.title"), t("settings.general.performance.alerts.description"), toggle(state.settings.performanceAlertsEnabled, v => save({ performanceAlertsEnabled: v }), t("settings.general.performance.alerts.title")))]
    )
  );
  const productivity = section(t("settings.general.productivity.sectionTitle"), t("settings.general.productivity.description"));
  productivity.append(
    featureSettingsRow(
      "shelf",
      t("settings.general.shelf.title"),
      t("settings.general.shelf.description"),
      toggle(state.settings.fileShelfEnabled, v => save({ fileShelfEnabled: v }), t("settings.general.shelf.title")),
      () => [row(t("settings.general.shelf.quickShare.title"), t("settings.general.shelf.quickShare.description"), quickShareProviderControl())]
    ),
    featureSettingsRow(
      "clipboard",
      t("settings.general.clipboard.title"),
      t("settings.general.clipboard.description"),
      toggle(state.settings.clipboardHistoryEnabled, v => {
        if (v && !window.confirm(t("settings.general.clipboard.enableConfirm"))) {
          renderPage();
          return;
        }
        save({ clipboardHistoryEnabled: v });
      }, t("settings.general.clipboard.title")),
      () => [
        row(
          t("settings.general.clipboard.limit.title"),
          t("settings.general.clipboard.limit.description"),
          select(
            state.settings.clipboardHistoryLimit,
            [25, 50, 100, 250].map(count => [String(count), t("settings.count.items", { count })]),
            v => save({ clipboardHistoryLimit: Number(v) }),
            t("settings.general.clipboard.limit.label")
          )
        ),
        row(
          t("settings.general.clipboard.retention.title"),
          t("settings.general.clipboard.retention.description"),
          select(
            state.settings.clipboardRetentionHours,
            [["1", t("settings.duration.hours", { count: 1 })], ["8", t("settings.duration.hours", { count: 8 })], ["24", t("settings.duration.hours", { count: 24 })], ["168", t("settings.duration.days", { count: 7 })], ["0", t("settings.general.clipboard.retention.never")]],
            v => save({ clipboardRetentionHours: Number(v) }),
            t("settings.general.clipboard.retention.label")
          )
        )
      ]
    ),
    featureSettingsRow(
      "terminal",
      t("settings.general.terminal.title"),
      t("settings.general.terminal.description"),
      toggle(state.settings.terminalEnabled, v => save({ terminalEnabled: v }), t("settings.general.terminal.title")),
      () => [
        row(t("settings.general.terminal.directory.title"), t("settings.general.terminal.directory.description"), terminalDirectoryControl()),
        row(t("settings.general.terminal.commands.title"), t("settings.general.terminal.commands.description"), savedCommandsControl())
      ]
    ),
    featureSettingsRow(
      "clear-sessions",
      t("settings.general.clearSessions.title"),
      t("settings.general.clearSessions.description"),
      toggle(state.settings.clearSessionsEnabled, v => save({ clearSessionsEnabled: v }), t("settings.general.clearSessions.title"))
    )
  );
  const behavior = section(t("settings.general.behavior.sectionTitle"), t("settings.general.behavior.description"));
  behavior.append(
    row(t("settings.general.behavior.launchAtLogin.title"), t("settings.general.behavior.launchAtLogin.description"), toggle(state.settings.launchAtLogin, v => save({ launchAtLogin: v }), t("settings.general.behavior.launchAtLogin.title"))),
    row(t("settings.general.behavior.dock.title"), t("settings.general.behavior.dock.description"), toggle(state.settings.islandPlacement === "docked", v => save({ islandPlacement: v ? "docked" : "notch" }), t("settings.general.behavior.dock.title"))),
    row(t("settings.general.behavior.hover.title"), t("settings.general.behavior.hover.description"), toggle(state.settings.hoverToOpen, v => save({ hoverToOpen: v }), t("settings.general.behavior.hover.title"))),
    row(t("settings.general.behavior.blur.title"), t("settings.general.behavior.blur.description"), toggle(state.settings.autoCollapseOnMouseLeave, v => save({ autoCollapseOnMouseLeave: v }), t("settings.general.behavior.blur.title"))),
    row(
      t("settings.general.behavior.reopen.title"),
      t("settings.general.behavior.reopen.description"),
      select(
        state.settings.toolboxReopenMode === "last" ? "last" : "agent",
        [["agent", t("settings.general.behavior.reopen.agent")], ["last", t("settings.general.behavior.reopen.last")]],
        v => save({ toolboxReopenMode: v }),
        t("settings.general.behavior.reopen.label")
      )
    ),
    row(t("settings.general.behavior.fullscreen.title"), t("settings.general.behavior.fullscreen.description"), toggle(state.settings.hideWhenFullscreen, v => save({ hideWhenFullscreen: v }), t("settings.general.behavior.fullscreen.title"))),
    row(
      t("settings.general.behavior.displayMode.title"),
      t("settings.general.behavior.displayMode.description"),
      select(
        state.settings.islandDisplayMode === "persistent" ? "persistent" : "minimal",
        [["persistent", t("settings.general.behavior.displayMode.persistent")], ["minimal", t("settings.general.behavior.displayMode.minimal")]],
        v => save({ islandDisplayMode: v }),
        t("settings.general.behavior.displayMode.title")
      )
    ),
    row(t("settings.general.behavior.submit.title"), t("settings.general.behavior.submit.description"), toggle(state.settings.expandOnSessionSubmit, v => save({ expandOnSessionSubmit: v }), t("settings.general.behavior.submit.label"))),
    row(t("settings.general.behavior.action.title"), t("settings.general.behavior.action.description"), toggle(state.settings.expandOnActionRequired, v => save({ expandOnActionRequired: v }), t("settings.general.behavior.action.label"))),
    row(t("settings.general.behavior.complete.title"), t("settings.general.behavior.complete.description"), toggle(state.settings.expandOnSessionComplete, v => save({ expandOnSessionComplete: v }), t("settings.general.behavior.complete.label"))),
    row(
      t("settings.general.behavior.completionDuration.title"),
      t("settings.general.behavior.completionDuration.description"),
      select(
        state.settings.completionPopupDurationSec,
        [["5", t("settings.duration.seconds", { count: 5 })], ["10", t("settings.duration.seconds", { count: 10 })], ["20", t("settings.duration.seconds", { count: 20 })], ["30", t("settings.duration.seconds", { count: 30 })]],
        v => save({ completionPopupDurationSec: Number(v) }),
        t("settings.general.behavior.completionDuration.title")
      )
    )
  );

  const display = section(t("settings.general.display.sectionTitle"), t("settings.general.display.description"));
  // "auto" tracks the screen containing the current frontmost app. A display
  // id is a pinned screen and is the reliable choice for an external monitor.
  const displayOptions = [["primary", t("settings.general.display.primary"), t("settings.general.display.primary")], ["auto", t("settings.general.display.active"), ""]];
  const displayPreference = state.settings.displayPreference === "active"
    ? "auto"
    : (state.settings.displayPreference || "primary");
  const currentDisplay = displayPreference === "primary"
    ? state.displays.find(d => d.isMain)
    : state.displays.find(d => String(d.displayId) === String(displayPreference));
  if (state.displays && state.displays.length > 0) {
    for (const d of state.displays) {
      const label = d.label || t("settings.general.display.named", { id: d.displayId });
      const tag = d.isMain ? t("settings.general.display.builtin") : t("settings.general.display.external");
      displayOptions.push([String(d.displayId), `${label} · ${tag}`, label]);
    }
  }
  // Keep an unplugged pinned display visible so the setting explains why the
  // app has fallen back to the primary screen instead of silently changing it.
  if (displayPreference !== "primary" && displayPreference !== "auto" && !currentDisplay) {
    displayOptions.push([
      String(displayPreference),
      t("settings.general.display.unavailableOption", { display: state.settings.displayPreferenceLabel || t("settings.general.display.saved") }),
      state.settings.displayPreferenceLabel || ""
    ]);
  }
  const displaySelect = select(displayPreference, displayOptions, v => {
    const selected = displayOptions.find(o => o[0] === v);
    save({
      displayPreference: v,
      displayPreferenceLabel: selected?.[2] || ""
    });
  }, t("settings.general.display.label"));
  const displayControl = el("div", "inline-controls");
  displayControl.append(displaySelect, button(t("common.refresh"), () => loadDisplays(true)));
  const displayDescription = displayPreference === "primary"
    ? t("settings.general.display.usingPrimary")
    : currentDisplay
    ? t("settings.general.display.connected", { display: currentDisplay.label || t("settings.general.display.connectedFallback"), type: currentDisplay.isMain ? t("settings.general.display.builtin") : t("settings.general.display.external") })
    : displayPreference === "auto"
      ? t("settings.general.display.followActive")
      : t("settings.general.display.fallbackPrimary");
  display.append(
    row(t("settings.general.display.label"), t("settings.general.display.selectionHint", { display: displayDescription }), displayControl),
    row(t("settings.general.display.quota.title"), t("settings.general.display.quota.description"), toggle(state.settings.showUsageQuota, v => save({ showUsageQuota: v }), t("settings.general.display.quota.label"))),
    row(t("settings.general.display.haptics.title"), t("settings.general.display.haptics.description"), toggle(state.settings.hapticFeedback, v => save({ hapticFeedback: v }), t("settings.general.display.haptics.title")))
  );
  const lifecycle = section(t("settings.general.app.sectionTitle"), t("settings.general.app.description"));
  lifecycle.append(
    row(t("settings.general.app.quitTitle"), t("settings.general.app.quitDescription"), button(t("settings.general.app.quitAction"), requestQuitApp, "danger"))
  );
  root.append(language, workstation, productivity, behavior, display, lifecycle);
  return root;
}

function statusBadge(report) {
  const installed = Boolean(report?.installed);
  const unavailable = report?.available === false;
  const verifyOnRealEvent = VERIFY_ON_REAL_EVENT_AGENT_IDS.has(report?.agentId);
  const verified = report?.connectionState === "verified";
  const diagnosis = report?.diagnosis;
  const repairNeeded = diagnosis?.status === "hook_missing" || diagnosis?.status === "hook_stale" || diagnosis?.status === "hook_invalid";
  const text = repairNeeded
    ? t("settings.agents.status.repair")
    : verifyOnRealEvent && installed
    ? (verified ? t("settings.agents.status.connected") : t("settings.agents.status.configured"))
    : installed ? t("settings.agents.status.connected") : unavailable ? t("settings.agents.status.notDetected") : t("settings.agents.status.disconnected");
  const statusClass = repairNeeded
    ? "repair"
    : verifyOnRealEvent && installed && !verified
    ? "pending"
    : installed ? "installed" : "missing";
  return el("span", `status ${statusClass}`, text);
}

function doctorSummaryLine(summary) {
  if (!summary || !summary.total) return "";
  const parts = [t("settings.agents.summary.total", { count: summary.total }), t("settings.agents.summary.ok", { count: summary.ok })];
  if (summary.repairable) parts.push(t("settings.agents.summary.repair", { count: summary.repairable }));
  if (summary.notInstalled) parts.push(t("settings.agents.summary.notInstalled", { count: summary.notInstalled }));
  if (summary.blocked) parts.push(t("settings.agents.summary.attention", { count: summary.blocked }));
  return parts.join(" · ");
}

function buildComplaintDiagnostics(appVersion) {
  const platform = navigator.userAgentData?.platform || navigator.platform || "unknown";
  const lines = [
    "---",
    t("settings.feedback.diagnostics.generated"),
    `WorkIsland: ${appVersion || "unknown"} (${platform})`
  ];
  try {
    const agents = [...state.statuses.values()].map(report => `${report.agentId}:${report?.diagnosis?.status || "unknown"}`);
    if (agents.length) lines.push(`Agents: ${agents.join(", ")}`);
    const doctor = doctorSummaryLine(state.doctorSummary);
    if (doctor) lines.push(`Doctor: ${doctor}`);
  } catch { /* 诊断摘要失败不阻塞提交 */ }
  return lines.join("\n");
}

function openComplaintBox() {
  if (document.querySelector(".complaint-overlay")) return;
  const overlay = el("div", "complaint-overlay");
  const card = el("div", "complaint-card");
  card.append(
    el("h2", "complaint-title", t("settings.feedback.title")),
    el("p", "complaint-hint", t("settings.feedback.hint")),
    el("p", "complaint-hint", t("settings.feedback.privacy"))
  );
  const textarea = document.createElement("textarea");
  textarea.className = "complaint-input";
  textarea.rows = 6;
  textarea.placeholder = t("settings.feedback.placeholder");
  const statusLine = el("p", "complaint-status", "");
  const sendButton = button(t("settings.feedback.send"), async () => {
    const text = textarea.value.trim();
    if (!text) {
      statusLine.textContent = t("settings.feedback.empty");
      return;
    }
    sendButton.disabled = true;
    try {
      const appVersion = await api.getAppVersion().catch(() => "");
      const fullBody = `${text}\n${buildComplaintDiagnostics(appVersion)}`;
      try { await navigator.clipboard.writeText(fullBody); } catch { /* 剪贴板失败不影响打开 */ }
      const params = new URLSearchParams({
        template: GITHUB_ISSUE_TEMPLATE,
        title: text.split("\n")[0].slice(0, 60) || t("settings.feedback.issueTitle"),
        version: `${appVersion || "unknown"} (${navigator.userAgentData?.platform || navigator.platform || "unknown"})`,
        area: "Other",
        reproduction: text.slice(0, COMPLAINT_BODY_LIMIT),
        expected: t("settings.feedback.expected"),
        actual: fullBody.slice(0, COMPLAINT_BODY_LIMIT + 600),
        frequency: t("settings.feedback.frequency")
      });
      api.openExternal(`${GITHUB_ISSUE_NEW_URL}?${params}`);
      statusLine.textContent = t("settings.feedback.opened");
      setTimeout(() => overlay.remove(), 8000);
    } finally {
      sendButton.disabled = false;
    }
  }, "primary");
  const copyButton = button(t("settings.feedback.copyDiagnostics"), async () => {
    const appVersion = await api.getAppVersion().catch(() => "");
    try {
      await navigator.clipboard.writeText(buildComplaintDiagnostics(appVersion));
      statusLine.textContent = t("settings.feedback.diagnosticsCopied");
    } catch {
      statusLine.textContent = t("settings.feedback.copyFailed");
    }
  });
  const cancelButton = button(t("common.cancel"), () => overlay.remove());
  const actions = el("div", "complaint-actions");
  actions.append(copyButton, cancelButton, sendButton);
  card.append(textarea, statusLine, actions);
  overlay.append(card);
  overlay.addEventListener("keydown", event => { if (event.key === "Escape") overlay.remove(); });
  document.body.append(overlay);
  textarea.focus();
}

async function refreshAgents() {
  const reports = await api.getHookStatus();
  state.statuses = new Map((reports || []).map(report => [report.agentId, report]));
  const summary = { total: reports?.length || 0, ok: 0, repairable: 0, notInstalled: 0, blocked: 0 };
  for (const report of reports || []) {
    const status = report?.diagnosis?.status;
    if (status === "ok") summary.ok += 1;
    else if (status === "not_installed") summary.notInstalled += 1;
    else if (status === "hook_missing" || status === "hook_stale" || status === "hook_invalid") summary.repairable += 1;
    else if (status) summary.blocked += 1;
  }
  state.doctorSummary = summary;
  if (state.activeTab === "agents") renderPage();
}

async function setAgentInstalled(agentId, install, actionButton) {
  if (state.busy.has(agentId)) return;
  state.busy.add(agentId);
  actionButton.disabled = true;
  actionButton.textContent = install ? t("settings.agents.connecting") : t("settings.agents.removing");
  try {
    const result = install ? await api.installHook(agentId) : await api.uninstallHook(agentId);
    if (result?.success === false) throw new Error(result.error || t("settings.agents.installFailed"));
    const toggles = { ...(state.settings.hookToggles || {}), [agentId]: install };
    await save({ hookToggles: toggles });
    await refreshAgents();
  } catch (error) {
    showToast(error.message || String(error), true);
  } finally {
    state.busy.delete(agentId);
  }
}

async function repairAgentHook(agentId, actionButton) {
  if (state.busy.has(agentId)) return;
  state.busy.add(agentId);
  actionButton.disabled = true;
  actionButton.textContent = t("settings.agents.repairing");
  try {
    const result = await api.repairHook(agentId);
    if (result?.success === false) throw new Error(result.error || t("settings.agents.repairFailed"));
    if (result?.resolved === false) showToast(t("settings.agents.repairUnresolved", { agent: agentId }), true);
    await refreshAgents();
  } catch (error) {
    showToast(error.message || String(error), true);
  } finally {
    state.busy.delete(agentId);
  }
}

async function repairAllAgentHooks(actionButton) {
  if (state.busy.has("doctor-repair-all")) return;
  state.busy.add("doctor-repair-all");
  actionButton.disabled = true;
  const originalText = actionButton.textContent;
  actionButton.textContent = t("settings.agents.repairing");
  try {
    const results = await api.repairAllHooks();
    const ok = (results || []).filter(r => r?.success).length;
    const failed = (results || []).length - ok;
    if (!(results || []).length) showToast(t("settings.agents.nothingToRepair"));
    else if (failed) showToast(t("settings.agents.repairAllPartial", { ok, failed }), true);
    else showToast(t("settings.agents.repairAllSuccess", { count: ok }));
    await refreshAgents();
  } catch (error) {
    showToast(error.message || String(error), true);
  } finally {
    state.busy.delete("doctor-repair-all");
    actionButton.disabled = false;
    actionButton.textContent = originalText;
  }
}

function capabilitySummary(capabilities = {}) {
  const items = [];
  if (capabilities.liveStatus) items.push(t("settings.agents.capability.liveStatus"));
  if (capabilities.completion === "native") items.push(t("settings.agents.capability.completion"));
  else if (capabilities.completion === "inferred") items.push(t("settings.agents.capability.inferredCompletion"));
  if (capabilities.approval === "bridge") items.push(t("settings.agents.capability.islandApproval"));
  else if (capabilities.approval === "observe") items.push(t("settings.agents.capability.observeApproval"));
  if (capabilities.jump === "session") items.push(t("settings.agents.capability.openSession"));
  else if (capabilities.jump === "workspace") items.push(t("settings.agents.capability.openWorkspace"));
  else if (capabilities.jump === "app") items.push(t("settings.agents.capability.openApp"));
  return items.join(" · ");
}

function agentDetailFallback(report, repairNeeded, verifyOnRealEvent) {
  if (repairNeeded) return t("settings.agents.detail.repair");
  if (verifyOnRealEvent && report.installed && report.connectionState !== "verified") return t("settings.agents.awaitingEvent");
  if (report.available === false && !report.installed) return t("settings.agents.notDetectedHint", { agent: report.label });
  if (report.connectionState === "verified") return t("settings.agents.detail.connected");
  if (report.issues?.length) return t("settings.agents.detail.attention");
  return t("settings.agents.detail.available");
}

function agentCard(report) {
  const { agentId, label } = report;
  const card = el("div", "agent-card");
  const iconFrame = el("div", "agent-icon");
  const icon = el("img", "agent-icon-image");
  icon.src = AGENT_ICON_URLS[agentId] || DEFAULT_AGENT_ICON_URL;
  icon.alt = "";
  icon.draggable = false;
  iconFrame.append(icon);
  const content = el("div", "agent-content");
  const heading = el("div", "agent-heading");
  heading.append(el("strong", "", label), statusBadge(report));
  content.append(heading);
  const issues = report?.issues?.filter(Boolean) || [];
  const diagnosis = report?.diagnosis;
  const repairNeeded = diagnosis?.status === "hook_missing" || diagnosis?.status === "hook_stale" || diagnosis?.status === "hook_invalid";
  const verifyOnRealEvent = VERIFY_ON_REAL_EVENT_AGENT_IDS.has(agentId);
  const rawDetail = repairNeeded && diagnosis.reasons?.length
    ? diagnosis.reasons[0]
    : verifyOnRealEvent && report.installed && report.connectionState !== "verified"
    ? (issues[0] || t("settings.agents.awaitingEvent"))
    : report.available === false && !report.installed
    ? t("settings.agents.notDetectedHint", { agent: label })
    : issues.length ? issues[0] : report.description;
  const detail = localizedRuntimeText(getLocale(), rawDetail, agentDetailFallback(report, repairNeeded, verifyOnRealEvent));
  content.append(el("div", "agent-detail", detail));
  const capabilities = capabilitySummary(report.capabilities);
  if (capabilities) content.append(el("div", "agent-detail", capabilities));

  if (report.capabilities?.approvalConfigurable) {
    const approval = select(state.settings.approvalModes?.[agentId] || "bridge", [["bridge", t("settings.agents.approval.island")], ["terminalNative", t("settings.agents.approval.terminal")]], async value => {
      await save({ approvalModes: { ...(state.settings.approvalModes || {}), [agentId]: value } });
      showToast(t("settings.agents.approval.saved"));
    }, t("settings.agents.approval.label", { agent: label }));
    approval.classList.add("compact-select");
    content.append(approval);
  }

  const installed = Boolean(report?.installed);
  const action = button(installed ? t("settings.agents.remove") : t("settings.agents.connect"), () => setAgentInstalled(agentId, !installed, action), installed ? "secondary" : "primary");
  if (report.available === false && !installed) {
    action.disabled = true;
    action.textContent = t("settings.agents.notInstalled");
  }
  if (repairNeeded) {
    const repair = button(t("settings.agents.repair"), () => repairAgentHook(agentId, repair), "primary");
    card.append(iconFrame, content, repair, action);
  } else {
    card.append(iconFrame, content, action);
  }
  return card;
}

async function loadRemoteSsh(showNotice = false) {
  try {
    state.remoteSshConfig = await api.scanRemoteSshConfig?.() || { entries: [] };
  } catch {
    state.remoteSshConfig = { entries: [] };
  }
  if (showNotice) renderPage();
}

async function loadRemoteHosts(render = false) {
  try {
    state.remoteHosts = await api.getRemoteHostsState?.() || null;
  } catch {
    state.remoteHosts = null;
  }
  if (render && state.activeTab === "agents") renderPage();
}

function copyText(text, label) {
  navigator.clipboard?.writeText(text).then(
    () => showToast(t("settings.copy.copied", { label })),
    () => showToast(t("settings.copy.failed"), true)
  );
}

// PRD-016 / ADR-0005 SSH 远程设置页：主机管理、SSH Config 发现与反向隧道。
function remoteStatusLabel(host, remote) {
  if (host.invited) {
    const tunnel = remote.tunnels?.[host.hostId];
    return `${t("settings.remote.invited")} · ${tunnel?.running ? t("settings.remote.tunnelRunning") : t("settings.remote.tunnelDown")}`;
  }
  const online = (remote.listener?.connectedHosts || []).includes(host.hostId);
  const pairedAt = host.pairedAt ? new Date(host.pairedAt).toLocaleString() : "";
  return t("settings.remote.hostDetail", { status: online ? t("settings.agents.status.connected") : t("settings.agents.status.disconnected"), time: pairedAt });
}

function remoteSetupCommands(host) {
  const invite = state.remoteInvites[host.hostId];
  if (!invite) return null;
  return t("settings.remote.setupCommands", {
    scriptPath: invite.scriptPath,
    target: host.sshTarget || host.displayName,
    token: invite.token
  });
}

function remoteHostCard(host, remote) {
  const card = el("div", "remote-host-card");
  const content = el("div", "remote-host-copy");
  content.append(el("div", "remote-host-name", host.displayName));
  content.append(el("div", "remote-host-detail", `${host.sshTarget ? `${host.sshTarget} · ` : ""}${remoteStatusLabel(host, remote)}`));
  card.append(content);
  const actions = el("div", "remote-host-actions");
  const setup = remoteSetupCommands(host);
  if (host.invited && setup) {
    actions.append(button(t("settings.remote.copySetup"), () => {
      navigator.clipboard?.writeText(setup).then(
        () => showToast(t("settings.remote.setupCopied")),
        () => showToast(t("settings.copy.failed"), true)
      );
    }, "primary"));
  }
  const tunnel = remote.tunnels?.[host.hostId];
  if (host.sshTarget && tunnel && !tunnel.running) {
    actions.append(button(t("settings.remote.tunnelRetry"), async () => {
      try {
        await api.startRemoteTunnel(host.hostId);
        await loadRemoteHosts();
        renderPage();
      } catch (error) {
        showToast(error?.message || t("settings.remote.inviteFailed"), true);
      }
    }));
  }
  actions.append(button(t("settings.remote.revoke"), async () => {
    if (!window.confirm(t("settings.remote.revokeConfirm", { host: host.displayName }))) return;
    try {
      await api.revokeRemoteHost(host.hostId);
      delete state.remoteInvites[host.hostId];
      await loadRemoteHosts();
      renderPage();
      showToast(t("settings.remote.revoked"));
    } catch (error) {
      showToast(error?.message || t("settings.remote.revokeFailed"), true);
    }
  }, "danger"));
  card.append(actions);
  if (host.invited && setup) {
    const hint = el("div", "remote-setup-hint");
    hint.append(el("div", "setting-description", t("settings.remote.setupHint")));
    hint.append(el("pre", "remote-setup-commands", setup));
    card.append(hint);
  }
  return card;
}

function remoteConfigRow(entry, addedNames) {
  const rowNode = el("div", "remote-config-row");
  const copy = el("div", "remote-host-copy");
  copy.append(el("div", "remote-host-name", entry.alias));
  const target = `${entry.user ? `${entry.user}@` : ""}${entry.hostName}`;
  copy.append(el("div", "remote-host-detail", entry.port && entry.port !== "22" ? `${target} · Port ${entry.port}` : target));
  rowNode.append(copy);
  const added = addedNames.has(entry.alias) || addedNames.has(target) || addedNames.has(entry.hostName);
  rowNode.append(button(added ? t("settings.remote.added") : t("settings.remote.add"), async (event) => {
    if (added) return;
    const btn = event?.target?.closest?.("button") ?? event?.target;
    if (btn) btn.disabled = true;
    try {
      const invite = await api.inviteRemoteHost({ alias: entry.alias, hostName: entry.hostName, user: entry.user, port: entry.port });
      state.remoteInvites[invite.host.hostId] = { token: invite.token, expiresAt: invite.expiresAt, scriptPath: invite.scriptPath };
      await loadRemoteHosts();
      renderPage();
      showToast(t("settings.remote.setupCopied"));
    } catch (error) {
      if (btn) btn.disabled = false;
      showToast(error?.message || t("settings.remote.inviteFailed"), true);
    }
  }, added ? "secondary" : "primary"));
  return rowNode;
}

function remotePendingSection() {
  const node = section(t("settings.remote.pendingSection"), "");
  const actions = el("div", "section-actions");
  actions.append(button(t("settings.remote.rescan"), () => loadRemoteSsh(true).catch(error => showToast(error.message, true))));
  node.append(actions);
  const filter = document.createElement("input");
  filter.className = "text-input remote-filter";
  filter.placeholder = t("settings.remote.filterPlaceholder");
  filter.value = state.remoteFilter;
  filter.setAttribute("aria-label", t("settings.remote.filterPlaceholder"));
  node.append(filter);
  const listContainer = el("div", "remote-config-list");
  node.append(listContainer);
  const renderList = () => {
    listContainer.replaceChildren();
    const remote = state.remoteHosts;
    const entries = state.remoteSshConfig?.entries || [];
    const terms = state.remoteFilter.trim().split(/\s+/).filter(Boolean).map(term => term.toLowerCase());
    const filtered = entries.filter(entry => {
      const haystack = `${entry.alias} ${entry.user ?? ""} ${entry.hostName}`.toLowerCase();
      return terms.every(term => haystack.includes(term));
    });
    const addedNames = new Set((remote?.hosts || []).flatMap(host => [host.displayName, host.sshTarget].filter(Boolean)));
    if (filtered.length > 0) {
      const group = el("div", "remote-config-group");
      group.append(el("div", "remote-config-group-title", `${t("settings.remote.sshConfigGroup")} · ${filtered.length}`));
      for (const entry of filtered) group.append(remoteConfigRow(entry, addedNames));
      listContainer.append(group);
    } else if (entries.length > 0) {
      listContainer.append(el("div", "setting-description", t("settings.remote.filterNoMatch")));
    } else {
      listContainer.append(el("div", "setting-description", t("settings.remote.sshConfigEmpty")));
    }
  };
  renderList();
  filter.addEventListener("input", () => {
    state.remoteFilter = filter.value;
    renderList();
  });
  return node;
}

function remotePage() {
  const root = document.createDocumentFragment();
  const remote = state.remoteHosts;
  const cfg = state.settings.remoteAccess || { enabled: false, port: 7878 };
  const main = section(t("settings.remote.sectionTitle"), t("settings.remote.description"));
  main.append(row(t("settings.remote.enable.title"), t("settings.remote.enable.description"), toggle(remote?.enabled ?? cfg.enabled, async v => {
    await save({ remoteAccess: { ...cfg, enabled: v } });
    await loadRemoteHosts();
    renderPage();
  }, t("settings.remote.enable.title"))));
  if (!remote) {
    main.append(el("div", "setting-description", t("settings.remote.unavailable")));
    root.append(main);
    return root;
  }
  if (remote.enabled && !remote.listener?.running) {
    main.append(el("div", "doctor-summary", remote.listener?.lastError === "PORT_IN_USE" ? t("settings.remote.portInUse", { port: remote.listener?.port ?? cfg.port }) : t("settings.remote.notRunning")));
  }
  // 主机列表 + 手动添加表单
  const hostActions = el("div", "section-actions");
  hostActions.append(button(t("settings.remote.addHost"), () => {
    state.remoteManualOpen = !state.remoteManualOpen;
    renderPage();
  }, "primary"));
  main.append(hostActions);
  if (state.remoteManualOpen) {
    const draft = state.remoteManualDraft || (state.remoteManualDraft = { alias: "", hostName: "", user: "", port: "" });
    const form = el("div", "remote-manual-form");
    const field = (key, placeholder) => {
      const input = document.createElement("input");
      input.className = "text-input";
      input.placeholder = placeholder;
      input.value = draft[key];
      input.setAttribute("aria-label", placeholder);
      input.addEventListener("input", () => { draft[key] = input.value; });
      return input;
    };
    form.append(field("alias", t("settings.remote.manualAlias")), field("hostName", t("settings.remote.manualHost")), field("user", t("settings.remote.manualUser")), field("port", t("settings.remote.manualPort")));
    const formActions = el("div", "section-actions");
    formActions.append(button(t("settings.remote.manualSave"), async () => {
      if (!draft.hostName.trim()) return;
      try {
        const invite = await api.inviteRemoteHost({ alias: draft.alias.trim() || null, hostName: draft.hostName.trim(), user: draft.user.trim() || null, port: draft.port.trim() || "22" });
        state.remoteInvites[invite.host.hostId] = { token: invite.token, expiresAt: invite.expiresAt, scriptPath: invite.scriptPath };
        state.remoteManualDraft = { alias: "", hostName: "", user: "", port: "" };
        state.remoteManualOpen = false;
        await loadRemoteHosts();
        renderPage();
        showToast(t("settings.remote.setupCopied"));
      } catch (error) {
        showToast(error?.message || t("settings.remote.inviteFailed"), true);
      }
    }, "primary"), button(t("settings.remote.manualCancel"), () => {
      state.remoteManualOpen = false;
      renderPage();
    }));
    form.append(formActions);
    main.append(form);
  }
  const list = el("div", "agent-list");
  for (const host of remote.hosts || []) list.append(remoteHostCard(host, remote));
  if ((remote.hosts || []).length === 0) {
    list.append(el("div", "setting-description", t("settings.remote.emptyHosts")));
  }
  main.append(list);
  // 全局配对令牌（兼容 docs/REMOTE_ONBOARDING.md 的通用接入路径）
  const tokenArea = el("div", "inline-controls");
  tokenArea.append(button(t("settings.remote.generateToken"), async () => {
    try {
      state.remotePairing = await api.createRemotePairingToken();
      renderPage();
    } catch (error) {
      showToast(error?.message || t("settings.remote.tokenFailed"), true);
    }
  }));
  if (state.remotePairing?.token) {
    const expires = new Date(state.remotePairing.expiresAt).toLocaleTimeString();
    const tokenBox = el("code", "remote-token-box", state.remotePairing.token);
    tokenArea.append(tokenBox, button(t("common.copy"), () => copyText(state.remotePairing.token, t("settings.remote.token"))));
    main.append(el("div", "setting-description", t("settings.remote.tokenHint", { prefix: state.remotePairing.token.slice(0, 4), expires })));
  }
  main.append(row(t("settings.remote.pairing.title"), t("settings.remote.pairing.description"), tokenArea));
  root.append(main);
  root.append(remotePendingSection());
  return root;
}

function agentsPage() {
  const root = document.createDocumentFragment();
  const hooks = section(t("settings.agents.sectionTitle"), t("settings.agents.description"));
  const summaryText = doctorSummaryLine(state.doctorSummary);
  if (summaryText) {
    const summary = el("div", "doctor-summary", summaryText);
    summary.setAttribute("role", "status");
    if (state.doctorSummary?.repairable > 0) {
      const repairAll = button(t("settings.agents.repairAll"), () => repairAllAgentHooks(repairAll), "primary");
      summary.append(repairAll);
    }
    hooks.append(summary);
  }
  const grid = el("div", "agent-list");
  // 在用优先：已验证连接 / 已安装的 Agent 浮到最上面，一眼看到「我在用哪些」；
  // 各档内部保持目录顺序（Array.sort 稳定排序）。
  const tierOf = (report) => {
    if (report?.connectionState === "verified" || report?.diagnosis?.status === "ok") return 0;
    if (report?.installed) return 1;
    return 2;
  };
  const sortedReports = [...state.statuses.values()].sort((a, b) => tierOf(a) - tierOf(b));
  for (const report of sortedReports) grid.append(agentCard(report));
  hooks.append(grid);
  const tools = el("div", "section-actions");
  tools.append(
    button(t("settings.agents.checkAll"), () => refreshAgents().catch(error => showToast(error.message, true))),
    button(t("settings.agents.removeAll"), async () => {
      if (!window.confirm(t("settings.agents.removeAllConfirm"))) return;
      await api.uninstallAllHooks();
      await refreshAgents();
    }, "danger")
  );
  hooks.append(tools);
  root.append(hooks);
  return root;
}

async function changeAgentControlClient(connect, action) {
  if (state.busy.has("agent-control-codex")) return;
  state.busy.add("agent-control-codex");
  action.disabled = true;
  action.textContent = connect ? t("settings.agents.connecting") : t("settings.agents.removing");
  try {
    if (connect) await api.connectAgentControlClient("codex");
    else await api.disconnectAgentControlClient("codex");
    await loadAgentControlStatus();
    renderPage();
    showToast(t(connect ? "settings.mcp.client.connectedToast" : "settings.mcp.client.removedToast"));
  } catch (error) {
    state.agentControl = { ...(state.agentControl || {}), error: error?.message || t("settings.mcp.configureFailed") };
    renderPage();
    showToast(error?.message || t("settings.mcp.configureFailed"), true);
  } finally {
    state.busy.delete("agent-control-codex");
  }
}

function mcpPage() {
  const root = document.createDocumentFragment();
  const control = state.agentControl || {
    enabled: state.settings.localAgentControlEnabled === true,
    client: null,
    activity: []
  };
  const enabled = state.settings.localAgentControlEnabled === true;
  const authorization = section(t("settings.mcp.service.sectionTitle"), t("settings.mcp.service.description"));
  authorization.append(row(
    t("settings.mcp.service.enable.title"),
    t("settings.mcp.service.enable.description"),
    toggle(enabled, async value => {
      await save({ localAgentControlEnabled: value });
      await loadAgentControlStatus();
      renderPage();
    }, t("settings.mcp.service.enable.title"))
  ));

  const clientSection = section(t("settings.mcp.client.sectionTitle"), t("settings.mcp.client.description"));
  const client = control.client;
  if (client) {
    const card = el("div", "agent-control-client");
    const copy = el("div", "agent-content");
    const heading = el("div", "agent-heading");
    const stateText = client.connectionState === "connected"
      ? t("settings.mcp.client.connected")
      : client.connectionState === "configured"
        ? t("settings.mcp.client.configured")
        : client.installed ? t("settings.mcp.client.detected") : t("settings.mcp.client.notDetected");
    const badgeClass = client.connectionState === "connected" ? "installed" : client.configured ? "pending" : "missing";
    heading.append(el("strong", "", client.label || "Codex"), el("span", `status ${badgeClass}`, stateText));
    copy.append(
      heading,
      el("div", "agent-detail", client.configured
        ? t("settings.mcp.client.configPath", { path: client.configPath })
        : t("settings.mcp.client.connectHint"))
    );
    const action = button(client.configured ? t("settings.agents.remove") : t("settings.mcp.client.connectCodex"), () => changeAgentControlClient(!client.configured, action), client.configured ? "secondary" : "primary");
    action.disabled = state.busy.has("agent-control-codex") || (!client.configured && (!enabled || !client.installed));
    card.append(copy, action);
    clientSection.append(card);
  } else {
    clientSection.append(el("div", "agent-control-empty", t("settings.mcp.client.detecting")));
  }

  const examples = section(t("settings.mcp.examples.sectionTitle"), t("settings.mcp.examples.description"));
  const exampleList = el("div", "mcp-example-list");
  for (const question of [
    t("settings.mcp.examples.features"),
    t("settings.mcp.examples.running"),
    t("settings.mcp.examples.attention"),
    t("settings.mcp.examples.performance"),
    t("settings.mcp.examples.supported"),
    t("settings.mcp.examples.tools")
  ]) {
    const example = button(question, async () => {
      await navigator.clipboard.writeText(question);
      showToast(t("settings.mcp.examples.copied"));
    }, "mcp-example");
    example.setAttribute("aria-label", t("settings.mcp.examples.copyLabel", { question }));
    exampleList.append(example);
  }
  examples.append(exampleList);

  const privacy = section(t("settings.mcp.privacy.sectionTitle"), t("settings.mcp.privacy.description"));
  privacy.append(
    row(t("settings.mcp.privacy.read.title"), t("settings.mcp.privacy.read.description"), el("span", "status installed", t("settings.mcp.privacy.read.badge"))),
    row(t("settings.mcp.privacy.protected.title"), t("settings.mcp.privacy.protected.description"), el("span", "status installed", t("settings.mcp.privacy.protected.badge"))),
    row(t("settings.mcp.privacy.write.title"), t("settings.mcp.privacy.write.description"), el("span", "status pending", t("settings.mcp.privacy.write.badge")))
  );

  const recent = section(t("settings.mcp.activity.sectionTitle"), t("settings.mcp.activity.description"));
  const activity = el("div", "agent-control-activity");
  if (!Array.isArray(control.activity) || control.activity.length === 0) {
    activity.append(el("div", "agent-control-empty", t("settings.mcp.activity.empty")));
  } else {
    for (const item of control.activity) {
      const entry = el("div", "agent-control-activity-row");
      const title = t("settings.mcp.activity.title", { client: item.client || t("settings.mcp.activity.localClient"), tool: item.tool || t("settings.mcp.activity.call") });
      const details = [item.result === "success" ? t("settings.mcp.activity.success") : item.errorCode || t("settings.mcp.activity.denied")];
      if (Array.isArray(item.keys) && item.keys.length) details.push(item.keys.join(t("format.listSeparator")));
      if (Number.isFinite(item.timestamp)) details.push(new Date(item.timestamp).toLocaleString());
      entry.append(el("strong", "", title), el("span", "", details.join(" · ")));
      activity.append(entry);
    }
  }
  recent.append(activity);

  const advanced = document.createElement("details");
  advanced.className = "mcp-advanced";
  advanced.open = false;
  const advancedSummary = el("summary", "mcp-advanced-summary", t("settings.mcp.advanced"));
  const advancedBody = el("div", "mcp-advanced-body");
  const manual = section(t("settings.mcp.manual.sectionTitle"), t("settings.mcp.manual.description"));
  const configBlock = el("pre", "agent-control-code", state.agentControlManual?.toml || t("settings.mcp.manual.generating"));
  manual.append(configBlock, el("div", "section-actions"));
  manual.lastElementChild.append(button(t("settings.mcp.manual.copy"), copyAgentControlConfig));
  advancedBody.append(manual);
  advanced.append(advancedSummary, advancedBody);

  const errorMessage = state.agentControl?.error || control.error;
  if (errorMessage) {
    const error = el("div", "agent-control-error", errorMessage);
    error.setAttribute("role", "alert");
    root.append(error);
  }
  root.append(authorization, clientSection, examples, privacy, recent, advanced);
  return root;
}

function appearancePage() {
  const root = document.createDocumentFragment();
  root.append(templateSection());
  const pet = section(t("settings.appearance.pet.sectionTitle"), t("settings.appearance.pet.description"));
  const configuredSprite = state.settings.petSprite || DEFAULT_PET_SPRITE;
  const spriteOptions = [
    ["echo:little", t("settings.appearance.pet.echo")],
    [DEFAULT_PET_SPRITE, t("settings.appearance.pet.qianxue")],
    ["codex:codex-buddy", t("settings.appearance.pet.skyler")],
    ["orca.png", t("settings.appearance.pet.orca")]
  ];
  for (const codexPet of state.codexPets) {
    if (!spriteOptions.some(([value]) => value === codexPet.value)) {
      spriteOptions.push([codexPet.value, `${codexPet.displayName} · Codex V2`]);
    }
  }
  if (!spriteOptions.some(([value]) => value === configuredSprite)) {
    spriteOptions.push([configuredSprite, t("settings.appearance.currentValue", { value: configuredSprite })]);
  }
  const spriteSelect = select(configuredSprite, spriteOptions, value => save({ petSprite: value }), t("settings.appearance.pet.codexPet"));
  const sprite = document.createElement("input");
  sprite.type = "text";
  sprite.className = "text-input";
  sprite.value = configuredSprite;
  sprite.placeholder = t("settings.appearance.pet.spritePlaceholder");
  sprite.setAttribute("aria-label", t("settings.appearance.pet.spriteLabel"));
  sprite.addEventListener("change", () => save({ petSprite: sprite.value.trim() || DEFAULT_PET_SPRITE }));
  const scale = document.createElement("input");
  scale.type = "range"; scale.min = "0.6"; scale.max = "2"; scale.step = "0.1"; scale.value = state.settings.petScale || 1;
  const scaleValue = el("span", "range-value", `${Number(scale.value).toFixed(1)}×`);
  scale.addEventListener("input", () => scaleValue.textContent = `${Number(scale.value).toFixed(1)}×`);
  scale.addEventListener("change", () => save({ petScale: Number(scale.value) }));
  const scaleControl = el("div", "range-control"); scaleControl.append(scale, scaleValue);
  pet.append(
    row(t("settings.appearance.pet.preview.title"), t("settings.appearance.pet.preview.description"), button(t("settings.appearance.pet.preview.action"), () => api.togglePet?.())),
    row(t("settings.appearance.pet.scale.title"), t("settings.appearance.pet.scale.description"), scaleControl),
    row(t("settings.appearance.pet.codexPet"), t("settings.appearance.pet.codexDescription"), spriteSelect),
    row(t("settings.appearance.pet.custom.title"), t("settings.appearance.pet.custom.description"), sprite),
    row(t("settings.appearance.pet.assets.title"), t("settings.appearance.pet.assets.description"), button(t("common.openFolder"), () => api.openSpritesDir()))
  );
  const panel = section(t("settings.appearance.panel.sectionTitle"), t("settings.appearance.panel.description"));
  const heights = [["420", t("settings.appearance.panel.compact")], ["540", t("settings.appearance.panel.standard")], ["680", t("settings.appearance.panel.relaxed")]];
  panel.append(row(t("settings.appearance.panel.height.title"), t("settings.appearance.panel.height.description"), select(String(state.settings.panelMaxHeightPx || 540), heights, v => save({ panelMaxHeightPx: Number(v) }), t("settings.appearance.panel.height.label"))));
  root.append(islandBackgroundSection(), pet, panel);
  return root;
}

function templateSection() {
  const tpl = section(t("settings.appearance.template.sectionTitle"), t("settings.appearance.template.description"));
  const active = state.settings.appearanceTemplate || { id: "builtin:workisland-xiaoyu", version: "*" };
  const validTemplates = (state.templates.templates || []).filter(entry => entry.valid);
  const options = validTemplates.map(entry => [`${entry.id}@${entry.version}`, `${entry.name} · ${entry.id}${entry.modules.length ? `（${entry.modules.join("/")}）` : ""} · ${entry.license}`]);
  const activeKey = `${active.id}@${active.version}`;
  if (!options.some(([value]) => value === activeKey)) {
    options.unshift([activeKey, t("settings.appearance.currentValue", { value: `${active.id}@${active.version}` })]);
  }
  const templateSelect = select(activeKey, options, value => {
    const at = value.lastIndexOf("@");
    save({
      appearanceTemplate: { id: value.slice(0, at), version: value.slice(at + 1) }
    }).then(() => showToast(t("settings.appearance.template.changed")));
  }, t("settings.appearance.template.sectionTitle"));
  const reset = button(t("settings.appearance.template.restoreAction"), async () => {
    await save({
      appearanceTemplate: { id: "builtin:workisland-xiaoyu", version: "1.0.0" }
    });
    await loadTemplates();
    renderPage();
    showToast(t("settings.appearance.template.restored"));
  }, "secondary");
  tpl.append(
    row(t("settings.appearance.template.current.title"), t("settings.appearance.template.current.description"), templateSelect),
    row(t("settings.appearance.template.restore.title"), t("settings.appearance.template.restore.description"), reset),
    row(t("settings.appearance.template.ai.title"), t("settings.appearance.template.ai.description"), el("span", "range-value", t("settings.appearance.template.ai.badge")))
  );
  return tpl;
}

const ISLAND_APPEARANCE_PRESETS = [
  { id: "default", labelKey: "settings.appearance.background.preset.default", value: { kind: "default" } },
  { id: "deep-blue", labelKey: "settings.appearance.background.preset.blue", value: { kind: "solid", color: "#0B1E3A", opacity: 1 } },
  { id: "forest", labelKey: "settings.appearance.background.preset.green", value: { kind: "solid", color: "#0A231A", opacity: 1 } },
  { id: "night-purple", labelKey: "settings.appearance.background.preset.purple", value: { kind: "gradient", color: "#1F1330", color2: "#0B0716", angle: 135, opacity: 1 } },
  { id: "frost", labelKey: "settings.appearance.background.preset.graphite", value: { kind: "solid", color: "#0E0F13", opacity: 0.72 } }
];

const ISLAND_APPEARANCE_MATERIALS = [
  { id: "glass", titleKey: "settings.appearance.background.material.glass.title", descriptionKey: "settings.appearance.background.material.glass.description" },
  { id: "solid", titleKey: "settings.appearance.background.material.solid.title", descriptionKey: "settings.appearance.background.material.solid.description" },
  { id: "image", titleKey: "settings.appearance.background.material.image.title", descriptionKey: "settings.appearance.background.material.image.description" }
];

function appearanceMaterialCard(entry, active, action) {
  const { id } = entry;
  const card = document.createElement("button");
  card.type = "button";
  card.className = `appearance-material-card${active ? " is-active" : ""}`;
  card.classList.add("appearance-material-card");
  card.setAttribute("aria-pressed", String(active));
  card.addEventListener("click", action);
  const visual = el("span", `appearance-material-visual is-${id}`);
  const copy = el("span", "appearance-material-copy");
  copy.append(
    el("strong", "", t(entry.titleKey)),
    el("span", "", t(entry.descriptionKey))
  );
  card.append(visual, copy);
  return card;
}

async function chooseIslandBackgroundImage() {
  state.appearanceError = "";
  try {
    const selected = await api.selectIslandBackgroundImage();
    if (!selected) return;
    await showIslandBackgroundCropper(selected);
  } catch (error) {
    state.appearanceError = error?.message || t("settings.appearance.background.image.error");
    renderPage();
  }
}

function showIslandBackgroundCropper(selected) {
  return new Promise((resolve) => {
    const overlay = el("div", "appearance-crop-overlay");
    const card = el("div", "appearance-crop-card");
    const heading = el("div", "appearance-crop-heading");
    heading.append(el("h3", "", t("settings.appearance.background.crop.title")), el("p", "", t("settings.appearance.background.crop.description")));
    const stage = el("div", "appearance-crop-stage");
    const canvas = document.createElement("canvas");
    canvas.width = 1480;
    canvas.height = 600;
    canvas.setAttribute("aria-label", t("settings.appearance.background.crop.preview"));
    const sample = el("div", "appearance-crop-sample");
    sample.append(el("strong", "", "WorkIsland"), el("span", "", t("settings.appearance.background.crop.sample")));
    stage.append(canvas, sample);
    const zoom = document.createElement("input");
    zoom.type = "range"; zoom.min = "1"; zoom.max = "3"; zoom.step = "0.05"; zoom.value = "1";
    zoom.setAttribute("aria-label", t("settings.appearance.background.crop.zoom"));
    const zoomOut = button("−", () => setZoom(Number(zoom.value) - 0.1), "appearance-crop-zoom-button");
    zoomOut.setAttribute("aria-label", `${t("settings.appearance.background.crop.zoom")} −`);
    const zoomIn = button("+", () => setZoom(Number(zoom.value) + 0.1), "appearance-crop-zoom-button");
    zoomIn.setAttribute("aria-label", `${t("settings.appearance.background.crop.zoom")} +`);
    const zoomValue = el("span", "range-value", "100%");
    const zoomControl = el("div", "appearance-crop-zoom");
    zoomControl.append(el("span", "", t("settings.appearance.background.crop.zoom")), zoomOut, zoom, zoomIn, zoomValue);
    const actions = el("div", "appearance-crop-actions");
    const cancel = button(t("common.cancel"), () => close(false));
    const apply = button(t("settings.appearance.background.crop.apply"), async () => {
      apply.disabled = true;
      try {
        const installed = await api.installCroppedIslandBackground(canvas.toDataURL("image/png"));
        state.appearanceImagePreview = installed.dataUrl;
        state.appearanceImagePreviewRef = installed.imageRef;
        await save({ islandAppearance: { kind: "image", imageRef: installed.imageRef, imageDim: 0.35 } });
        close(true);
        renderPage();
      } catch (error) {
        apply.disabled = false;
        showToast(error?.message || t("settings.appearance.background.image.error"), true);
      }
    }, "primary");
    actions.append(cancel, apply);
    card.append(heading, stage, zoomControl, actions);
    overlay.append(card);
    document.body.append(overlay);

    const image = new Image();
    let panX = 0;
    let panY = 0;
    let drag = null;
    const draw = () => {
      const crop = coverCrop(image, canvas, Number(zoom.value), panX, panY);
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
    };
    const setZoom = (value) => {
      zoom.value = String(Math.min(Number(zoom.max), Math.max(Number(zoom.min), value)));
      zoomValue.textContent = `${Math.round(Number(zoom.value) * 100)}%`;
      draw();
    };
    const close = (applied) => {
      overlay.remove();
      resolve(applied);
    };
    zoom.addEventListener("input", () => {
      setZoom(Number(zoom.value));
    });
    canvas.addEventListener("pointerdown", (event) => {
      drag = { x: event.clientX, y: event.clientY, panX, panY };
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("is-dragging");
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!drag) return;
      panX = Math.min(1, Math.max(-1, drag.panX - (event.clientX - drag.x) / 180));
      panY = Math.min(1, Math.max(-1, drag.panY - (event.clientY - drag.y) / 120));
      draw();
    });
    const endDrag = () => { drag = null; canvas.classList.remove("is-dragging"); };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    overlay.addEventListener("keydown", (event) => { if (event.key === "Escape") close(false); });
    image.onload = draw;
    image.onerror = () => close(false);
    image.src = selected.dataUrl;
    cancel.focus();
  });
}

async function loadIslandBackgroundPreview(imageRef) {
  state.appearanceImagePreviewRef = imageRef;
  try {
    state.appearanceImagePreview = await api.getIslandBackgroundImage(imageRef);
  } catch {
    state.appearanceImagePreview = null;
  }
  if (state.activeTab === "appearance" && state.settings?.islandAppearance?.imageRef === imageRef) renderPage();
}

function islandBackgroundSection() {
  const island = section(t("settings.appearance.background.sectionTitle"), t("settings.appearance.background.description"));
  const current = state.settings.islandAppearance || { kind: "default" };
  const material = materialForAppearance(current);
  const materials = el("div", "appearance-materials");
  for (const entry of ISLAND_APPEARANCE_MATERIALS) {
    const { id } = entry;
    materials.append(appearanceMaterialCard(entry, material === id, async () => {
      if (id === "image") {
        if (current.kind !== "image") await chooseIslandBackgroundImage();
        return;
      }
      if (material === id && current.kind !== "default" && current.kind !== "gradient") return;
      await save({ islandAppearance: appearanceForMaterial(current, id) });
      renderPage();
    }));
  }
  island.append(materials);

  if (material === "image") {
    if (current.imageRef && state.appearanceImagePreviewRef !== current.imageRef) {
      void loadIslandBackgroundPreview(current.imageRef);
    }
    const imageControl = el("div", "appearance-image-control");
    const preview = el("div", "appearance-image-preview");
    preview.setAttribute("role", "img");
    preview.setAttribute("aria-label", t("settings.appearance.background.image.preview"));
    if (state.appearanceImagePreview) preview.style.backgroundImage = `url("${state.appearanceImagePreview}")`;
    else preview.classList.add("is-empty");
    imageControl.append(preview, button(t("settings.appearance.background.image.choose"), chooseIslandBackgroundImage));
    const dim = document.createElement("input");
    dim.type = "range"; dim.min = "0.2"; dim.max = "0.85"; dim.step = "0.05";
    dim.value = String(current.imageDim ?? 0.4);
    dim.setAttribute("aria-label", t("settings.appearance.background.image.dim.title"));
    const dimValue = el("span", "range-value", `${Math.round(Number(dim.value) * 100)}%`);
    dim.addEventListener("input", () => dimValue.textContent = `${Math.round(Number(dim.value) * 100)}%`);
    dim.addEventListener("change", () => save({ islandAppearance: { ...current, imageDim: Number(dim.value) } }));
    const dimControl = el("div", "range-control"); dimControl.append(dim, dimValue);
    island.append(
      row(t("settings.appearance.background.image.title"), t("settings.appearance.background.image.description"), imageControl),
      row(t("settings.appearance.background.image.dim.title"), t("settings.appearance.background.image.dim.description"), dimControl)
    );
    if (state.appearanceError) island.append(el("p", "appearance-inline-error", state.appearanceError));
    island.append(row(t("settings.appearance.background.restore.title"), t("settings.appearance.background.restore.description"), button(t("settings.appearance.background.restore.action"), async () => { await save({ islandAppearance: { kind: "default" } }); renderPage(); }, "secondary")));
    return island;
  }

  const matchingPreset = ISLAND_APPEARANCE_PRESETS.find(
    preset => JSON.stringify(preset.value) === JSON.stringify(current)
  );
  const presetOptions = ISLAND_APPEARANCE_PRESETS.map(preset => [preset.id, t(preset.labelKey)]);
  if (!matchingPreset) {
    const kindLabel = t(`settings.appearance.background.kind.${current.kind === "gradient" ? "gradient" : current.kind === "glass" ? "glass" : current.kind === "image" ? "image" : "solid"}`);
    presetOptions.push(["__custom__", t("settings.appearance.background.customCurrent", { kind: kindLabel })]);
  }
  const presetSelect = select(
    matchingPreset ? matchingPreset.id : "__custom__",
    presetOptions,
    async value => {
      const preset = ISLAND_APPEARANCE_PRESETS.find(entry => entry.id === value);
      if (preset) {
        await save({ islandAppearance: preset.value });
        renderPage();
      }
    },
    t("settings.appearance.background.presetLabel")
  );
  const color = document.createElement("input");
  color.type = "color";
  color.className = "color-input";
  color.value = /^#[0-9a-fA-F]{6}$/.test(current.color || "") ? current.color : "#000000";
  color.setAttribute("aria-label", t("settings.appearance.background.colorLabel"));
  color.addEventListener("change", async () => {
    await save({ islandAppearance: withAppearanceColor(current, color.value) });
    renderPage();
  });
  const opacity = document.createElement("input");
  opacity.type = "range"; opacity.min = "0"; opacity.max = "1"; opacity.step = "0.05";
  opacity.value = String(current.opacity ?? 1);
  opacity.setAttribute("aria-label", t("settings.appearance.background.opacity.title"));
  const opacityValue = el("span", "range-value", `${Math.round(Number(opacity.value) * 100)}%`);
  opacity.addEventListener("input", () => opacityValue.textContent = `${Math.round(Number(opacity.value) * 100)}%`);
  opacity.addEventListener("change", () => save({ islandAppearance: withAppearanceOpacity(current, Number(opacity.value)) }));
  const opacityControl = el("div", "range-control"); opacityControl.append(opacity, opacityValue);
  island.append(
    ...(material === "solid" ? [row(t("settings.appearance.background.preset.title"), t("settings.appearance.background.preset.description"), presetSelect)] : []),
    row(t("settings.appearance.background.color.title"), t(material === "glass" ? "settings.appearance.background.color.glassDescription" : "settings.appearance.background.color.description"), color),
    row(t("settings.appearance.background.opacity.title"), t("settings.appearance.background.opacity.description"), opacityControl),
    row(t("settings.appearance.background.restore.title"), t("settings.appearance.background.restore.description"), button(t("settings.appearance.background.restore.action"), async () => { await save({ islandAppearance: { kind: "default" } }); renderPage(); }, "secondary"))
  );
  return island;
}

function soundPage() {
  const root = document.createDocumentFragment();
  const sound = state.settings.sound || {};
  const main = section(t("settings.sound.sectionTitle"), t("settings.sound.description"));
  const volume = document.createElement("input");
  volume.type = "range"; volume.min = "0"; volume.max = "100"; volume.value = sound.volume ?? 50;
  const volumeValue = el("span", "range-value", `${volume.value}%`);
  volume.addEventListener("input", () => volumeValue.textContent = `${volume.value}%`);
  volume.addEventListener("change", () => save({ sound: { ...sound, volume: Number(volume.value) } }));
  const volumeControl = el("div", "range-control"); volumeControl.append(volume, volumeValue);
  main.append(
    row(t("settings.sound.enable.title"), t("settings.sound.enable.description"), toggle(sound.enabled, v => save({ sound: { ...sound, enabled: v } }), t("settings.sound.enable.title"))),
    row(t("settings.sound.volume.title"), t("settings.sound.volume.description"), volumeControl),
    row(t("settings.sound.custom.title"), t("settings.sound.custom.description"), button(t("common.openFolder"), () => api.openSoundsDir()))
  );
  const bark = state.settings.barkPush || { enabled: false, url: "", events: {} };
  const barkSection = section(t("settings.sound.bark.sectionTitle"), t("settings.sound.bark.description"));
  const barkUrl = document.createElement("input");
  barkUrl.className = "text-input";
  barkUrl.placeholder = t("settings.sound.bark.placeholder");
  barkUrl.value = bark.url || "";
  barkUrl.setAttribute("aria-label", t("settings.sound.bark.urlLabel"));
  barkUrl.addEventListener("change", () => save({ barkPush: { ...bark, url: barkUrl.value.trim() } }));
  barkSection.append(
    row(t("settings.sound.bark.enable.title"), t("settings.sound.bark.enable.description"), toggle(bark.enabled, v => save({ barkPush: { ...bark, enabled: v } }), t("settings.sound.bark.enable.label"))),
    row(t("settings.sound.bark.url.title"), t("settings.sound.bark.url.description"), barkUrl)
  );
  const quiet = state.settings.quietHours || { enabled: false, start: "22:00", end: "08:00", suppressOnLockScreen: true };
  const quietSection = section(t("settings.sound.quiet.sectionTitle"), t("settings.sound.quiet.description"));
  const quietTimeInput = (key, label) => {
    const input = document.createElement("input");
    input.type = "time";
    input.className = "text-input";
    input.value = quiet[key] || "";
    input.setAttribute("aria-label", label);
    input.addEventListener("change", () => save({ quietHours: { ...quiet, [key]: input.value } }));
    return input;
  };
  const quietRange = el("div", "inline-controls");
  quietRange.append(quietTimeInput("start", t("settings.sound.quiet.startLabel")), quietTimeInput("end", t("settings.sound.quiet.endLabel")));
  quietSection.append(
    row(t("settings.sound.quiet.enable.title"), t("settings.sound.quiet.enable.description"), toggle(quiet.enabled, v => save({ quietHours: { ...quiet, enabled: v } }), t("settings.sound.quiet.enable.title"))),
    row(t("settings.sound.quiet.range.title"), t("settings.sound.quiet.range.description"), quietRange),
    row(t("settings.sound.quiet.lock.title"), t("settings.sound.quiet.lock.description"), toggle(quiet.suppressOnLockScreen, v => save({ quietHours: { ...quiet, suppressOnLockScreen: v } }), t("settings.sound.quiet.lock.title")))
  );
  root.append(main, barkSection, quietSection);
  return root;
}

function aboutPage() {
  const root = document.createDocumentFragment();
  const about = section(t("settings.about.sectionTitle"), t("settings.about.description"));
  const version = el("div", "about-card");
  const appMark = el("img", "app-mark");
  appMark.src = WORKISLAND_ICON_URL;
  appMark.alt = "";
  appMark.draggable = false;
  version.append(appMark, el("div", "about-copy", t("settings.about.loadingVersion")));
  api.getAppVersion().then(v => version.querySelector(".about-copy").textContent = t("settings.about.version", { version: v })).catch(() => {});
  about.append(version);
  const support = section(t("settings.about.support.sectionTitle"), t("settings.about.support.description"));
  support.append(
    row(t("settings.about.support.guide.title"), t("settings.about.support.guide.description"), button(t("settings.about.support.guide.action"), () => api.openExternal(USER_GUIDE_URL), "primary")),
    row(t("settings.about.support.feedback.title"), t("settings.about.support.feedback.description"), (() => { const group = el("div", "setting-actions-group"); group.append(button(t("settings.feedback.title"), () => openComplaintBox(), "primary"), button(t("settings.about.support.feedback.action"), () => api.openExternal(FEEDBACK_URL))); return group; })()),
    row(t("settings.about.support.community.title"), t("settings.about.support.community.description"), button(t("settings.about.support.community.action"), () => api.openExternal(COMMUNITY_URL)))
  );
  const updates = section(t("settings.about.update.sectionTitle"), t("settings.about.update.description"));
  const updateStatus = el("div", "update-status", state.latestUpdate ? t("update.availableVersion", { version: state.latestUpdate.latestVersion }) : t("settings.about.update.notChecked"));
  let latestUrl = state.latestUpdate?.releaseUrl || "";
  const openButton = button(t("settings.about.update.openDownloads"), () => {
    if (latestUrl) api.openExternal(latestUrl);
  });
  openButton.hidden = !latestUrl;
  const checkButton = button(t("settings.about.update.check"), async () => {
    checkButton.disabled = true;
    updateStatus.textContent = t("settings.about.update.checking");
    try {
      const result = await api.checkForUpdates();
      if (result?.status === "update-available") {
        state.latestUpdate = result;
        latestUrl = result.releaseUrl || "";
        openButton.hidden = !latestUrl;
        updateStatus.textContent = t("update.availableVersion", { version: result.latestVersion });
      } else if (result?.status === "up-to-date") {
        updateStatus.textContent = t("settings.about.update.current", { version: result.currentVersion });
      } else if (result?.status === "disabled") {
        updateStatus.textContent = t("settings.about.update.disabledDev");
      } else {
        updateStatus.textContent = result?.message || t("settings.about.update.unavailable");
      }
    } catch (error) {
      updateStatus.textContent = error?.message || t("settings.about.update.unavailable");
    } finally {
      checkButton.disabled = false;
    }
  });
  const formatMb = bytes => `${(Math.max(0, Number(bytes) || 0) / 1048576).toFixed(1)} MB`;
  const installButton = button(t("update.action.download"), async () => {
    const phase = state.updateState?.phase || "idle";
    try {
      installButton.disabled = true;
      if (phase === "ready") await api.installUpdate();
      else await api.downloadUpdate();
    } catch (error) {
      updateStatus.textContent = error?.message || t("settings.about.update.operationFailed");
    } finally {
      syncUpdateStateControls();
    }
  });
  const syncUpdateStateControls = () => {
    const snapshot = state.updateState;
    const phase = snapshot?.phase || "idle";
    const hasUpdate = Boolean(state.latestUpdate);
    installButton.hidden = !(hasUpdate || ["downloading", "ready", "installing", "manual", "error"].includes(phase));
    if (phase === "downloading") {
      const pct = snapshot?.progress?.pct ?? 0;
      installButton.textContent = t("settings.about.update.downloadingPercent", { percent: pct });
      updateStatus.textContent = t("settings.about.update.downloadingStatus", { percent: pct, progress: `${formatMb(snapshot?.progress?.received)}${snapshot?.progress?.total ? ` / ${formatMb(snapshot.progress.total)}` : ""}` });
    } else if (phase === "ready") {
      installButton.textContent = t("update.action.install");
      installButton.disabled = false;
      updateStatus.textContent = t("settings.about.update.readyStatus");
    } else if (phase === "installing") {
      installButton.textContent = t("settings.about.update.installing");
      updateStatus.textContent = t("settings.about.update.installingStatus");
    } else if (phase === "manual") {
      installButton.textContent = t("update.badge.manual");
      updateStatus.textContent = snapshot?.error || t("settings.about.update.manualStatus");
    } else if (phase === "error") {
      installButton.textContent = t("update.action.retry");
      installButton.disabled = false;
      updateStatus.textContent = snapshot?.error || t("update.status.error");
    } else {
      installButton.textContent = t("update.action.download");
      installButton.disabled = false;
      if (hasUpdate) updateStatus.textContent = t("update.availableVersion", { version: state.latestUpdate.latestVersion });
    }
  };
  state.onUpdateStateUi = syncUpdateStateControls;
  syncUpdateStateControls();
  const updateControls = el("div", "inline-controls");
  updateControls.append(updateStatus, checkButton, installButton, openButton);
  updates.append(
    row(t("settings.about.update.auto.title"), t("settings.about.update.auto.description"), toggle(state.settings.updateChecksEnabled, v => save({ updateChecksEnabled: v }), t("settings.about.update.auto.title"))),
    row(t("settings.about.update.versionCheck.title"), t("settings.about.update.versionCheck.description"), updateControls)
  );
  const diagnostics = section(t("settings.about.diagnostics.sectionTitle"), t("settings.about.diagnostics.description"));
  const actions = el("div", "section-actions");
  actions.append(button(t("settings.about.diagnostics.export"), async () => { const path = await api.collectLogs(); showToast(t(path ? "settings.about.diagnostics.exported" : "settings.about.diagnostics.complete")); }));
  diagnostics.append(actions);
  const privacy = section(t("settings.about.telemetry.sectionTitle"), t("settings.about.telemetry.description"));
  const telemetryStatus = state.telemetryStatus;
  const statusText = !telemetryStatus
    ? t("settings.about.telemetry.loading")
    : telemetryStatus.status === "disabled"
      ? t("settings.about.telemetry.disabled")
      : telemetryStatus.status === "development"
        ? t("settings.about.telemetry.development")
        : telemetryStatus.status === "not-configured"
          ? t("settings.about.telemetry.notConfigured")
          : telemetryStatus.lastSuccessAt
            ? t("settings.about.telemetry.lastSuccess", { time: new Date(telemetryStatus.lastSuccessAt).toLocaleString(), count: telemetryStatus.pendingEventCount })
            : t("settings.about.telemetry.awaiting", { count: telemetryStatus.pendingEventCount });
  privacy.append(
    row(
      t("settings.about.telemetry.enable.title"),
      t("settings.about.telemetry.enable.description"),
      toggle(state.settings.telemetryEnabled, v => save({ telemetryEnabled: v }), t("settings.about.telemetry.enable.title"))
    ),
    row(t("settings.about.telemetry.status.title"), t("settings.about.telemetry.status.description"), el("div", "setting-description", statusText))
  );
  const devApi = state.settings.developerApi || { enabled: false, port: 9938, token: "" };
  const devSection = section(t("settings.about.developer.sectionTitle"), t("settings.about.developer.description"));
  const devToken = document.createElement("input");
  devToken.className = "text-input";
  devToken.placeholder = t("settings.about.developer.tokenPlaceholder");
  devToken.value = devApi.token || "";
  devToken.setAttribute("aria-label", t("settings.about.developer.tokenLabel"));
  devToken.addEventListener("change", () => save({ developerApi: { ...devApi, token: devToken.value.trim() } }));
  devSection.append(
    row(t("settings.about.developer.enable.title"), t("settings.about.developer.enable.description", { port: devApi.port || 9938 }), toggle(devApi.enabled, v => save({ developerApi: { ...devApi, enabled: v } }), t("settings.about.developer.enable.label"))),
    row(t("settings.about.developer.token.title"), t("settings.about.developer.token.description"), devToken)
  );
  root.append(about, support, privacy, updates, devSection, diagnostics);
  return root;
}

const PAGES = { general: generalPage, agents: agentsPage, remote: remotePage, appearance: appearancePage, sound: soundPage, "mcp": mcpPage, about: aboutPage };

function renderPage() {
  const content = document.querySelector("#content");
  content.replaceChildren(PAGES[state.activeTab]());
  document.querySelectorAll(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.tab === state.activeTab));
}

function showToast(message, error = false) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.className = `toast visible${error ? " error" : ""}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.className = "toast", 2800);
}

async function start() {
  if (!api) throw new Error("settingsApi unavailable");
  await initializeI18n(api);
  localizeStaticShell();
  state.settings = await api.getSettings();
  try { state.shareProviders = await api.getShelfShareProviders?.() || []; } catch { state.shareProviders = []; }
  await loadTelemetryStatus();
  await loadDisplays();
  await loadCodexPets();
  await loadAgentControlStatus();
  await loadRemoteHosts();
  await loadTemplates();
  document.querySelectorAll(".nav-item").forEach(item => item.addEventListener("click", () => {
    state.activeTab = item.dataset.tab;
    renderPage();
    if (state.activeTab === "agents") {
      refreshAgents().catch(error => showToast(error.message, true));
      loadRemoteHosts(true).catch(error => showToast(error.message, true));
    }
    if (state.activeTab === "remote") {
      loadRemoteHosts(true).catch(error => showToast(error.message, true));
      loadRemoteSsh().catch(() => {});
    }
    if (state.activeTab === "mcp") loadAgentControlStatus(true).catch(() => {});
  }));
  api.onNavigateToTab?.(tab => {
    const aliases = { hooks: "agents", pet: "appearance", display: "general", "agent-control": "mcp" };
    const next = aliases[tab] || tab;
    if (PAGES[next]) { state.activeTab = next; renderPage(); }
  });
  api.onUpdateAvailable?.(update => {
    state.latestUpdate = update;
    if (state.activeTab === "about") renderPage();
  });
  try { state.updateState = await api.getUpdateState?.() || null; } catch { state.updateState = null; }
  api.onUpdateState?.(snapshot => {
    state.updateState = snapshot;
    // 下载进度回调频率较高，只刷新关于页的更新控件，不整页重绘。
    state.onUpdateStateUi?.();
  });
  api.onSettingsChanged?.(settings => { state.settings = settings; renderPage(); });
  onLocaleChange(() => {
    localizeStaticShell();
    if (state.settings) renderPage();
  });
  renderPage();
  refreshAgents().catch(() => {});
  setInterval(() => {
    if (state.activeTab === "agents") refreshAgents().catch(() => {});
    if (state.activeTab === "mcp") loadAgentControlStatus(true).catch(() => {});
  }, AGENT_STATUS_REFRESH_INTERVAL_MS);
}

start().catch(error => {
  document.querySelector("#content").textContent = t("settings.error.loadFailed", { error: error.message });
});
