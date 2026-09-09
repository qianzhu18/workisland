"use strict";
const electron = require("electron");
const ipc = require("../../src/shared/ipc.cjs");
electron.contextBridge.exposeInMainWorld("debugBridge", {
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
  async getStatus() {
    return electron.ipcRenderer.invoke(ipc.IPC.DEBUG_GET_STATUS);
  },
  resetOnboarding() {
    electron.ipcRenderer.send(ipc.IPC.DEBUG_RESET_ONBOARDING);
  }
});
