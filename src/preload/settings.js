"use strict";
const electron = require("electron");
const ipc = require("../../src/shared/ipc.cjs");
electron.contextBridge.exposeInMainWorld("settingsApi", {
  platform: process.platform,
  getSettings: () => electron.ipcRenderer.invoke(ipc.IPC.SETTINGS_GET),
  getTelemetryStatus: () => electron.ipcRenderer.invoke(ipc.IPC.SETTINGS_GET_TELEMETRY_STATUS),
  getLocale: () => electron.ipcRenderer.invoke(ipc.IPC.GET_LOCALE),
  setLocale: (locale) => electron.ipcRenderer.invoke(ipc.IPC.SET_LOCALE, { locale }),
  setSettings: (partial) => electron.ipcRenderer.invoke(ipc.IPC.SETTINGS_SET, partial),
  listTemplates: () => electron.ipcRenderer.invoke(ipc.IPC.TEMPLATE_LIST),
  clearLyricsCache: () => electron.ipcRenderer.invoke(ipc.IPC.LYRICS_CLEAR_CACHE),
  getShelfShareProviders: () => electron.ipcRenderer.invoke(ipc.IPC.SHELF_GET_SHARE_PROVIDERS),
  selectDirectory: () => electron.ipcRenderer.invoke(ipc.IPC.SETTINGS_SELECT_DIRECTORY),
  getHookStatus: () => electron.ipcRenderer.invoke(ipc.IPC.SETTINGS_GET_HOOK_STATUS),
  copyImageToClipboard: (rect) => electron.ipcRenderer.invoke(ipc.IPC.SETTINGS_COPY_IMAGE_TO_CLIPBOARD, { rect }),
  copyImageDataUrlToClipboard: (dataUrl) => electron.ipcRenderer.invoke(ipc.IPC.SETTINGS_COPY_IMAGE_DATA_URL_TO_CLIPBOARD, { dataUrl }),
  installHook: (agentId) => electron.ipcRenderer.invoke(ipc.IPC.SETTINGS_INSTALL_HOOK, { agentId }),
  uninstallHook: (agentId) => electron.ipcRenderer.invoke(ipc.IPC.SETTINGS_UNINSTALL_HOOK, { agentId }),
  uninstallAllHooks: () => electron.ipcRenderer.invoke(ipc.IPC.SETTINGS_UNINSTALL_ALL_HOOKS),
  repairHook: (agentId) => electron.ipcRenderer.invoke(ipc.IPC.SETTINGS_REPAIR_HOOK, { agentId }),
  repairAllHooks: () => electron.ipcRenderer.invoke(ipc.IPC.SETTINGS_REPAIR_ALL_HOOKS),
  getDoctorAudit: () => electron.ipcRenderer.invoke(ipc.IPC.SETTINGS_GET_DOCTOR_AUDIT),
  // 插件元信息：renderer 缓存供 AgentToolBadge 等做 label/badgeColor 兜底。
  getPluginAgentMeta: () => electron.ipcRenderer.invoke(ipc.IPC.PLUGIN_AGENT_META),
  onSettingsChanged: (cb) => {
    const handler = (_event, settings) => cb(settings);
    electron.ipcRenderer.on(ipc.IPC.SETTINGS_DID_CHANGE, handler);
    return () => electron.ipcRenderer.removeListener(ipc.IPC.SETTINGS_DID_CHANGE, handler);
  },
  getDisplays: () => electron.ipcRenderer.invoke(ipc.IPC.SETTINGS_GET_DISPLAYS),
  getCodexPets: () => electron.ipcRenderer.invoke(ipc.IPC.SETTINGS_GET_CODEX_PETS),
  quitApp: () => {
    electron.ipcRenderer.send(ipc.IPC.APP_QUIT);
  },
  previewSound: (filename, volume) => {
    electron.ipcRenderer.send(ipc.IPC.SETTINGS_PREVIEW_SOUND, { filename, volume });
  },
  openSoundsDir: () => {
    electron.ipcRenderer.send(ipc.IPC.SETTINGS_OPEN_SOUNDS_DIR);
  },
  openSpritesDir: () => {
    electron.ipcRenderer.send(ipc.IPC.PET_OPEN_SPRITES_DIR);
  },
  togglePet: () => {
    electron.ipcRenderer.send(ipc.IPC.PET_TOGGLE);
  },
  openExternal: (url) => {
    electron.ipcRenderer.send(ipc.IPC.APP_OPEN_EXTERNAL, url);
  },
  checkForUpdates: () => electron.ipcRenderer.invoke(ipc.IPC.APP_CHECK_FOR_UPDATES),
  onUpdateAvailable: (cb) => {
    const handler = (_event, update) => cb(update);
    electron.ipcRenderer.on(ipc.IPC.APP_UPDATE_AVAILABLE, handler);
    return () => electron.ipcRenderer.removeListener(ipc.IPC.APP_UPDATE_AVAILABLE, handler);
  },
  getUpdateState: () => electron.ipcRenderer.invoke(ipc.IPC.APP_UPDATE_STATE),
  downloadUpdate: () => electron.ipcRenderer.invoke(ipc.IPC.APP_UPDATE_DOWNLOAD),
  installUpdate: () => electron.ipcRenderer.invoke(ipc.IPC.APP_UPDATE_INSTALL),
  onUpdateState: (cb) => {
    const handler = (_event, state) => cb(state);
    electron.ipcRenderer.on(ipc.IPC.APP_UPDATE_STATE, handler);
    return () => electron.ipcRenderer.removeListener(ipc.IPC.APP_UPDATE_STATE, handler);
  },
  getAppVersion: () => electron.ipcRenderer.invoke(ipc.IPC.GET_APP_VERSION),
  onNavigateToTab: (cb) => {
    electron.ipcRenderer.on(ipc.IPC.SETTINGS_NAVIGATE_TO_TAB, (_event, tab) => cb(tab));
  },
  onShortcutStatus: (cb) => {
    electron.ipcRenderer.on(ipc.IPC.SETTINGS_SHORTCUT_STATUS, (_event, status) => cb(status));
  },
  getShortcutStatus: () => electron.ipcRenderer.invoke(ipc.IPC.SETTINGS_GET_SHORTCUT_STATUS),
  collectLogs: () => electron.ipcRenderer.invoke(ipc.IPC.COLLECT_LOGS),
  getStatsSnapshot: (timeRange) => electron.ipcRenderer.invoke(ipc.IPC.STATS_GET_SNAPSHOT, { timeRange })
});
electron.contextBridge.exposeInMainWorld("welcomeBridge", {
  getFirstLaunchAt() {
    return electron.ipcRenderer.invoke(ipc.IPC.WELCOME_GET_FIRST_LAUNCH_AT);
  }
});
