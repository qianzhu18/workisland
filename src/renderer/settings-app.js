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

function islandBackgroundSection() {
  const island = section(t("settings.appearance.background.sectionTitle"), t("settings.appearance.background.description"));
  const current = state.settings.islandAppearance || { kind: "default" };
  const matchingPreset = ISLAND_APPEARANCE_PRESETS.find(
    preset => JSON.stringify(preset.value) === JSON.stringify(current)
  );
  const presetOptions = ISLAND_APPEARANCE_PRESETS.map(preset => [preset.id, t(preset.labelKey)]);
  if (!matchingPreset) {
    const kindLabel = t(`settings.appearance.background.kind.${current.kind === "gradient" ? "gradient" : current.kind === "image" ? "image" : "solid"}`);
    presetOptions.push(["__custom__", t("settings.appearance.background.customCurrent", { kind: kindLabel })]);
  }
  const presetSelect = select(
    matchingPreset ? matchingPreset.id : "__custom__",
    presetOptions,
    value => {
      const preset = ISLAND_APPEARANCE_PRESETS.find(entry => entry.id === value);
      if (preset) save({ islandAppearance: preset.value });
    },
    t("settings.appearance.background.presetLabel")
  );
  const color = document.createElement("input");
  color.type = "color";
  color.className = "color-input";
  color.value = /^#[0-9a-fA-F]{6}$/.test(current.color || "") ? current.color : "#000000";
  color.setAttribute("aria-label", t("settings.appearance.background.colorLabel"));
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
    row(t("settings.appearance.background.preset.title"), t("settings.appearance.background.preset.description"), presetSelect),
    row(t("settings.appearance.background.color.title"), t("settings.appearance.background.color.description"), color),
    row(t("settings.appearance.background.opacity.title"), t("settings.appearance.background.opacity.description"), opacityControl),
    row(t("settings.appearance.background.restore.title"), t("settings.appearance.background.restore.description"), button(t("settings.appearance.background.restore.action"), () => save({ islandAppearance: { kind: "default" } }), "secondary"))
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
