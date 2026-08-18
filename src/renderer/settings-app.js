"use strict";

const api = window.settingsApi;

const DEFAULT_PET_SPRITE = "echo.png";
const FEEDBACK_URL = "https://workisland.yanglaishe.cn/#feedback";
const BETA_GROUP_URL = "https://workisland.yanglaishe.cn/#beta-group";
const USER_GUIDE_URL = "https://workisland.yanglaishe.cn/guide/";
const WORKISLAND_ICON_URL = "../assets/workisland-icon.png";
const DEFAULT_AGENT_ICON_URL = "../assets/brands/agent.svg";
const AGENT_ICON_URLS = Object.freeze({
  claude: "../assets/brands/claude.svg",
  codex: "../assets/brands/codex.png",
  coco: "../assets/brands/trae.svg",
  cursor: "../assets/brands/cursor.svg",
  trae: "../assets/brands/trae.svg",
  "trae-cn": "../assets/brands/trae.svg",
  zcode: "../assets/brands/zcode.svg",
  workbuddy: "../assets/brands/codebuddy.svg",
  opencode: "../assets/brands/opencode.svg",
  sara: "../assets/brands/sara.svg",
  kimi: "../assets/brands/kimi.svg",
  gemini: "../assets/brands/gemini.svg",
  "copilot-cli": "../assets/brands/copilot.svg",
  hermes: "../assets/brands/hermes.svg",
  aiden: "../assets/brands/agent.svg",
  traex: "../assets/brands/trae.svg",
  "plugin:omp": "../assets/brands/pi.svg",
  "plugin:pi": "../assets/brands/pi.svg"
});
const state = { settings: null, statuses: new Map(), displays: [], codexPets: [], activeTab: "general", busy: new Set(), latestUpdate: null };

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
    row("贴边模式", "脱离顶部刘海，变成可拖动的贴边条：拖动时收成小方块，松手吸附到最近的边（上/左/右）。贴左右时是竖条、展开为竖长面板；贴顶部时是横条。", toggle(state.settings.islandPlacement === "docked", v => save({ islandPlacement: v ? "docked" : "notch" }), "贴边模式")),
    row("悬停展开", "鼠标停留在 Island 上时展开面板。", toggle(state.settings.hoverToOpen, v => save({ hoverToOpen: v }), "悬停展开")),
    row("失去焦点后隐藏", "失去窗口焦点后隐藏 Island；鼠标移到顶部热区可恢复。", toggle(state.settings.autoCollapseOnMouseLeave, v => save({ autoCollapseOnMouseLeave: v }), "失去焦点后隐藏")),
    row("全屏时隐藏", "全屏应用位于当前屏幕时隐藏 Island。", toggle(state.settings.hideWhenFullscreen, v => save({ hideWhenFullscreen: v }), "全屏时隐藏")),
    row("没有会话时隐藏", "仅在 Agent 活动期间显示 Island。", toggle(state.settings.hideWhenNoActiveSessions, v => save({ hideWhenNoActiveSessions: v }), "无会话时隐藏")),
    row("需要操作时展开", "审批、提问或计划确认到来时自动展开。", toggle(state.settings.expandOnActionRequired, v => save({ expandOnActionRequired: v }), "操作时展开")),
    row("任务完成时展开", "Agent 完成当前轮次时短暂展示结果。", toggle(state.settings.expandOnSessionComplete, v => save({ expandOnSessionComplete: v }), "完成时展开")),
    row(
      "完成通知停留时间",
      "只影响任务完成通知；审批、提问和失败通知会保留到你处理为止。",
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
  root.append(behavior, display);
  return root;
}

/**
 * Echo 标识。
 * 比例取自形象源文件 echo-meta.json：眼宽为身宽的 6%、眼间距 34.6%、
 * 位于身高 51% 处。方眼 + 朱砂回响粒是 Echo 的识别特征，
 * 缩到 28px 仍然立得住 —— 这也是它比字母 "O" 更适合做标识的原因。
 */
function echoMark() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("aria-hidden", "true");
  const add = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    svg.append(n);
    return n;
  };
  // 身体：Apple 图标网格的超椭圆近似
  add("rect", { x: 6, y: 6, width: 88, height: 88, rx: 24, fill: "#1F1B16" });
  // 顶面高光，对应 Echo 身上那道浅褐色盖沿
  add("rect", { x: 20, y: 20, width: 60, height: 7, rx: 3, fill: "#3C342C" });
  // 方眼
  add("rect", { x: 30.5, y: 45, width: 13, height: 13.5, fill: "#F8F2E6" });
  add("rect", { x: 56.5, y: 45, width: 13, height: 13.5, fill: "#F8F2E6" });
  // 回响粒
  add("rect", { x: 74, y: 70, width: 8, height: 8, fill: "#C4452D" });
  return svg;
}

/** 侧栏导航图标。原先是 ◉ ⌘ ◆ ♪ ⓘ 这些文本字符，
 *  字重和基线跟随系统字体，永远对不齐也不受 CSS 控制。 */
const NAV_ICONS = {
  general: "M4 7h16M4 12h16M4 17h16M11 4.9v4.2M15.6 9.9v4.2M8.6 14.9v4.2",
  agents: "M4.8 5.4h14.4a1.4 1.4 0 0 1 1.4 1.4v10.4a1.4 1.4 0 0 1-1.4 1.4H4.8a1.4 1.4 0 0 1-1.4-1.4V6.8a1.4 1.4 0 0 1 1.4-1.4ZM7.8 9.8 10.4 12l-2.6 2.2M12.8 14.6h3.6",
  appearance: "M11 4.6c.8 3.9 2.3 5.4 6.2 6.2-3.9.8-5.4 2.3-6.2 6.2-.8-3.9-2.3-5.4-6.2-6.2 3.9-.8 5.4-2.3 6.2-6.2ZM18 15.2c.3 1.5.9 2.1 2.4 2.4-1.5.3-2.1.9-2.4 2.4-.3-1.5-.9-2.1-2.4-2.4 1.5-.3 2.1-.9 2.4-2.4Z",
  sound: "M4.6 9.6h3L11.4 6v12L7.6 14.4h-3ZM14.8 9.6a3.4 3.4 0 0 1 0 4.8M17.6 7.2a7 7 0 0 1 0 9.6",
  statistics: "M4.4 19.4h15.2M7.2 19.4V11M12 19.4V5.6M16.8 19.4v-5.6",
  about: "M12 3.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4ZM12 11v5.2M12 7.6h.01",
};

function navIcon(tab) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", NAV_ICONS[tab] || NAV_ICONS.about);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.6");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

/**
 * Agent 标识。
 * 11 个有官方品牌矢量（Simple Icons，CC0），统一渲染为单色墨迹；
 * 其余小众 CLI 无公开品牌标，用中性方框兜底，保持列表视觉一致。
 * 颜色只表达连接状态，不承载身份 —— 避免十几个 agent 挤在同一段蓝紫色里。
 */
const AGENT_MARKS = {
  claude: "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z",
  codex: "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z",
  coco: "M24 20.5H3.5V17H0V3.5h24ZM3.5 17h17V7h-17Zm8.5-5-2.5 2.5L7 12l2.5-2.5Zm7 0-2.5 2.5L14 12l2.5-2.5z",
  cursor: "M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23",
  trae: "M24 20.5H3.5V17H0V3.5h24ZM3.5 17h17V7h-17Zm8.5-5-2.5 2.5L7 12l2.5-2.5Zm7 0-2.5 2.5L14 12l2.5-2.5z",
  "trae-cn": "M24 20.5H3.5V17H0V3.5h24ZM3.5 17h17V7h-17Zm8.5-5-2.5 2.5L7 12l2.5-2.5Zm7 0-2.5 2.5L14 12l2.5-2.5z",
  traex: "M24 20.5H3.5V17H0V3.5h24ZM3.5 17h17V7h-17Zm8.5-5-2.5 2.5L7 12l2.5-2.5Zm7 0-2.5 2.5L14 12l2.5-2.5z",
  opencode: "M22 24H2V0h20zM17 4.8H7v14.4h10z",
  kimi: "M21.765.351C22.998.351 24 1.353 24 2.586S22.998 4.82 21.765 4.82h-1.974c-.15 0-.26-.12-.26-.26V2.586A2.237 2.237 0 0 1 21.765.35M9.41 13.388l8.447-8.377c.16-.16.07-.471-.14-.471h-4.55s-.1.02-.14.06l-9.099 9.029c-.14.14-.35.02-.35-.21V4.81c0-.15-.1-.27-.221-.27H.22c-.12 0-.22.12-.22.27v18.57c0 .15.1.27.22.27h3.137c.12 0 .22-.12.22-.27v-3.79c0-.08.03-.16.08-.21l2.826-2.796c.07-.07.16-.08.241-.03l7.546 5.551a8.9 8.9 0 0 0 4.018 1.493c.12.01.23-.11.23-.27V19.76c0-.14-.08-.25-.19-.26a5.8 5.8 0 0 1-2.355-.942l-6.533-4.73c-.14-.09-.15-.32-.03-.441",
  gemini: "M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81",
  "copilot-cli": "M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z",
  // Pi 系列走插件注册表，agentId 带 plugin: 前缀。
  // π 是字符形，用描边比填充更接近字面本身。
  "plugin:pi": { d: "M4.6 8.2h14.8M8.9 8.2v9.6M15.2 8.2v6.8c0 1.7 1 2.8 2.6 2.8" },
  "plugin:omp": { d: "M3.8 9.6h12.8M7.7 9.6v8.2M13.6 9.6v5.6c0 1.5.9 2.4 2.3 2.4M19.6 3.4c.26 1.24.72 1.7 1.96 1.96-1.24.26-1.7.72-1.96 1.96-.26-1.24-.72-1.7-1.96-1.96 1.24-.26 1.7-.72 1.96-1.96Z", w: "1.6" },
};
const FALLBACK_MARK = "M12 2.6A9.4 9.4 0 1 0 12 21.4 9.4 9.4 0 0 0 12 2.6Zm0 2.2a7.2 7.2 0 1 1 0 14.4 7.2 7.2 0 0 1 0-14.4Zm0 4.4a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z";

function agentGlyph(agentId) {
  const mark = AGENT_MARKS[agentId] || FALLBACK_MARK;
  const stroked = typeof mark === "object";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", stroked ? mark.d : mark);
  if (stroked) {
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", mark.w || "1.8");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
  } else {
    path.setAttribute("fill", "currentColor");
  }
  svg.append(path);
  return svg;
}

function statusBadge(report) {
  const installed = Boolean(report?.installed);
  const unavailable = report?.available === false;
  const text = installed ? "已连接" : unavailable ? "未检测" : "未连接";
  const node = el("span", `status ${installed ? "installed" : "missing"}`);
  node.append(el("span", "status-dot"), el("span", "", text));
  return node;
}

async function refreshAgents() {
  const reports = await api.getHookStatus();
  state.statuses = new Map((reports || []).map(report => [report.agentId, report]));
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
  const installed = Boolean(report?.installed);
  const card = el("div", `agent-card${installed ? " connected" : ""}`);
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
  const detail = report.available === false && !report.installed
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
  const hooks = section("本地 Agent", "连接只会修改对应 Agent 的本地 Hook 配置，不依赖云端服务。");
  const grid = el("div", "agent-list");
  for (const report of state.statuses.values()) grid.append(agentCard(report));
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
  const configuredSprite = state.settings.petSprite || DEFAULT_PET_SPRITE;
  const spriteOptions = [["echo:little", "Echo · 程序化动画"], [DEFAULT_PET_SPRITE, "千雪 · 内置 Codex V2"], ["orca.png", "Orca · 兼容素材"]];
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
  const appMark = el("img", "app-mark");
  appMark.src = WORKISLAND_ICON_URL;
  appMark.alt = "";
  appMark.draggable = false;
  version.append(appMark, el("div", "about-copy", "WorkIsland\n正在读取版本…"));
  api.getAppVersion().then(v => version.querySelector(".about-copy").textContent = `WorkIsland\n版本 ${v}`).catch(() => {});
  about.append(version);
  const support = section("帮助与内测", "操作手册、反馈渠道与内测群信息由 WorkIsland 官网统一维护，无需重新安装即可更新。");
  support.append(
    row("产品手册", "查看安装、首次任务、状态理解、隐私与反馈说明。", button("打开手册", () => api.openExternal(USER_GUIDE_URL), "primary")),
    row("提交反馈", "报告问题、提出建议或补充复现信息。", button("打开反馈入口", () => api.openExternal(FEEDBACK_URL), "primary")),
    row("加入内测群", "查看最新 WorkIsland 微信内测群二维码。", button("查看群码", () => api.openExternal(BETA_GROUP_URL)))
  );
  const updates = section("更新", "仅请求官方版本信息，不上传会话内容或使用数据。");
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
  const updateControls = el("div", "inline-controls");
  updateControls.append(updateStatus, checkButton, openButton);
  updates.append(
    row("自动检查更新", "安装版每天检查一次 GitHub Release；关闭后仍可手动检查。", toggle(state.settings.updateChecksEnabled, v => save({ updateChecksEnabled: v }), "自动检查更新")),
    row("版本检查", "发现新版本后会提醒，并提供官方下载页。", updateControls)
  );
  const actions = el("div", "section-actions");
  actions.append(button("导出诊断日志", async () => { const path = await api.collectLogs(); showToast(path ? "日志已导出" : "日志导出完成"); }), button("退出应用", () => api.quitApp(), "danger"));
  about.append(actions);
  const privacy = section("匿名使用统计", "默认关闭。开启后仅上报事件类型与 Agent 名称等匿名统计。");
  privacy.append(
    row(
      "允许匿名使用统计",
      "不包含会话内容、文件路径或个人信息；关闭时会立即清空未上报的数据。目的地为 PostHog（美国区），事件清单见开源代码 telemetry.cjs。",
      toggle(state.settings.telemetryEnabled, v => save({ telemetryEnabled: v }), "允许匿名使用统计")
    )
  );
  root.append(about, support, privacy, updates);
  return root;
}


/**
 * 统计页。
 *
 * 桌宠上那枚小火苗（token 用量档位）点击后调的是 openSettingsTab("statistics")，
 * 但 PAGES 与别名表里都没有 statistics —— 导航判空后什么都不做，于是只是打开
 * 设置窗口停在上次的标签页，是个死的跳转目标。
 * preload 早就暴露了 getStatsSnapshot，数据和通道都在，缺的只是这个页面。
 */
const statsState = { range: "today", snapshot: null };

function formatCount(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)} 亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)} 万`;
  return n.toLocaleString("zh-CN");
}

function statsPage() {
  const root = document.createDocumentFragment();
  const snap = statsState.snapshot;

  const overview = section("用量", "全部为本地统计，不会上传。");
  const rangeSelect = select(statsState.range, [["today", "今天"], ["week", "近 7 天"]], async value => {
    statsState.range = value;
    await loadStats();
    renderPage();
  }, "统计范围");
  overview.append(row("统计范围", "切换后立即重新汇总。", rangeSelect));

  const valueRow = (title, description, value) =>
    row(title, description, el("div", "stat-value", value));

  if (!snap) {
    overview.append(valueRow("暂无数据", "还没有已完成的会话记录。", "—"));
    root.append(overview);
    return root;
  }

  const totalTokens = snap.totalInputTokens + snap.totalOutputTokens;
  overview.append(
    valueRow("会话数", "已完成的 Agent 会话。", formatCount(snap.totalSessionCount)),
    valueRow("Token 总量", "输入 + 输出（不含缓存）。", formatCount(totalTokens)),
    valueRow("输入", "发送给模型的 token。", formatCount(snap.totalInputTokens)),
    valueRow("输出", "模型生成的 token。", formatCount(snap.totalOutputTokens)),
    valueRow("缓存读取", "命中提示词缓存，单独统计，不计入总量。", formatCount(snap.totalCacheReadTokens)),
    valueRow("缓存创建", "写入提示词缓存，单独统计，不计入总量。", formatCount(snap.totalCacheCreationTokens))
  );
  if (snap.mostUsedAgent) {
    overview.append(valueRow(
      "最常用",
      `${snap.mostUsedAgent} · 占全部会话的 ${snap.mostUsedAgentPercent}%`,
      formatCount(snap.mostUsedAgentCount)
    ));
  }
  root.append(overview);

  const rows = (snap.agentAggregates || []).filter(a => a.sessionCount > 0
    || a.totalInputTokens > 0 || a.totalOutputTokens > 0);
  if (rows.length > 0) {
    const byAgent = section("按 Agent", "同一时间范围内的分项。");
    const list = el("div", "agent-list");
    rows.sort((a, b) => (b.totalInputTokens + b.totalOutputTokens)
      - (a.totalInputTokens + a.totalOutputTokens));
    for (const a of rows) {
      const card = el("div", "agent-card connected");
      const icon = el("div", "agent-icon");
      icon.append(agentGlyph(a.tool));
      const content = el("div", "agent-content");
      const label = state.statuses.get(a.tool)?.label || a.tool;
      const heading = el("div", "agent-heading");
      heading.append(el("strong", "", label));
      content.append(heading);
      content.append(el("div", "agent-detail",
        `${a.sessionCount} 个会话 · 输入 ${formatCount(a.totalInputTokens)} · 输出 ${formatCount(a.totalOutputTokens)}`));
      card.append(icon, content, el("div", "stat-value",
        formatCount(a.totalInputTokens + a.totalOutputTokens)));
      list.append(card);
    }
    byAgent.append(list);
    root.append(byAgent);
  }
  return root;
}

async function loadStats() {
  try {
    statsState.snapshot = await api.getStatsSnapshot?.(statsState.range) || null;
  } catch {
    statsState.snapshot = null;
  }
}

const PAGES = { general: generalPage, agents: agentsPage, appearance: appearancePage, sound: soundPage, statistics: statsPage, about: aboutPage };

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
  document.querySelectorAll(".nav-item").forEach(item => {
    const slot = item.querySelector(".nav-icon");
    if (slot) slot.replaceChildren(navIcon(item.dataset.tab));
  });
  const brandSlot = document.querySelector(".brand-mark");
  if (brandSlot) brandSlot.replaceChildren(echoMark());
  document.querySelectorAll(".nav-item").forEach(item => item.addEventListener("click", () => {
    state.activeTab = item.dataset.tab;
    renderPage();
    if (state.activeTab === "agents") refreshAgents().catch(error => showToast(error.message, true));
    if (state.activeTab === "statistics") loadStats().then(renderPage).catch(() => {});
  }));
  api.onNavigateToTab?.(tab => {
    const aliases = { hooks: "agents", pet: "appearance", display: "general", stats: "statistics", usage: "statistics" };
    const next = aliases[tab] || tab;
    if (PAGES[next]) {
      state.activeTab = next;
      renderPage();
      if (next === "statistics") loadStats().then(renderPage).catch(() => {});
    }
  });
  api.onSettingsChanged?.(settings => { state.settings = settings; renderPage(); });
  renderPage();
  refreshAgents().catch(() => {});
}

start().catch(error => {
  document.querySelector("#content").textContent = `设置页加载失败：${error.message}`;
});
