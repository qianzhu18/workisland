"use strict";
const electron = require("electron");
const ipc = require("../../src/shared/ipc.cjs");
electron.contextBridge.exposeInMainWorld("debugBridge", {
  async getStatus() {
    return electron.ipcRenderer.invoke(ipc.IPC.DEBUG_GET_STATUS);
  },
  resetOnboarding() {
    electron.ipcRenderer.send(ipc.IPC.DEBUG_RESET_ONBOARDING);
  }
});
