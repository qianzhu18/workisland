"use strict";
const electron = require("electron");
const ipc = require("../../src/shared/ipc.cjs");
electron.contextBridge.exposeInMainWorld("welcomeBridge", {
  platform: process.platform,
  getLocaleState() {
    return electron.ipcRenderer.invoke(ipc.IPC.LOCALE_GET_STATE);
  },
  setLanguagePreference(preference) {
    return electron.ipcRenderer.invoke(ipc.IPC.LOCALE_SET_PREFERENCE, { preference });
  },
  onLocaleChanged(cb) {
    const handler = (_event, snapshot) => cb(snapshot);
    electron.ipcRenderer.on(ipc.IPC.LOCALE_DID_CHANGE, handler);
    return () => electron.ipcRenderer.off(ipc.IPC.LOCALE_DID_CHANGE, handler);
  },
  getStarted() {
    // 引导完成信号。遥测不再随引导提交选择（2026-08-22 默认开启政策，
    // 披露与开关在「设置 → 关于」）。
    electron.ipcRenderer.send(ipc.IPC.WELCOME_GET_STARTED);
  },
  getFirstLaunchAt() {
    return electron.ipcRenderer.invoke(ipc.IPC.WELCOME_GET_FIRST_LAUNCH_AT);
  }
});
