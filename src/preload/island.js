"use strict";
const electron = require("electron");
const ipc = require("../../src/shared/ipc.cjs");
const DEFAULT_NOTCH_INFO = {
  hasNotch: false,
  screenWidth: 0,
  screenHeight: 0,
  screenOriginX: 0,
  screenOriginY: 0,
  scaleFactor: 1,
  notchHeight: 0,
  notchWidth: 0,
  menuBarHeight: 0
};
function parseInitialNotchInfo() {
  const prefix = "--notch-info=";
  const arg = process.argv.find((a) => a.startsWith(prefix));
  if (!arg) return DEFAULT_NOTCH_INFO;
  try {
    return JSON.parse(arg.slice(prefix.length));
  } catch {
    return DEFAULT_NOTCH_INFO;
  }
}
const initialNotchInfo = parseInitialNotchInfo();
electron.contextBridge.exposeInMainWorld("islandBridge", {
  // ── Synchronous initial data (injected via additionalArguments) ──────────
  __initialNotchInfo: initialNotchInfo,
  // ── Main → renderer ────────────────────────────────────────────────────────
  onNotchInfo(cb) {
    electron.ipcRenderer.on(ipc.IPC.ISLAND_NOTCH_INFO, (_event, info) => cb(info));
  },
  onSessionUpdate(cb) {
    electron.ipcRenderer.on(ipc.IPC.ISLAND_SESSION_UPDATE, (_event, sessions) => cb(sessions));
  },
  onPresentSurface(cb) {
    electron.ipcRenderer.on(ipc.IPC.ISLAND_PRESENT_SURFACE, (_event, payload) => cb(payload));
  },
  onQuotaUpdate(cb) {
    electron.ipcRenderer.on(ipc.IPC.ISLAND_QUOTA_UPDATE, (_event, quotas) => cb(quotas));
  },
  onUpdateAvailable(cb) {
    const handler = (_event, update) => cb(update);
    electron.ipcRenderer.on(ipc.IPC.APP_UPDATE_AVAILABLE, handler);
    return () => electron.ipcRenderer.removeListener(ipc.IPC.APP_UPDATE_AVAILABLE, handler);
  },
  // 渲染挂载时主动拉一次当前快照，兜底"启动期间事件已错过"的场景。
  getQuotaMap() {
    return electron.ipcRenderer.invoke(ipc.IPC.USAGE_GET_QUOTA_MAP);
  },
  onSoundStateUpdate(cb) {
    electron.ipcRenderer.on(ipc.IPC.ISLAND_SOUND_STATE, (_event, enabled) => cb(enabled));
  },
  onTodayBurnUpdate(cb) {
    const handler = (_event, total) => cb(total);
    electron.ipcRenderer.on(ipc.IPC.ISLAND_TODAY_BURN_UPDATE, handler);
    return () => {
      electron.ipcRenderer.off(ipc.IPC.ISLAND_TODAY_BURN_UPDATE, handler);
    };
  },
  onMediaStateUpdate(cb) {
    const handler = (_event, state) => cb(state);
    electron.ipcRenderer.on(ipc.IPC.MEDIA_STATE_UPDATE, handler);
    return () => electron.ipcRenderer.off(ipc.IPC.MEDIA_STATE_UPDATE, handler);
  },
  onPerformanceUpdate(cb) {
    const handler = (_event, state) => cb(state);
    electron.ipcRenderer.on(ipc.IPC.PERFORMANCE_STATE_UPDATE, handler);
    return () => electron.ipcRenderer.off(ipc.IPC.PERFORMANCE_STATE_UPDATE, handler);
  },
  onWindowBlur(cb) {
    const handler = () => cb();
    electron.ipcRenderer.on(ipc.IPC.ISLAND_WINDOW_BLUR, handler);
    return () => electron.ipcRenderer.off(ipc.IPC.ISLAND_WINDOW_BLUR, handler);
  },
  // ── Renderer → main ────────────────────────────────────────────────────────
  enterIsland() {
    electron.ipcRenderer.send(ipc.IPC.ISLAND_ENTER);
  },
  leaveIsland() {
    electron.ipcRenderer.send(ipc.IPC.ISLAND_LEAVE);
  },
  panelExpanded() {
    electron.ipcRenderer.send(ipc.IPC.ISLAND_PANEL_EXPANDED);
  },
  panelCollapsed() {
    electron.ipcRenderer.send(ipc.IPC.ISLAND_PANEL_COLLAPSED);
  },
  hideForFocusLoss() {
    electron.ipcRenderer.send(ipc.IPC.ISLAND_FOCUS_LOSS_HIDE);
  },
  syncClosedWindow() {
    electron.ipcRenderer.send(ipc.IPC.ISLAND_SYNC_CLOSED_WINDOW);
  },
  approveSession(sessionId, action) {
    electron.ipcRenderer.send(ipc.IPC.SESSION_APPROVE, { sessionId, action });
  },
  denySession(sessionId) {
    electron.ipcRenderer.send(ipc.IPC.SESSION_DENY, { sessionId });
  },
  answerSession(sessionId, answer) {
    electron.ipcRenderer.send(ipc.IPC.SESSION_ANSWER, { sessionId, answer });
  },
  cancelQuestion(sessionId, cancel) {
    electron.ipcRenderer.send(ipc.IPC.SESSION_CANCEL_QUESTION, { sessionId, cancel });
  },
  confirmPlan(sessionId, choice) {
    electron.ipcRenderer.send(ipc.IPC.SESSION_CONFIRM_PLAN, { sessionId, choice });
  },
  jumpToSession(sessionId) {
    electron.ipcRenderer.send(ipc.IPC.SESSION_JUMP, { sessionId });
  },
  deleteSession(sessionId) {
    electron.ipcRenderer.send(ipc.IPC.SESSION_DELETE, { sessionId });
  },
  deleteSessions(sessionIds) {
    electron.ipcRenderer.send(ipc.IPC.SESSION_DELETE_BATCH, { sessionIds });
  },
  dismissCompletion(sessionId) {
    electron.ipcRenderer.send(ipc.IPC.SESSION_DISMISS_COMPLETION, { sessionId });
  },
  continueSessionViaTerminalPrompt(sessionId, text) {
    return electron.ipcRenderer.invoke(ipc.IPC.SESSION_CONTINUE_VIA_TERMINAL_PROMPT, { sessionId, text });
  },
  openSettings() {
    electron.ipcRenderer.send(ipc.IPC.ISLAND_OPEN_SETTINGS);
  },
  openSettingsTab(tab) {
    electron.ipcRenderer.send(ipc.IPC.ISLAND_OPEN_SETTINGS_TAB, tab);
  },
  toggleSound() {
    electron.ipcRenderer.send(ipc.IPC.ISLAND_TOGGLE_SOUND);
  },
  triggerHaptic() {
    electron.ipcRenderer.send(ipc.IPC.ISLAND_HAPTIC);
  },
  onOnboardingExpand(cb) {
    electron.ipcRenderer.on(ipc.IPC.ISLAND_ONBOARDING_EXPAND, () => cb());
  },
  onToggleExpand(cb) {
    electron.ipcRenderer.on(ipc.IPC.ISLAND_TOGGLE_EXPAND, () => cb());
  },
  onCollapse(cb) {
    electron.ipcRenderer.on(ipc.IPC.ISLAND_COLLAPSE, () => cb());
  },
  onSwitchSession(cb) {
    electron.ipcRenderer.on(ipc.IPC.ISLAND_SWITCH_SESSION, (_e, payload) => cb(payload.direction));
  },
  onConfirmSession(cb) {
    electron.ipcRenderer.on(ipc.IPC.ISLAND_CONFIRM_SESSION, () => cb());
  },
  openExternal(url) {
    electron.ipcRenderer.send(ipc.IPC.APP_OPEN_EXTERNAL, url);
  },
  openAbout() {
    electron.ipcRenderer.send(ipc.IPC.ISLAND_OPEN_ABOUT);
  },
  surfaceDismissed() {
    electron.ipcRenderer.send(ipc.IPC.ISLAND_SURFACE_DISMISSED);
  },
  dragToPet(screenX, screenY) {
    electron.ipcRenderer.send(ipc.IPC.ISLAND_DRAG_TO_PET, { screenX, screenY });
  },
  resizeWindow(height) {
    electron.ipcRenderer.send(ipc.IPC.ISLAND_RESIZE, { height });
  },
  getSettings() {
    return electron.ipcRenderer.invoke(ipc.IPC.SETTINGS_GET);
  },
  getPetSpritePath() {
    return electron.ipcRenderer.invoke(ipc.IPC.PET_GET_SPRITE_PATH);
  },
  getLocale() {
    return electron.ipcRenderer.invoke(ipc.IPC.GET_LOCALE);
  },
  setLocale(locale) {
    return electron.ipcRenderer.invoke(ipc.IPC.SET_LOCALE, { locale });
  },
  onSettingsChanged(cb) {
    const handler = (_event, settings) => cb(settings);
    electron.ipcRenderer.on(ipc.IPC.SETTINGS_DID_CHANGE, handler);
    return () => {
      electron.ipcRenderer.off(ipc.IPC.SETTINGS_DID_CHANGE, handler);
    };
  },
  getStatsSnapshot(timeRange) {
    return electron.ipcRenderer.invoke(ipc.IPC.STATS_GET_SNAPSHOT, { timeRange });
  },
  getMediaState() {
    return electron.ipcRenderer.invoke(ipc.IPC.MEDIA_GET_STATE);
  },
  mediaCommand(command) {
    return electron.ipcRenderer.invoke(ipc.IPC.MEDIA_COMMAND, command);
  },
  getPerformanceState() {
    return electron.ipcRenderer.invoke(ipc.IPC.PERFORMANCE_GET_STATE);
  },
  setPerformanceDetailsVisible(visible) {
    electron.ipcRenderer.send(ipc.IPC.PERFORMANCE_DETAILS_VISIBLE, { visible: Boolean(visible) });
  },
  // Plugin meta：renderer 缓存供 AgentToolBadge 等做 label/badgeColor 兜底。
  getPluginAgentMeta() {
    return electron.ipcRenderer.invoke(ipc.IPC.PLUGIN_AGENT_META);
  }
});
