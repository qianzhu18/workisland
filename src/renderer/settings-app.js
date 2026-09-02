"use strict";

const api = window.settingsApi;

const DEFAULT_PET_SPRITE = "codex:qianxue";
const FEEDBACK_URL = "https://workisland.yanglaishe.cn/#feedback";
const COMMUNITY_URL = "https://workisland.yanglaishe.cn/#community";
const USER_GUIDE_URL = "https://workisland.yanglaishe.cn/guide/";
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
const state = { settings: null, statuses: new Map(), doctorSummary: null, displays: [], codexPets: [], templates: { active: null, templates: [] }, shareProviders: [], activeTab: "general", busy: new Set(), expandedSettingDetails: new Set(), latestUpdate: null, updateState: null, onUpdateStateUi: null, telemetryStatus: null, commandDraft: { name: "", command: "" } };

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
  const disclosure = button(expanded ? "收起" : "详细设置", () => {
    if (expanded) state.expandedSettingDetails.delete(id);
    else state.expandedSettingDetails.add(id);
    renderPage();
  });
  const detailId = `feature-settings-${id}`;
  disclosure.classList.add("feature-settings-disclosure");
  disclosure.setAttribute("aria-expanded", String(expanded));
  disclosure.setAttribute("aria-controls", detailId);
  disclosure.setAttribute("aria-label", `${expanded ? "收起" : "展开"}${title}详细设置`);
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
  input.setAttribute("aria-label", label || "切换设置");
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
    showToast(error?.message || "设置保存失败", true);
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
    if (showNotice) showToast(`已发现 ${state.displays.length} 台显示器`);
    if (state.activeTab === "general") renderPage();
  } catch (error) {
    if (showNotice) showToast(error?.message || "无法读取显示器列表", true);
  }
}

async function loadCodexPets() {
  try {
    state.codexPets = (await api.getCodexPets?.()) || [];
  } catch {
    state.codexPets = [];
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
  const confirmed = window.confirm("退出 WorkIsland？\n\n这会关闭 Island、桌宠与后台监听。");
  if (confirmed) api.quitApp();
}

function savedCommandsControl() {
  const wrap = el("div", "saved-command-control");
  const commands = Array.isArray(state.settings.terminalSavedCommands)
    ? state.settings.terminalSavedCommands
    : [];
  const list = el("div", "saved-command-list");
  if (commands.length === 0) list.append(el("span", "saved-command-empty", "尚未添加"));
  for (const command of commands) {
    const chip = el("div", "saved-command-chip");
    const copy = el("div", "saved-command-copy");
    copy.append(
      el("span", "saved-command-name", command.name),
      el("code", "saved-command-value", command.command)
    );
    const remove = button("删除", async () => {
      await save({
        terminalSavedCommands: commands.filter(item => item.id !== command.id)
      });
      renderPage();
      showToast(`已删除快捷命令「${command.name}」`);
    }, "danger");
    remove.classList.add("saved-command-remove");
    remove.setAttribute("aria-label", `移除快捷命令 ${command.name}`);
    chip.append(copy, remove);
    list.append(chip);
  }
  const editor = el("div", "terminal-command-editor");
  const nameInput = document.createElement("input");
  nameInput.className = "text-input";
  nameInput.placeholder = "名称，例如：启动开发服务";
  nameInput.value = state.commandDraft.name;
  nameInput.setAttribute("aria-label", "快捷命令名称");
  nameInput.addEventListener("input", () => { state.commandDraft.name = nameInput.value; });
  const commandInput = document.createElement("input");
  commandInput.className = "text-input terminal-command-input";
  commandInput.placeholder = "命令，例如：npm run dev";
  commandInput.value = state.commandDraft.command;
  commandInput.setAttribute("aria-label", "快捷终端命令");
  commandInput.addEventListener("input", () => { state.commandDraft.command = commandInput.value; });
  const add = button("添加命令", () => {
    const name = nameInput.value.trim();
    const command = commandInput.value.trim();
    if (!name || !command) {
      showToast("请同时填写名称和命令", true);
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
  showToast("终端默认目录已保存");
}

function terminalDirectoryControl() {
  const wrap = el("div", "terminal-directory-control");
  const mode = select(
    state.settings.terminalDefaultDirectory,
    [["agent-project", "当前 Agent 项目"], ["home", "用户目录"], ["custom", "自定义目录"]],
    async value => {
      if (value === "custom") await selectTerminalDirectory();
      else await save({ terminalDefaultDirectory: value });
    },
    "终端默认目录"
  );
  wrap.append(mode);
  if (state.settings.terminalDefaultDirectory === "custom") {
    wrap.append(el("span", "terminal-directory-path", state.settings.terminalCustomDirectory || "尚未选择"));
    wrap.append(button("选择文件夹", selectTerminalDirectory));
  }
  return wrap;
}

function quickShareProviderControl() {
  const current = api.platform === "win32" ? "__system__" : (state.settings.shelfQuickShareProvider || "AirDrop");
  const providers = state.shareProviders.length
    ? state.shareProviders
    : [{ id: current, title: current }, { id: "__system__", title: "系统分享菜单" }];
  return select(current, providers.map((provider) => [provider.id, provider.title]), async value => {
    await save({ shelfQuickShareProvider: value });
    showToast(`默认快速分享已改为 ${providers.find((provider) => provider.id === value)?.title || value}`);
  }, "默认快速分享");
}

function generalPage() {
  const root = document.createDocumentFragment();
  const workstation = section("工作台", "让灵动岛同时承载媒体控制和轻量性能监视。所有数据只在本机读取与展示。");
  workstation.append(
    featureSettingsRow(
      "media",
      "媒体播放",
      `自动识别 ${api.platform === "win32" ? "Windows" : "macOS"} 当前播放的媒体；播放时显示封面、进度和控制按钮，没有媒体时恢复完整 Agent 视图。`,
      toggle(state.settings.mediaEnabled, v => save({ mediaEnabled: v }), "媒体播放"),
      () => [
        row("切歌动态提醒", "歌曲变化时短暂显示新封面与曲名；Agent 审批、失败和完成提醒始终优先。", toggle(state.settings.mediaTrackChangeNotifications, v => save({ mediaTrackChangeNotifications: v }), "切歌动态提醒")),
        row("在线歌词", "播放时把歌曲名、歌手、专辑和时长发送到 LRCLIB 查询歌词；默认关闭，歌词仅缓存在本机。", toggle(state.settings.lyricsEnabled, v => save({ lyricsEnabled: v }), "在线歌词")),
        row("歌词缓存", "清除已缓存的歌词和未找到记录；不会影响音乐播放。", button("清除缓存", async () => {
          await api.clearLyricsCache();
          showToast("歌词缓存已清除");
        }))
      ]
    ),
    featureSettingsRow(
      "performance",
      "性能监视器",
      "在灵动岛右上角显示实时负载，悬停可查看 CPU、内存和高占用进程。",
      toggle(state.settings.performanceEnabled, v => save({ performanceEnabled: v }), "性能监视器"),
      () => [row("性能异常提醒", "CPU 或内存持续高占用时提醒。默认关闭，避免打扰专注。", toggle(state.settings.performanceAlertsEnabled, v => save({ performanceAlertsEnabled: v }), "性能异常提醒"))]
    )
  );
  const productivity = section("效率工具", "选择要显示在灵动岛顶部的工具入口；Agent 需要审批、提问或报错时始终优先显示。");
  productivity.append(
    featureSettingsRow(
      "shelf",
      "文件架",
      "把文件临时放在灵动岛中，方便跨应用拖放；只保存文件引用，移除不会删除原文件。",
      toggle(state.settings.fileShelfEnabled, v => save({ fileShelfEnabled: v }), "文件架"),
      () => [row("默认快速分享", "拖到文件架左侧时直接使用；也可以改为系统分享菜单，每次临时选择备忘录、微信等服务。", quickShareProviderControl())]
    ),
    featureSettingsRow(
      "clipboard",
      "剪贴板历史",
      "记录复制的文字、链接、代码和图片，只保存在本机。为保护隐私，新安装默认关闭。",
      toggle(state.settings.clipboardHistoryEnabled, v => {
        if (v && !window.confirm("开启剪贴板历史？\n\n复制的文字、链接、代码和图片会只保存在本机。你可以随时清空或关闭此功能。")) {
          renderPage();
          return;
        }
        save({ clipboardHistoryEnabled: v });
      }, "剪贴板历史"),
      () => [
        row(
          "历史条数",
          "达到上限后自动移除最早且未收藏的记录。",
          select(
            state.settings.clipboardHistoryLimit,
            [["25", "25 条"], ["50", "50 条"], ["100", "100 条"], ["250", "250 条"]],
            v => save({ clipboardHistoryLimit: Number(v) }),
            "剪贴板历史条数"
          )
        ),
        row(
          "自动清理",
          "收藏内容不会被定时清理，也可以在灵动岛中手动清空。",
          select(
            state.settings.clipboardRetentionHours,
            [["1", "1 小时"], ["8", "8 小时"], ["24", "24 小时"], ["168", "7 天"], ["0", "不自动清理"]],
            v => save({ clipboardRetentionHours: Number(v) }),
            "剪贴板自动清理"
          )
        )
      ]
    ),
    featureSettingsRow(
      "terminal",
      "快捷终端",
      "在灵动岛中运行快捷命令，也可以展开为可持续交互的完整终端。",
      toggle(state.settings.terminalEnabled, v => save({ terminalEnabled: v }), "快捷终端"),
      () => [
        row("默认目录", "优先使用当前 Agent 项目；也可以固定到用户目录或任意文件夹。", terminalDirectoryControl()),
        row("快捷命令", "添加常用命令后，可以从灵动岛一键运行，例如 git status、npm test 或启动开发服务；示例不会自动添加，命令只保存在本机。", savedCommandsControl())
      ]
    )
  );
  const behavior = section("Island 行为", "控制灵动岛何时出现以及如何收起。");
  behavior.append(
    row("登录时启动", "开机登录后自动启动 WorkIsland。", toggle(state.settings.launchAtLogin, v => save({ launchAtLogin: v }), "登录时启动")),
    row("悬停展开", "鼠标停留在 Island 上时展开面板。", toggle(state.settings.hoverToOpen, v => save({ hoverToOpen: v }), "悬停展开")),
    row("失去焦点后隐藏", "失去窗口焦点后隐藏 Island；鼠标移到顶部热区可恢复。", toggle(state.settings.autoCollapseOnMouseLeave, v => save({ autoCollapseOnMouseLeave: v }), "失去焦点后隐藏")),
    row(
      "重新展开时",
      "只决定先显示哪个页面；文件架、剪贴板和终端状态都会继续保留。",
      select(
        state.settings.toolboxReopenMode === "last" ? "last" : "agent",
        [["agent", "智能体主页（默认）"], ["last", "上次使用的工具"]],
        v => save({ toolboxReopenMode: v }),
        "重新展开时显示的页面"
      )
    ),
    row("全屏时隐藏", "全屏应用位于当前屏幕时隐藏 Island。", toggle(state.settings.hideWhenFullscreen, v => save({ hideWhenFullscreen: v }), "全屏时隐藏")),
    row(
      "Island 显示模式",
      "常驻（新装默认）：空闲时保留顶部紧凑胶囊，装完即可看到 WorkIsland；极简：空闲时隐藏，需要时通过顶部热区或快捷键唤回。两种模式下提交与完成都会短暂显示，审批、提问和错误持续显示。",
      select(
        state.settings.islandDisplayMode === "persistent" ? "persistent" : "minimal",
        [["persistent", "常驻（默认）"], ["minimal", "极简"]],
        v => save({ islandDisplayMode: v }),
        "Island 显示模式"
      )
    ),
    row("任务提交时展开", "提交新的 Agent 任务时显示 5 秒提醒。", toggle(state.settings.expandOnSessionSubmit, v => save({ expandOnSessionSubmit: v }), "提交时展开")),
    row("需要操作时展开", "审批、提问或计划确认到来时自动展开。", toggle(state.settings.expandOnActionRequired, v => save({ expandOnActionRequired: v }), "操作时展开")),
    row("任务完成时展开", "Agent 完成当前轮次时短暂展示结果。", toggle(state.settings.expandOnSessionComplete, v => save({ expandOnSessionComplete: v }), "完成时展开")),
    row(
      "完成通知停留时间",
      "影响任务提交和完成通知；审批、提问和失败通知会保留到你处理为止。",
      select(
        state.settings.completionPopupDurationSec,
        [["5", "5 秒"], ["10", "10 秒"], ["20", "20 秒"], ["30", "30 秒"]],
        v => save({ completionPopupDurationSec: Number(v) }),
        "完成通知停留时间"
      )
    )
  );

  const display = section("显示", "选择 Island 所在屏幕与信息密度。");
  // "auto" tracks the screen containing the current frontmost app. A display
  // id is a pinned screen and is the reliable choice for an external monitor.
  const displayOptions = [["primary", "主显示器", "主显示器"], ["auto", "当前活跃显示器", ""]];
  const displayPreference = state.settings.displayPreference === "active"
    ? "auto"
    : (state.settings.displayPreference || "primary");
  const currentDisplay = displayPreference === "primary"
    ? state.displays.find(d => d.isMain)
    : state.displays.find(d => String(d.displayId) === String(displayPreference));
  if (state.displays && state.displays.length > 0) {
    for (const d of state.displays) {
      const label = d.label || `显示器 ${d.displayId}`;
      const tag = d.isMain ? "内置主屏" : "外接显示器";
      displayOptions.push([String(d.displayId), `${label} · ${tag}`, label]);
    }
  }
  // Keep an unplugged pinned display visible so the setting explains why the
  // app has fallen back to the primary screen instead of silently changing it.
  if (displayPreference !== "primary" && displayPreference !== "auto" && !currentDisplay) {
    displayOptions.push([
      String(displayPreference),
      `${state.settings.displayPreferenceLabel || "已保存的显示器"} · 当前不可用`,
      state.settings.displayPreferenceLabel || ""
    ]);
  }
  const displaySelect = select(displayPreference, displayOptions, v => {
    const selected = displayOptions.find(o => o[0] === v);
    save({
      displayPreference: v,
      displayPreferenceLabel: selected?.[2] || ""
    });
  }, "显示器");
  const displayControl = el("div", "inline-controls");
  displayControl.append(displaySelect, button("刷新", () => loadDisplays(true)));
  const displayDescription = displayPreference === "primary"
    ? "使用 macOS 主显示器"
    : currentDisplay
    ? `${currentDisplay.label || "已连接显示器"} · ${currentDisplay.isMain ? "内置主屏" : "外接显示器"}`
    : displayPreference === "auto"
      ? "跟随当前正在使用的应用所在显示器"
      : "当前选择的显示器未连接，将暂时使用主显示器";
  display.append(
    row("显示器", `${displayDescription}。外接屏插入后点击“刷新”即可选择。`, displayControl),
    row("显示额度信息", "在面板顶部展示本地可读取的额度数据。", toggle(state.settings.showUsageQuota, v => save({ showUsageQuota: v }), "显示额度")),
    row("触感反馈", "执行审批等关键操作时提供轻微触感。", toggle(state.settings.hapticFeedback, v => save({ hapticFeedback: v }), "触感反馈"))
  );
  const lifecycle = section("应用", "关闭 WorkIsland 会同时关闭 Island、桌宠与后台监听。");
  lifecycle.append(
    row("退出 WorkIsland", "需要重新打开应用后才会继续监测本机 Agent 状态。", button("退出应用", requestQuitApp, "danger"))
  );
  root.append(workstation, productivity, behavior, display, lifecycle);
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
    ? "待修复"
    : verifyOnRealEvent && installed
    ? (verified ? "已连接" : "配置已写入")
    : installed ? "已连接" : unavailable ? "未检测" : "未连接";
  const statusClass = repairNeeded
    ? "repair"
    : verifyOnRealEvent && installed && !verified
    ? "pending"
    : installed ? "installed" : "missing";
  return el("span", `status ${statusClass}`, text);
}

function doctorSummaryLine(summary) {
  if (!summary || !summary.total) return "";
  const parts = [`${summary.total} 个 Agent`, `${summary.ok} 正常`];
  if (summary.repairable) parts.push(`${summary.repairable} 待修复`);
  if (summary.notInstalled) parts.push(`${summary.notInstalled} 未安装`);
  if (summary.blocked) parts.push(`${summary.blocked} 需关注`);
  return parts.join(" · ");
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
  actionButton.textContent = install ? "连接中…" : "移除中…";
  try {
    const result = install ? await api.installHook(agentId) : await api.uninstallHook(agentId);
    if (result?.success === false) throw new Error(result.error || "安装失败");
    const toggles = { ...(state.settings.hookToggles || {}), [agentId]: install };
    await save({ hookToggles: toggles });
    await refreshAgents();
  } catch (error) {
    showToast(error.message || String(error), true);
  } finally {
    state.busy.delete(agentId);
  }
}

function capabilitySummary(capabilities = {}) {
  const items = [];
  if (capabilities.liveStatus) items.push("实时状态");
  if (capabilities.completion === "native") items.push("完成提醒");
  else if (capabilities.completion === "inferred") items.push("推断完成");
  if (capabilities.approval === "bridge") items.push("Island 审批");
  else if (capabilities.approval === "observe") items.push("审批观察");
  if (capabilities.jump === "session") items.push("会话回源");
  else if (capabilities.jump === "workspace") items.push("工作区回源");
  else if (capabilities.jump === "app") items.push("打开应用");
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
    ? (issues[0] || "连接配置已写入；请运行一次实际任务。收到事件后才会显示“已连接”。")
    : report.available === false && !report.installed
    ? `未检测到 ${label}，安装后即可连接。`
    : issues.length ? issues[0] : report.description;
  content.append(el("div", "agent-detail", detail));
  const capabilities = capabilitySummary(report.capabilities);
  if (capabilities) content.append(el("div", "agent-detail", capabilities));

  if (report.capabilities?.approvalConfigurable) {
    const approval = select(state.settings.approvalModes?.[agentId] || "bridge", [["bridge", "Island 审批"], ["terminalNative", "终端审批"]], async value => {
      await save({ approvalModes: { ...(state.settings.approvalModes || {}), [agentId]: value } });
      showToast("审批方式已保存，Hook 将自动刷新");
    }, `${label} 审批方式`);
    approval.classList.add("compact-select");
    content.append(approval);
  }

  const installed = Boolean(report?.installed);
  const action = button(installed ? "移除" : "连接", () => setAgentInstalled(agentId, !installed, action), installed ? "secondary" : "primary");
  if (report.available === false && !installed) {
    action.disabled = true;
    action.textContent = "未安装";
  }
  card.append(iconFrame, content, action);
  return card;
}

function agentsPage() {
  const root = document.createDocumentFragment();
  const hooks = section("本地 Agent", "连接只会修改对应 Agent 的本地 Hook 配置，不依赖云端服务。一键检测会扫描全部 Agent 的 Hook 配置并给出修复建议。");
  const summaryText = doctorSummaryLine(state.doctorSummary);
  if (summaryText) {
    const summary = el("div", "doctor-summary", summaryText);
    summary.setAttribute("role", "status");
    hooks.append(summary);
  }
  const grid = el("div", "agent-list");
  for (const report of state.statuses.values()) grid.append(agentCard(report));
  hooks.append(grid);
  const tools = el("div", "section-actions");
  tools.append(
    button("一键检测", () => refreshAgents().catch(error => showToast(error.message, true))),
    button("移除全部 Hook", async () => { await api.uninstallAllHooks(); await refreshAgents(); }, "danger")
  );
  hooks.append(tools);
  root.append(hooks);
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
  root.append(main);
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
    row("提交反馈", "报告问题、提出建议或补充复现信息。", button("打开反馈入口", () => api.openExternal(FEEDBACK_URL), "primary")),
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
  root.append(about, support, privacy, updates, diagnostics);
  return root;
}

const PAGES = { general: generalPage, agents: agentsPage, appearance: appearancePage, sound: soundPage, about: aboutPage };

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
  state.settings = await api.getSettings();
  try { state.shareProviders = await api.getShelfShareProviders?.() || []; } catch { state.shareProviders = []; }
  await loadTelemetryStatus();
  await loadDisplays();
  await loadCodexPets();
  await loadTemplates();
  document.querySelectorAll(".nav-item").forEach(item => item.addEventListener("click", () => {
    state.activeTab = item.dataset.tab;
    renderPage();
    if (state.activeTab === "agents") refreshAgents().catch(error => showToast(error.message, true));
  }));
  api.onNavigateToTab?.(tab => {
    const aliases = { hooks: "agents", pet: "appearance", display: "general" };
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
  renderPage();
  refreshAgents().catch(() => {});
  setInterval(() => {
    if (state.activeTab === "agents") refreshAgents().catch(() => {});
  }, AGENT_STATUS_REFRESH_INTERVAL_MS);
}

start().catch(error => {
  document.querySelector("#content").textContent = `设置页加载失败：${error.message}`;
});
