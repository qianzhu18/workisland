"use strict";

const api = window.settingsApi;

const AGENTS = [
  ["claude", "Claude Code"], ["codex", "Codex"], ["coco", "Coco"],
  ["cursor", "Cursor"], ["trae", "Trae"], ["trae-cn", "Trae CN"],
  ["opencode", "OpenCode"], ["sara", "Sara"], ["kimi", "Kimi"],
  ["gemini", "Gemini CLI"], ["copilot-cli", "GitHub Copilot CLI"],
  ["hermes", "Hermes"], ["aiden", "Aiden"], ["traex", "TraeX"]
];

const APPROVAL_AGENTS = new Set(["codex", "coco", "copilot-cli", "traex"]);
const state = { settings: null, statuses: new Map(), plugins: [], displays: [], codexPets: [], activeTab: "general", busy: new Set() };

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
  } catch (error) {
    state.settings = previous;
    renderPage();
    showToast(error?.message || "设置保存失败", true);
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

function generalPage() {
  const root = document.createDocumentFragment();
  const behavior = section("Island 行为", "控制灵动岛何时出现以及如何收起。");
  behavior.append(
    row("登录时启动", "开机登录后自动启动 WorkIsland。", toggle(state.settings.launchAtLogin, v => save({ launchAtLogin: v }), "登录时启动")),
    row("悬停展开", "鼠标停留在 Island 上时展开面板。", toggle(state.settings.hoverToOpen, v => save({ hoverToOpen: v }), "悬停展开")),
    row("失去焦点后收起", "鼠标离开后自动恢复静默状态。", toggle(state.settings.autoCollapseOnMouseLeave, v => save({ autoCollapseOnMouseLeave: v }), "自动收起")),
    row("全屏时隐藏", "全屏应用位于当前屏幕时隐藏 Island。", toggle(state.settings.hideWhenFullscreen, v => save({ hideWhenFullscreen: v }), "全屏时隐藏")),
    row("没有会话时隐藏", "仅在 Agent 活动期间显示 Island。", toggle(state.settings.hideWhenNoActiveSessions, v => save({ hideWhenNoActiveSessions: v }), "无会话时隐藏")),
    row("需要操作时展开", "审批、提问或计划确认到来时自动展开。", toggle(state.settings.expandOnActionRequired, v => save({ expandOnActionRequired: v }), "操作时展开")),
    row("任务完成时展开", "Agent 完成当前轮次时短暂展示结果。", toggle(state.settings.expandOnSessionComplete, v => save({ expandOnSessionComplete: v }), "完成时展开"))
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
  root.append(behavior, display);
  return root;
}

function statusBadge(report) {
  const installed = Boolean(report?.installed);
  return el("span", `status ${installed ? "installed" : "missing"}`, installed ? "已连接" : "未连接");
}

async function refreshAgents() {
  const [reports, plugins] = await Promise.all([api.getHookStatus(), api.getPluginAgentMeta()]);
  state.statuses = new Map((reports || []).map(report => [report.agentId, report]));
  state.plugins = plugins || [];
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

function agentCard(agentId, label, color) {
  const report = state.statuses.get(agentId);
  const card = el("div", "agent-card");
  const icon = el("div", "agent-icon", label.slice(0, 1).toUpperCase());
  if (color) icon.style.background = color;
  const content = el("div", "agent-content");
  const heading = el("div", "agent-heading");
  heading.append(el("strong", "", label), statusBadge(report));
  content.append(heading);
  const issues = report?.issues?.filter(Boolean) || [];
  content.append(el("div", "agent-detail", issues.length ? issues[0] : "通过本地 Hook 捕获会话、工具调用和审批请求。"));

  if (APPROVAL_AGENTS.has(agentId)) {
    const approval = select(state.settings.approvalModes?.[agentId] || "bridge", [["bridge", "Island 审批"], ["terminalNative", "终端审批"]], async value => {
      await save({ approvalModes: { ...(state.settings.approvalModes || {}), [agentId]: value } });
      showToast("审批方式已保存，Hook 将自动刷新");
    }, `${label} 审批方式`);
    approval.classList.add("compact-select");
    content.append(approval);
  }

  const installed = Boolean(report?.installed);
  const action = button(installed ? "移除" : "连接", () => setAgentInstalled(agentId, !installed, action), installed ? "secondary" : "primary");
  card.append(icon, content, action);
  return card;
}

function agentsPage() {
  const root = document.createDocumentFragment();
  const hooks = section("本地 Agent", "连接只会修改对应 Agent 的本地 Hook 配置，不依赖云端服务。");
  const grid = el("div", "agent-list");
  const all = [...AGENTS, ...state.plugins.map(p => [p.tool, p.label, p.badgeColor])];
  for (const [id, label, color] of all) grid.append(agentCard(id, label, color));
  hooks.append(grid);
  const tools = el("div", "section-actions");
  tools.append(
    button("刷新状态", () => refreshAgents().catch(error => showToast(error.message, true))),
    button("移除全部 Hook", async () => { await api.uninstallAllHooks(); await refreshAgents(); }, "danger")
  );
  hooks.append(tools);
  root.append(hooks);
  return root;
}

function appearancePage() {
  const root = document.createDocumentFragment();
  const pet = section("桌宠", "桌宠与 Island 使用同一套会话状态，切换不会中断监控。");
  const configuredSprite = state.settings.petSprite || "orca.png";
  const spriteOptions = [["orca.png", "Orca · 内置"]];
  for (const codexPet of state.codexPets) {
    spriteOptions.push([codexPet.value, `${codexPet.displayName} · Codex V2`]);
  }
  if (!spriteOptions.some(([value]) => value === configuredSprite)) {
    spriteOptions.push([configuredSprite, `${configuredSprite} · 当前设置`]);
  }
  const spriteSelect = select(configuredSprite, spriteOptions, value => save({ petSprite: value }), "Codex 桌宠");
  const sprite = document.createElement("input");
  sprite.type = "text";
  sprite.className = "text-input";
  sprite.value = configuredSprite;
  sprite.placeholder = "orca.png 或 codex:qianxue";
  sprite.setAttribute("aria-label", "桌宠精灵素材标识");
  sprite.addEventListener("change", () => save({ petSprite: sprite.value.trim() || "orca.png" }));
  const scale = document.createElement("input");
  scale.type = "range"; scale.min = "0.6"; scale.max = "2"; scale.step = "0.1"; scale.value = state.settings.petScale || 1;
  const scaleValue = el("span", "range-value", `${Number(scale.value).toFixed(1)}×`);
  scale.addEventListener("input", () => scaleValue.textContent = `${Number(scale.value).toFixed(1)}×`);
  scale.addEventListener("change", () => save({ petScale: Number(scale.value) }));
  const scaleControl = el("div", "range-control"); scaleControl.append(scale, scaleValue);
  pet.append(
    row("桌宠预览", "在当前显示器中央显示桌宠；再次点击可收起。", button("显示 / 隐藏桌宠", () => api.togglePet?.())),
    row("桌宠缩放", "调整桌宠在屏幕上的显示尺寸。", scaleControl),
    row("Codex 桌宠", "选择本机 ~/.codex/pets 中的 V2 桌宠；切换后运行中的桌宠会实时换图。", spriteSelect),
    row("自定义素材标识", "默认使用 orca.png；也可填写本地 pet-sprites 目录中的 PNG/WebP 文件名。", sprite),
    row("精灵素材", "打开目录后可替换 PNG 桌宠素材。", button("打开目录", () => api.openSpritesDir()))
  );
  const panel = section("面板", "限制展开面板的高度，避免遮挡主要工作区。");
  const heights = [["420", "紧凑 · 420 px"], ["540", "标准 · 540 px"], ["680", "宽松 · 680 px"]];
  panel.append(row("最大高度", "修改后下一次展开生效。", select(String(state.settings.panelMaxHeightPx || 540), heights, v => save({ panelMaxHeightPx: Number(v) }), "面板最大高度")));
  root.append(pet, panel);
  return root;
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
  version.append(el("div", "app-mark", "O"), el("div", "about-copy", "WorkIsland\n正在读取版本…"));
  api.getAppVersion().then(v => version.querySelector(".about-copy").textContent = `WorkIsland\n版本 ${v}`).catch(() => {});
  about.append(version);
  const actions = el("div", "section-actions");
  actions.append(button("导出诊断日志", async () => { const path = await api.collectLogs(); showToast(path ? "日志已导出" : "日志导出完成"); }), button("退出应用", () => api.quitApp(), "danger"));
  about.append(actions);
  root.append(about);
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
  await loadDisplays();
  await loadCodexPets();
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
  api.onSettingsChanged?.(settings => { state.settings = settings; renderPage(); });
  renderPage();
  refreshAgents().catch(() => {});
}

start().catch(error => {
  document.querySelector("#content").textContent = `设置页加载失败：${error.message}`;
});
