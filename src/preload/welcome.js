"use strict";
const electron = require("electron");
const ipc = require("../../src/shared/ipc.cjs");
electron.contextBridge.exposeInMainWorld("welcomeBridge", {
  getLocale() {
    return electron.ipcRenderer.invoke(ipc.IPC.GET_LOCALE);
  },
  setLocale(locale) {
    return electron.ipcRenderer.invoke(ipc.IPC.SET_LOCALE, { locale });
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
