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
    electron.ipcRenderer.send(ipc.IPC.WELCOME_GET_STARTED);
  },
  getFirstLaunchAt() {
    return electron.ipcRenderer.invoke(ipc.IPC.WELCOME_GET_FIRST_LAUNCH_AT);
  }
});
