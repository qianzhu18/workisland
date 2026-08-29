"use strict";
const electron = require("electron");
const ipc = require("../../src/shared/ipc.cjs");
const { parseFileUriList } = require("../../src/shared/shelf-drop-paths.cjs");
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
  onLyricsStateUpdate(cb) {
    const handler = (_event, state) => cb(state);
    electron.ipcRenderer.on(ipc.IPC.LYRICS_STATE_UPDATE, handler);
    return () => electron.ipcRenderer.off(ipc.IPC.LYRICS_STATE_UPDATE, handler);
  },
  onPerformanceUpdate(cb) {
    const handler = (_event, state) => cb(state);
    electron.ipcRenderer.on(ipc.IPC.PERFORMANCE_STATE_UPDATE, handler);
    return () => electron.ipcRenderer.off(ipc.IPC.PERFORMANCE_STATE_UPDATE, handler);
  },
  onShelfUpdate(cb) {
    const handler = (_event, state) => cb(state);
    electron.ipcRenderer.on(ipc.IPC.SHELF_STATE_UPDATE, handler);
    return () => electron.ipcRenderer.off(ipc.IPC.SHELF_STATE_UPDATE, handler);
  },
  onClipboardHistoryUpdate(cb) {
    const handler = (_event, state) => cb(state);
    electron.ipcRenderer.on(ipc.IPC.CLIPBOARD_HISTORY_UPDATE, handler);
    return () => electron.ipcRenderer.off(ipc.IPC.CLIPBOARD_HISTORY_UPDATE, handler);
  },
  onTerminalStatus(cb) {
    const handler = (_event, state) => cb(state);
    electron.ipcRenderer.on(ipc.IPC.TERMINAL_STATUS_UPDATE, handler);
    return () => electron.ipcRenderer.off(ipc.IPC.TERMINAL_STATUS_UPDATE, handler);
  },
  onTerminalData(cb) {
    const handler = (_event, data) => cb(data);
    electron.ipcRenderer.on(ipc.IPC.TERMINAL_DATA, handler);
    return () => electron.ipcRenderer.off(ipc.IPC.TERMINAL_DATA, handler);
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
  setFileDragActive(active) {
    electron.ipcRenderer.send(ipc.IPC.ISLAND_FILE_DRAG_STATE, { active: active === true });
  },
  onNativeShelfDropResult(cb) {
    const handler = (_event, result) => cb(result);
    electron.ipcRenderer.on(ipc.IPC.SHELF_NATIVE_DROP_RESULT, handler);
    return () => electron.ipcRenderer.off(ipc.IPC.SHELF_NATIVE_DROP_RESULT, handler);
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
  getIslandBackgroundImage(imageRef) {
    return electron.ipcRenderer.invoke(ipc.IPC.APPEARANCE_GET_BACKGROUND_IMAGE, imageRef);
  },
  getActiveTemplateStatusAssets() {
    return electron.ipcRenderer.invoke(ipc.IPC.TEMPLATE_GET_ACTIVE_STATUS_ASSETS);
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
  getLyricsState() {
    return electron.ipcRenderer.invoke(ipc.IPC.LYRICS_GET_STATE);
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
  actOnProcess({ pid, name, fingerprint, action }) {
    return electron.ipcRenderer.invoke(ipc.IPC.PERFORMANCE_PROCESS_ACTION, {
      pid: Number(pid),
      name: String(name || ""),
      fingerprint: String(fingerprint || ""),
      action: action === "force" ? "force" : "terminate"
    });
  },
  getShelfState() { return electron.ipcRenderer.invoke(ipc.IPC.SHELF_GET_STATE); },
  getShelfPreview(id) { return electron.ipcRenderer.invoke(ipc.IPC.SHELF_GET_PREVIEW, { id: String(id || "") }); },
  addShelfFiles(files) {
    const paths = Array.from(files || [], (file) => electron.webUtils.getPathForFile(file)).filter(Boolean);
    return electron.ipcRenderer.invoke(ipc.IPC.SHELF_ADD_PATHS, { paths });
  },
  addShelfDrop(files, uriList) {
    const paths = [
      ...Array.from(files || [], (file) => electron.webUtils.getPathForFile(file)).filter(Boolean),
      ...parseFileUriList(uriList)
    ];
    return electron.ipcRenderer.invoke(ipc.IPC.SHELF_ADD_PATHS, { paths: [...new Set(paths)] });
  },
  addShelfPayload(payload) { return electron.ipcRenderer.invoke(ipc.IPC.SHELF_ADD_PAYLOAD, payload); },
  removeShelfItems(ids) { return electron.ipcRenderer.invoke(ipc.IPC.SHELF_REMOVE, { ids }); },
  clearShelf() { return electron.ipcRenderer.invoke(ipc.IPC.SHELF_CLEAR); },
  openShelfItem(id) { return electron.ipcRenderer.invoke(ipc.IPC.SHELF_OPEN, { id }); },
  revealShelfItem(id) { return electron.ipcRenderer.invoke(ipc.IPC.SHELF_REVEAL, { id }); },
  quickLookShelfItem(id) { return electron.ipcRenderer.invoke(ipc.IPC.SHELF_QUICK_LOOK, { id }); },
  startShelfDrag(ids) {
    const normalized = (Array.isArray(ids) ? ids : [ids]).map((id) => String(id || "")).filter(Boolean);
    return electron.ipcRenderer.invoke(ipc.IPC.SHELF_START_DRAG, { ids: normalized });
  },
  pasteShelfFromClipboard() { return electron.ipcRenderer.invoke(ipc.IPC.SHELF_PASTE_FROM_CLIPBOARD); },
  copyShelfItems(ids) { return electron.ipcRenderer.invoke(ipc.IPC.SHELF_COPY_ITEMS, { ids: Array.from(ids || [], String) }); },
  shareShelfItems(ids) { return electron.ipcRenderer.invoke(ipc.IPC.SHELF_SHARE_ITEMS, { ids: Array.from(ids || [], String) }); },
  getShelfShareProviders() { return electron.ipcRenderer.invoke(ipc.IPC.SHELF_GET_SHARE_PROVIDERS); },
  setShelfQuickShareProvider(providerId) { return electron.ipcRenderer.invoke(ipc.IPC.SHELF_SET_QUICK_SHARE_PROVIDER, { providerId: String(providerId || "") }); },
  shareShelfItemsViaDefault(ids) { return electron.ipcRenderer.invoke(ipc.IPC.SHELF_SHARE_VIA_DEFAULT, { ids: Array.from(ids || [], String) }); },
  getAirDropIcon() { return electron.ipcRenderer.invoke(ipc.IPC.SHELF_GET_AIRDROP_ICON); },
  shareShelfItemViaAirDrop(ids) {
    const normalized = (Array.isArray(ids) ? ids : [ids]).map((id) => String(id || "")).filter(Boolean);
    return electron.ipcRenderer.invoke(ipc.IPC.SHELF_SHARE_AIRDROP, { ids: normalized });
  },
  setShelfShareDropBounds(bounds) {
    electron.ipcRenderer.send(ipc.IPC.SHELF_SHARE_DROP_BOUNDS, bounds || null);
  },
  getClipboardHistory() { return electron.ipcRenderer.invoke(ipc.IPC.CLIPBOARD_HISTORY_GET_STATE); },
  replayClipboardEntry(id) { return electron.ipcRenderer.invoke(ipc.IPC.CLIPBOARD_HISTORY_REPLAY, { id }); },
  favoriteClipboardEntry(id, favorite) { return electron.ipcRenderer.invoke(ipc.IPC.CLIPBOARD_HISTORY_FAVORITE, { id, favorite: Boolean(favorite) }); },
  removeClipboardEntries(ids) { return electron.ipcRenderer.invoke(ipc.IPC.CLIPBOARD_HISTORY_REMOVE, { ids }); },
  clearClipboardHistory() { return electron.ipcRenderer.invoke(ipc.IPC.CLIPBOARD_HISTORY_CLEAR); },
  getTerminalState() { return electron.ipcRenderer.invoke(ipc.IPC.TERMINAL_GET_STATE); },
  startTerminal(options = {}) { return electron.ipcRenderer.invoke(ipc.IPC.TERMINAL_START, options); },
  sendTerminalInput(data) { return electron.ipcRenderer.invoke(ipc.IPC.TERMINAL_INPUT, { data: String(data || "") }); },
  resizeTerminal(cols, rows) { return electron.ipcRenderer.invoke(ipc.IPC.TERMINAL_RESIZE, { cols: Number(cols), rows: Number(rows) }); },
  restartTerminal(options = {}) { return electron.ipcRenderer.invoke(ipc.IPC.TERMINAL_RESTART, options); },
  stopTerminal() { return electron.ipcRenderer.invoke(ipc.IPC.TERMINAL_STOP); },
  runSavedTerminalCommand(id) { return electron.ipcRenderer.invoke(ipc.IPC.TERMINAL_RUN_SAVED_COMMAND, { id: String(id || "") }); },
  // Plugin meta：renderer 缓存供 AgentToolBadge 等做 label/badgeColor 兜底。
  getPluginAgentMeta() {
    return electron.ipcRenderer.invoke(ipc.IPC.PLUGIN_AGENT_META);
  }
});
