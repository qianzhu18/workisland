"use strict";

import { getLanguagePreference, initializeI18n, onLocaleChange, setLanguagePreference, t } from "./shared/i18n.js";

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
const VERIFY_ON_REAL_EVENT_AGENT_IDS = new Set(["dsh", "trae"]);
const state = { settings: null, statuses: new Map(), doctorSummary: null, displays: [], codexPets: [], templates: { active: null, templates: [] }, shareProviders: [], activeTab: "general", busy: new Set(), expandedSettingDetails: new Set(), latestUpdate: null, updateState: null, onUpdateStateUi: null, telemetryStatus: null, agentControl: null, agentControlManual: null, commandDraft: { name: "", command: "" }, remoteHosts: null, remotePairing: null };

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
  const expanded = state.expandedSettingDetails.has(id);
  const card = el("div", `feature-settings-card${expanded ? " is-expanded" : ""}`);
  const actions = el("div", "feature-settings-actions");
  const disclosure = button(expanded ? t("common.collapse") : t("settings.common.details"), () => {
    if (expanded) state.expandedSettingDetails.delete(id);
    else state.expandedSettingDetails.add(id);
    renderPage();
  });
  const detailId = `feature-settings-${id}`;
  disclosure.classList.add("feature-settings-disclosure");
  disclosure.setAttribute("aria-expanded", String(expanded));
  disclosure.setAttribute("aria-controls", detailId);
  disclosure.setAttribute("aria-label", t(expanded ? "settings.common.collapseDetails" : "settings.common.expandDetails", { title }));
  actions.append(control, disclosure);
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
    )
  );
  const behavior = section(t("settings.general.behavior.sectionTitle"), t("settings.general.behavior.description"));
  behavior.append(
    row(t("settings.general.behavior.launchAtLogin.title"), t("settings.general.behavior.launchAtLogin.description"), toggle(state.settings.launchAtLogin, v => save({ launchAtLogin: v }), t("settings.general.behavior.launchAtLogin.title"))),
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
  const detail = repairNeeded && diagnosis.reasons?.length
    ? diagnosis.reasons[0]
    : verifyOnRealEvent && report.installed && report.connectionState !== "verified"
    ? (issues[0] || t("settings.agents.awaitingEvent"))
    : report.available === false && !report.installed
    ? t("settings.agents.notDetectedHint", { agent: label })
    : issues.length ? issues[0] : report.description;
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

// PRD-016 / ADR-0005 远程接入（observe-only）：令牌、主机列表与撤销。
function remoteHostsSection() {
  const remote = state.remoteHosts;
  const cfg = state.settings.remoteAccess || { enabled: false, port: 7878 };
  const node = section(t("settings.remote.sectionTitle"), t("settings.remote.description"));
  node.append(row(t("settings.remote.enable.title"), t("settings.remote.enable.description"), toggle(remote?.enabled ?? cfg.enabled, async v => {
    await save({ remoteAccess: { ...cfg, enabled: v } });
    await loadRemoteHosts();
    renderPage();
  }, t("settings.remote.enable.title"))));
  if (!remote) {
    node.append(el("div", "setting-description", t("settings.remote.unavailable")));
    return node;
  }
  if (remote.enabled && !remote.listener?.running) {
    node.append(el("div", "doctor-summary", remote.listener?.lastError === "PORT_IN_USE" ? t("settings.remote.portInUse", { port: remote.listener?.port ?? cfg.port }) : t("settings.remote.notRunning")));
  }
  const tokenArea = el("div", "inline-controls");
  tokenArea.append(button(t("settings.remote.generateToken"), async () => {
    try {
      state.remotePairing = await api.createRemotePairingToken();
      renderPage();
    } catch (error) {
      showToast(error?.message || t("settings.remote.tokenFailed"), true);
    }
  }, "primary"));
  if (state.remotePairing?.token) {
    const expires = new Date(state.remotePairing.expiresAt).toLocaleTimeString();
    const tokenBox = el("code", "remote-token-box", state.remotePairing.token);
    tokenArea.append(tokenBox, button(t("common.copy"), () => copyText(state.remotePairing.token, t("settings.remote.token"))));
    node.append(el("div", "setting-description", t("settings.remote.tokenHint", { prefix: state.remotePairing.token.slice(0, 4), expires })));
  }
  node.append(row(t("settings.remote.pairing.title"), t("settings.remote.pairing.description"), tokenArea));
  const list = el("div", "agent-list");
  for (const host of remote.hosts || []) {
    const pairedAt = host.pairedAt ? new Date(host.pairedAt).toLocaleString() : "";
    const online = (remote.listener?.connectedHosts || []).includes(host.hostId);
    const card = el("div", "remote-host-card");
    const content = el("div", "remote-host-copy");
    content.append(el("div", "remote-host-name", host.displayName));
    content.append(el("div", "remote-host-detail", t("settings.remote.hostDetail", { status: online ? t("settings.agents.status.connected") : t("settings.agents.status.disconnected"), time: pairedAt })));
    const revoke = button(t("settings.remote.revoke"), async () => {
      if (!window.confirm(t("settings.remote.revokeConfirm", { host: host.displayName }))) return;
      try {
        await api.revokeRemoteHost(host.hostId);
        state.remotePairing = null;
        await loadRemoteHosts();
        renderPage();
        showToast(t("settings.remote.revoked"));
      } catch (error) {
        showToast(error?.message || t("settings.remote.revokeFailed"), true);
      }
    }, "danger");
    card.append(content, revoke);
    list.append(card);
  }
  if ((remote.hosts || []).length === 0) {
    list.append(el("div", "setting-description", t("settings.remote.empty")));
  }
  node.append(list);
  return node;
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
  for (const report of state.statuses.values()) grid.append(agentCard(report));
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
  root.append(remoteHostsSection());
  return root;
}

async function changeAgentControlClient(connect, action) {
  if (state.busy.has("agent-control-codex")) return;
  state.busy.add("agent-control-codex");
  action.disabled = true;
  action.textContent = connect ? "连接中…" : "移除中…";
  try {
    if (connect) await api.connectAgentControlClient("codex");
    else await api.disconnectAgentControlClient("codex");
    await loadAgentControlStatus();
    renderPage();
    showToast(connect ? "Codex 配置已写入；重开会话后即可调用" : "已移除 WorkIsland MCP 配置");
  } catch (error) {
    state.agentControl = { ...(state.agentControl || {}), error: error?.message || "配置失败" };
    renderPage();
    showToast(error?.message || "配置失败", true);
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
  const authorization = section("MCP 服务", "默认关闭。开启后，已配置的本机 MCP 客户端可以调用 WorkIsland 明确开放的安全工具。");
  authorization.append(row(
    "启用 WorkIsland MCP",
    "这是总开关；仅开启它不会自动连接任何智能体。关闭后，已经配置的客户端也会立即被拒绝。",
    toggle(enabled, async value => {
      await save({ localAgentControlEnabled: value });
      await loadAgentControlStatus();
      renderPage();
    }, "启用 WorkIsland MCP")
  ));

  const clientSection = section("连接智能体", "连接会备份 Codex 配置，添加 WorkIsland 条目，并开启当前 Codex 版本加载本机 MCP 所需的兼容开关。配置成功不等于已经调用成功。");
  const client = control.client;
  if (client) {
    const card = el("div", "agent-control-client");
    const copy = el("div", "agent-content");
    const heading = el("div", "agent-heading");
    const stateText = client.connectionState === "connected"
      ? "已连接"
      : client.connectionState === "configured"
        ? "已配置，等待首次调用"
        : client.installed ? "已检测，尚未配置" : "未检测到客户端";
    const badgeClass = client.connectionState === "connected" ? "installed" : client.configured ? "pending" : "missing";
    heading.append(el("strong", "", client.label || "Codex"), el("span", `status ${badgeClass}`, stateText));
    copy.append(
      heading,
      el("div", "agent-detail", client.configured
        ? `配置位置：${client.configPath}`
        : "开启总开关后点击“连接 Codex”；已打开的 Codex 会话需要重开一次才能发现新工具。")
    );
    const action = button(client.configured ? "移除" : "连接 Codex", () => changeAgentControlClient(!client.configured, action), client.configured ? "secondary" : "primary");
    action.disabled = state.busy.has("agent-control-codex") || (!client.configured && (!enabled || !client.installed));
    card.append(copy, action);
    clientSection.append(card);
  } else {
    clientSection.append(el("div", "agent-control-empty", "正在检测 Codex…"));
  }

  const examples = section("你可以这样问", "连接后，智能体可以先理解 WorkIsland 的功能和当前观察到的状态，再回答你的问题。");
  const exampleList = el("div", "mcp-example-list");
  for (const question of [
    "灵动岛有哪些扩展功能？",
    "现在有哪些智能体正在运行？",
    "有没有智能体在等我处理？",
    "为什么性能监控没有显示进程详情？",
    "WorkIsland 支持哪些智能体，哪些已经连接成功？",
    "文件架和剪贴板历史有什么区别？"
  ]) {
    const example = button(question, async () => {
      await navigator.clipboard.writeText(question);
      showToast("问题已复制，可以发给你的智能体");
    }, "mcp-example");
    example.setAttribute("aria-label", `复制问题：${question}`);
    exampleList.append(example);
  }
  examples.append(exampleList);

  const privacy = section("权限与隐私", "MCP 只开放为 WorkIsland 专门设计的工具，不把本机进程或原始应用数据直接交给智能体。");
  privacy.append(
    row("可以读取", "产品功能说明、公开设置，以及 WorkIsland 当前观察到的智能体状态和集成状态。", el("span", "status installed", "只读")),
    row("不会读取", "提示词、回答内容、文件路径、进程 ID、终端内容或系统中的完整进程列表。", el("span", "status installed", "受保护")),
    row("修改设置", "只有你明确要求时才会执行；修改会留下最近活动，并提供撤销入口。", el("span", "status pending", "需确认意图"))
  );

  const recent = section("最近活动", "只记录客户端、工具名、允许的设置键与结果；不保存提示词、会话内容、路径或终端信息。");
  const activity = el("div", "agent-control-activity");
  if (!Array.isArray(control.activity) || control.activity.length === 0) {
    activity.append(el("div", "agent-control-empty", "还没有 MCP 调用。首次真实调用后，这里会出现记录并显示“已连接”。"));
  } else {
    for (const item of control.activity) {
      const entry = el("div", "agent-control-activity-row");
      const title = `${item.client || "本机客户端"} · ${item.tool || "调用"}`;
      const details = [item.result === "success" ? "成功" : item.errorCode || "已拒绝"];
      if (Array.isArray(item.keys) && item.keys.length) details.push(item.keys.join("、"));
      if (Number.isFinite(item.timestamp)) details.push(new Date(item.timestamp).toLocaleString());
      entry.append(el("strong", "", title), el("span", "", details.join(" · ")));
      activity.append(entry);
    }
  }
  recent.append(activity);

  const advanced = document.createElement("details");
  advanced.className = "mcp-advanced";
  advanced.open = false;
  const advancedSummary = el("summary", "mcp-advanced-summary", "高级设置");
  const advancedBody = el("div", "mcp-advanced-body");
  const manual = section("手动配置", "其他支持本机 stdio MCP 的客户端，可按其说明使用同一命令。WorkIsland 不会自动改动尚未验证的客户端配置。");
  const configBlock = el("pre", "agent-control-code", state.agentControlManual?.toml || "正在生成配置…");
  manual.append(configBlock, el("div", "section-actions"));
  manual.lastElementChild.append(button("复制配置", copyAgentControlConfig));
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
  const pet = section("桌宠", "桌宠与 Island 使用同一套会话状态，切换不会中断监控。");
  const configuredSprite = state.settings.petSprite || DEFAULT_PET_SPRITE;
  const spriteOptions = [
    ["echo:little", "Echo · 程序化动画"],
    [DEFAULT_PET_SPRITE, "千雪 · 内置 Codex V2"],
    ["codex:codex-buddy", "宝剑 Skyler · 内置 Codex V2"],
    ["orca.png", "Orca · 兼容素材"]
  ];
  for (const codexPet of state.codexPets) {
    if (!spriteOptions.some(([value]) => value === codexPet.value)) {
      spriteOptions.push([codexPet.value, `${codexPet.displayName} · Codex V2`]);
    }
  }
  if (!spriteOptions.some(([value]) => value === configuredSprite)) {
    spriteOptions.push([configuredSprite, `${configuredSprite} · 当前设置`]);
  }
  const spriteSelect = select(configuredSprite, spriteOptions, value => save({ petSprite: value }), "Codex 桌宠");
  const sprite = document.createElement("input");
  sprite.type = "text";
  sprite.className = "text-input";
  sprite.value = configuredSprite;
  sprite.placeholder = "codex:qianxue、orca.png 或其他 PNG/WebP";
  sprite.setAttribute("aria-label", "桌宠精灵素材标识");
  sprite.addEventListener("change", () => save({ petSprite: sprite.value.trim() || DEFAULT_PET_SPRITE }));
  const scale = document.createElement("input");
  scale.type = "range"; scale.min = "0.6"; scale.max = "2"; scale.step = "0.1"; scale.value = state.settings.petScale || 1;
  const scaleValue = el("span", "range-value", `${Number(scale.value).toFixed(1)}×`);
  scale.addEventListener("input", () => scaleValue.textContent = `${Number(scale.value).toFixed(1)}×`);
  scale.addEventListener("change", () => save({ petScale: Number(scale.value) }));
  const scaleControl = el("div", "range-control"); scaleControl.append(scale, scaleValue);
  pet.append(
    row("桌宠预览", "在当前显示器中央显示桌宠；再次点击可收起。", button("显示 / 隐藏桌宠", () => api.togglePet?.())),
    row("桌宠缩放", "调整桌宠在屏幕上的显示尺寸。", scaleControl),
    row("Codex 桌宠", "默认使用内置千雪；也可切换本机 ~/.codex/pets 中的其他 V2 桌宠，运行中的桌宠会实时换图。", spriteSelect),
    row("自定义素材标识", "支持 codex:<名称>，或填写本地 pet-sprites 目录中的 PNG/WebP 文件名。", sprite),
    row("精灵素材", "打开目录后可替换 PNG 桌宠素材。", button("打开目录", () => api.openSpritesDir()))
  );
  const panel = section("面板", "限制展开面板的高度，避免遮挡主要工作区。");
  const heights = [["420", "紧凑 · 420 px"], ["540", "标准 · 540 px"], ["680", "宽松 · 680 px"]];
  panel.append(row("最大高度", "修改后下一次展开生效。", select(String(state.settings.panelMaxHeightPx || 540), heights, v => save({ panelMaxHeightPx: Number(v) }), "面板最大高度")));
  root.append(islandBackgroundSection(), pet, panel);
  return root;
}

function templateSection() {
  const tpl = section("外观模板", "以模板为单位更换 Island 的状态角色、背景与桌宠；本机 AI Agent 可通过 workisland-template Skill 完成同样的流程。");
  const active = state.settings.appearanceTemplate || { id: "builtin:workisland-xiaoyu", version: "*" };
  const validTemplates = (state.templates.templates || []).filter(entry => entry.valid);
  const options = validTemplates.map(entry => [`${entry.id}@${entry.version}`, `${entry.name} · ${entry.id}${entry.modules.length ? `（${entry.modules.join("/")}）` : ""} · ${entry.license}`]);
  const activeKey = `${active.id}@${active.version}`;
  if (!options.some(([value]) => value === activeKey)) {
    options.unshift([activeKey, `${active.id}@${active.version} · 当前设置`]);
  }
  const templateSelect = select(activeKey, options, value => {
    const at = value.lastIndexOf("@");
    save({
      appearanceTemplate: { id: value.slice(0, at), version: value.slice(at + 1) }
    }).then(() => showToast("模板已切换，Island 状态角色将实时刷新"));
  }, "外观模板");
  const reset = button("恢复官方默认", async () => {
    await save({
      appearanceTemplate: { id: "builtin:workisland-xiaoyu", version: "1.0.0" }
    });
    await loadTemplates();
    renderPage();
    showToast("已恢复官方小宇模板");
  }, "secondary");
  tpl.append(
    row("当前模板", "模板决定会话状态图标（idle/运行/待审批/完成/错误）的角色形象；官方内置 WorkIsland 小宇（守岛人）。", templateSelect),
    row("恢复默认", "切回官方小宇模板；不会删除已安装的模板和你的 Codex 宠物。", reset),
    row("AI 换装", "对 Agent 说“帮我换个外观模板”，装有 workisland-template Skill 的 Agent 会先预览再经你确认后应用。", el("span", "range-value", "Skill 入口"))
  );
  return tpl;
}

const ISLAND_APPEARANCE_PRESETS = [
  { id: "default", label: "默认 · 纯黑", value: { kind: "default" } },
  { id: "deep-blue", label: "深海蓝", value: { kind: "solid", color: "#0B1E3A", opacity: 1 } },
  { id: "forest", label: "墨绿", value: { kind: "solid", color: "#0A231A", opacity: 1 } },
  { id: "night-purple", label: "夜紫渐变", value: { kind: "gradient", color: "#1F1330", color2: "#0B0716", angle: 135, opacity: 1 } },
  { id: "frost", label: "半透石墨", value: { kind: "solid", color: "#0E0F13", opacity: 0.72 } }
];

function islandBackgroundSection() {
  const island = section("岛屿背景", "自定义 Island 的背景颜色、透明度与背景图；本机 AI Agent 也可通过 workisland-cli 接口修改。");
  const current = state.settings.islandAppearance || { kind: "default" };
  const matchingPreset = ISLAND_APPEARANCE_PRESETS.find(
    preset => JSON.stringify(preset.value) === JSON.stringify(current)
  );
  const presetOptions = ISLAND_APPEARANCE_PRESETS.map(preset => [preset.id, preset.label]);
  if (!matchingPreset) {
    const kindLabel = current.kind === "gradient" ? "渐变" : current.kind === "image" ? "背景图" : "纯色";
    presetOptions.push(["__custom__", `当前自定义 · ${kindLabel}`]);
  }
  const presetSelect = select(
    matchingPreset ? matchingPreset.id : "__custom__",
    presetOptions,
    value => {
      const preset = ISLAND_APPEARANCE_PRESETS.find(entry => entry.id === value);
      if (preset) save({ islandAppearance: preset.value });
    },
    "岛屿背景预设"
  );
  const color = document.createElement("input");
  color.type = "color";
  color.className = "color-input";
  color.value = /^#[0-9a-fA-F]{6}$/.test(current.color || "") ? current.color : "#000000";
  color.setAttribute("aria-label", "自定义背景颜色");
  color.addEventListener("change", () => save({
    islandAppearance: { kind: "solid", color: color.value, opacity: current.kind === "image" ? 1 : (current.opacity ?? 1) }
  }));
  const opacity = document.createElement("input");
  opacity.type = "range"; opacity.min = "0.15"; opacity.max = "1"; opacity.step = "0.05";
  opacity.value = String(current.kind === "image" ? 1 : (current.opacity ?? 1));
  opacity.disabled = current.kind === "image" || current.kind === "default";
  const opacityValue = el("span", "range-value", `${Math.round(Number(opacity.value) * 100)}%`);
  opacity.addEventListener("input", () => opacityValue.textContent = `${Math.round(Number(opacity.value) * 100)}%`);
  opacity.addEventListener("change", () => save({
    islandAppearance: {
      kind: current.kind === "gradient" ? "gradient" : "solid",
      color: current.color || "#000000",
      ...(current.kind === "gradient" ? { color2: current.color2 || "#000000", angle: current.angle ?? 135 } : {}),
      opacity: Number(opacity.value)
    }
  }));
  const opacityControl = el("div", "range-control"); opacityControl.append(opacity, opacityValue);
  island.append(
    row("背景预设", "选择常用深色主题；过亮的颜色会被自动压暗以保持文字可读。", presetSelect),
    row("自定义颜色", "直接指定纯色背景。", color),
    row("背景不透明度", "纯色与渐变背景的透明程度；背景图模式不可用。", opacityControl),
    row("恢复默认", "清除 AI 或手动设置，回到经典纯黑 Island。", button("重置背景", () => save({ islandAppearance: { kind: "default" } }), "secondary"))
  );
  return island;
}

function soundPage() {
  const root = document.createDocumentFragment();
  const sound = state.settings.sound || {};
  const main = section("声音", "声音全部在本机播放，不上传会话内容。");
  const volume = document.createElement("input");
  volume.type = "range"; volume.min = "0"; volume.max = "100"; volume.value = sound.volume ?? 50;
  const volumeValue = el("span", "range-value", `${volume.value}%`);
  volume.addEventListener("input", () => volumeValue.textContent = `${volume.value}%`);
  volume.addEventListener("change", () => save({ sound: { ...sound, volume: Number(volume.value) } }));
  const volumeControl = el("div", "range-control"); volumeControl.append(volume, volumeValue);
  main.append(
    row("启用声音", "播放任务开始、完成和审批提示。", toggle(sound.enabled, v => save({ sound: { ...sound, enabled: v } }), "启用声音")),
    row("音量", "统一调整所有提示音。", volumeControl),
    row("自定义声音", "在本地目录中添加或替换提示音文件。", button("打开目录", () => api.openSoundsDir()))
  );
  const bark = state.settings.barkPush || { enabled: false, url: "", events: {} };
  const barkSection = section("手机推送（Bark）", "Agent 等待审批、提问或完成、失败时推送到 iPhone。默认关闭；只推送事件类型与 Agent 名，不含会话内容。");
  const barkUrl = document.createElement("input");
  barkUrl.className = "text-input";
  barkUrl.placeholder = "https://api.day.app/你的设备Key";
  barkUrl.value = bark.url || "";
  barkUrl.setAttribute("aria-label", "Bark 推送地址");
  barkUrl.addEventListener("change", () => save({ barkPush: { ...bark, url: barkUrl.value.trim() } }));
  barkSection.append(
    row("启用推送", "仅向你配置的 Bark 端点发请求，自托管同样支持。", toggle(bark.enabled, v => save({ barkPush: { ...bark, enabled: v } }), "启用 Bark 推送")),
    row("推送地址", "iOS 安装 Bark App 后复制推送 URL 粘贴到这里。", barkUrl)
  );
  const quiet = state.settings.quietHours || { enabled: false, start: "22:00", end: "08:00", suppressOnLockScreen: true };
  const quietSection = section("安静时段", "勿扰时间段与锁屏期间静音本地提示音；手机推送不受影响，岛行为保持正常。");
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
  quietRange.append(quietTimeInput("start", "勿扰开始时间"), quietTimeInput("end", "勿扰结束时间"));
  quietSection.append(
    row("启用勿扰时段", "时间段内不播放任务提示音（支持跨午夜，如 22:00 → 08:00）。", toggle(quiet.enabled, v => save({ quietHours: { ...quiet, enabled: v } }), "启用勿扰时段")),
    row("勿扰时间", "开始与结束时间；结束早于开始时按跨午夜处理。", quietRange),
    row("锁屏时静音", "macOS 锁屏期间不播放任务提示音。", toggle(quiet.suppressOnLockScreen, v => save({ quietHours: { ...quiet, suppressOnLockScreen: v } }), "锁屏时静音"))
  );
  root.append(main, barkSection, quietSection);
  return root;
}

function aboutPage() {
  const root = document.createDocumentFragment();
  const about = section("关于 WorkIsland", "本地优先的 macOS Agent 会话监控与审批界面。");
  const version = el("div", "about-card");
  const appMark = el("img", "app-mark");
  appMark.src = WORKISLAND_ICON_URL;
  appMark.alt = "";
  appMark.draggable = false;
  version.append(appMark, el("div", "about-copy", "WorkIsland\n正在读取版本…"));
  api.getAppVersion().then(v => version.querySelector(".about-copy").textContent = `WorkIsland\n版本 ${v}`).catch(() => {});
  about.append(version);
  const support = section("帮助与社区", "操作手册、反馈渠道与社区信息由 WorkIsland 官网统一维护，无需重新安装即可更新。");
  support.append(
    row("产品手册", "查看安装、首次任务、状态理解、隐私与反馈说明。", button("打开手册", () => api.openExternal(USER_GUIDE_URL), "primary")),
    row("提交反馈", "像日常吐槽一样一句话反馈，会自动附带版本与 Agent 状态。", (() => { const group = el("div", "setting-actions-group"); group.append(button("一键吐槽", () => openComplaintBox(), "primary"), button("打开反馈入口", () => api.openExternal(FEEDBACK_URL))); return group; })()),
    row("加入社区", "查看最新 WorkIsland 微信社区二维码。", button("查看群码", () => api.openExternal(COMMUNITY_URL)))
  );
  const updates = section("更新", "仅请求官方版本信息与官方安装包，不上传会话内容或使用数据。");
  const updateStatus = el("div", "update-status", state.latestUpdate ? `发现新版本 ${state.latestUpdate.latestVersion}` : "尚未检查");
  let latestUrl = state.latestUpdate?.releaseUrl || "";
  const openButton = button("打开下载页", () => {
    if (latestUrl) api.openExternal(latestUrl);
  });
  openButton.hidden = !latestUrl;
  const checkButton = button("检查更新", async () => {
    checkButton.disabled = true;
    updateStatus.textContent = "正在检查…";
    try {
      const result = await api.checkForUpdates();
      if (result?.status === "update-available") {
        state.latestUpdate = result;
        latestUrl = result.releaseUrl || "";
        openButton.hidden = !latestUrl;
        updateStatus.textContent = `发现新版本 ${result.latestVersion}`;
      } else if (result?.status === "up-to-date") {
        updateStatus.textContent = `当前已是最新版本（${result.currentVersion}）`;
      } else if (result?.status === "disabled") {
        updateStatus.textContent = "开发模式下不执行更新检查";
      } else {
        updateStatus.textContent = result?.message || "暂时无法获取更新信息";
      }
    } catch (error) {
      updateStatus.textContent = error?.message || "暂时无法获取更新信息";
    } finally {
      checkButton.disabled = false;
    }
  });
  const formatMb = bytes => `${(Math.max(0, Number(bytes) || 0) / 1048576).toFixed(1)} MB`;
  const installButton = button("下载并安装", async () => {
    const phase = state.updateState?.phase || "idle";
    try {
      installButton.disabled = true;
      if (phase === "ready") await api.installUpdate();
      else await api.downloadUpdate();
    } catch (error) {
      updateStatus.textContent = error?.message || "更新操作失败";
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
      installButton.textContent = `正在下载 ${pct}%`;
      updateStatus.textContent = `正在下载更新 ${pct}%（${formatMb(snapshot?.progress?.received)}${snapshot?.progress?.total ? ` / ${formatMb(snapshot.progress.total)}` : ""}），完成后会校验安装包。`;
    } else if (phase === "ready") {
      installButton.textContent = "重启并完成安装";
      installButton.disabled = false;
      updateStatus.textContent = "安装包已下载并通过 SHA-256 校验，点击按钮立即安装并重启。";
    } else if (phase === "installing") {
      installButton.textContent = "正在安装…";
      updateStatus.textContent = "正在安装更新，应用将自动重启。";
    } else if (phase === "manual") {
      installButton.textContent = "需手动完成";
      updateStatus.textContent = snapshot?.error || "自动安装未完成，已打开安装镜像，请拖拽安装。";
    } else if (phase === "error") {
      installButton.textContent = "重试下载";
      installButton.disabled = false;
      updateStatus.textContent = snapshot?.error || "更新失败，请稍后重试。";
    } else {
      installButton.textContent = "下载并安装";
      installButton.disabled = false;
      if (hasUpdate) updateStatus.textContent = `发现新版本 ${state.latestUpdate.latestVersion}`;
    }
  };
  state.onUpdateStateUi = syncUpdateStateControls;
  syncUpdateStateControls();
  const updateControls = el("div", "inline-controls");
  updateControls.append(updateStatus, checkButton, installButton, openButton);
  updates.append(
    row("自动检查更新", "安装版每天检查一次 GitHub Release；关闭后仍可手动检查。", toggle(state.settings.updateChecksEnabled, v => save({ updateChecksEnabled: v }), "自动检查更新")),
    row("版本检查", "发现新版本后会提醒，可直接下载官方安装包并在本机完成安装。", updateControls)
  );
  const diagnostics = section("诊断", "导出仅包含本机诊断信息的日志；退出操作位于默认的“通用”页面。");
  const actions = el("div", "section-actions");
  actions.append(button("导出诊断日志", async () => { const path = await api.collectLogs(); showToast(path ? "日志已导出" : "日志导出完成"); }));
  diagnostics.append(actions);
  const privacy = section("匿名使用统计", "默认开启。仅上报事件类型与 Agent 名称等匿名统计，可在下方随时关闭。");
  const telemetryStatus = state.telemetryStatus;
  const statusText = !telemetryStatus
    ? "正在读取本机发送状态…"
    : telemetryStatus.status === "disabled"
      ? "已关闭：不会继续收集或发送，未上报数据已清空。"
      : telemetryStatus.status === "development"
        ? "开发模式：本机可检查队列，但不会出网发送。"
        : telemetryStatus.status === "not-configured"
          ? "上传未配置：本机不会向 PostHog 发送数据。"
          : telemetryStatus.lastSuccessAt
            ? `最近一次成功提交到 PostHog：${new Date(telemetryStatus.lastSuccessAt).toLocaleString()}；待发送 ${telemetryStatus.pendingEventCount} 条。`
            : `已开启：等待首次成功提交；待发送 ${telemetryStatus.pendingEventCount} 条。`;
  privacy.append(
    row(
      "允许匿名使用统计",
      "默认开启；关闭后立即停止收集并清空未上报的数据。不包含会话内容、文件路径或个人信息；目的地为 PostHog（美国区），事件清单见开源代码 telemetry.cjs。",
      toggle(state.settings.telemetryEnabled, v => save({ telemetryEnabled: v }), "允许匿名使用统计")
    ),
    row("本机发送状态", "仅显示本机队列与 PostHog 批量接口最近一次 HTTP 2xx 确认，不展示或上传任何额外内容。", el("div", "setting-description", statusText))
  );
  const devApi = state.settings.developerApi || { enabled: false, port: 9938, token: "" };
  const devSection = section("开发者 API", "在本机回环地址提供只读的会话状态 JSON 端点，供脚本与工具集成。默认关闭；响应不含会话内容。");
  const devToken = document.createElement("input");
  devToken.className = "text-input";
  devToken.placeholder = "可选访问令牌（留空不鉴权）";
  devToken.value = devApi.token || "";
  devToken.setAttribute("aria-label", "开发者 API 访问令牌");
  devToken.addEventListener("change", () => save({ developerApi: { ...devApi, token: devToken.value.trim() } }));
  devSection.append(
    row("启用本地状态端点", `开启后 GET http://127.0.0.1:${devApi.port || 9938}/api/status 返回会话状态与版本信息。`, toggle(devApi.enabled, v => save({ developerApi: { ...devApi, enabled: v } }), "启用开发者 API")),
    row("访问令牌", "填写后请求需携带 Bearer 令牌（或 ?token= 查询参数）；仅本机可访问。", devToken)
  );
  root.append(about, support, privacy, updates, devSection, diagnostics);
  return root;
}

const PAGES = { general: generalPage, agents: agentsPage, appearance: appearancePage, sound: soundPage, "mcp": mcpPage, about: aboutPage };

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
  document.querySelector("#content").textContent = `设置页加载失败：${error.message}`;
});
