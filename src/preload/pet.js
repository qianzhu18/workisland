"use strict";
const electron = require("electron");
const ipc = require("../../src/shared/ipc.cjs");
electron.contextBridge.exposeInMainWorld("petBridge", {
  onSessionUpdate(cb) {
    electron.ipcRenderer.on(ipc.IPC.PET_SESSION_UPDATE, (_event, sessions) => cb(sessions));
  },
  onTodayBurnUpdate(cb) {
    const handler = (_event, total) => cb(total);
    electron.ipcRenderer.on(ipc.IPC.PET_TODAY_BURN_UPDATE, handler);
    return () => {
      electron.ipcRenderer.off(ipc.IPC.PET_TODAY_BURN_UPDATE, handler);
    };
  },
  enterPet() {
    electron.ipcRenderer.send(ipc.IPC.PET_ENTER);
  },
  leavePet() {
    electron.ipcRenderer.send(ipc.IPC.PET_LEAVE);
  },
  movePet(dx, dy) {
    electron.ipcRenderer.send(ipc.IPC.PET_MOVE, dx, dy);
  },
  returnToIsland() {
    electron.ipcRenderer.send(ipc.IPC.PET_RETURN_TO_ISLAND);
  },
  openSettingsTab(tab) {
    electron.ipcRenderer.send(ipc.IPC.ISLAND_OPEN_SETTINGS_TAB, tab);
  },
  togglePanel() {
    electron.ipcRenderer.send(ipc.IPC.PET_TOGGLE_PANEL);
  },
  onPanelState(cb) {
    electron.ipcRenderer.on(ipc.IPC.PET_PANEL_STATE, (_event, state) => cb(state));
  },
  onSizeUpdate(cb) {
    electron.ipcRenderer.on(ipc.IPC.PET_SIZE_UPDATE, (_event, size) => cb(size));
  },
  ready() {
    electron.ipcRenderer.send(ipc.IPC.PET_READY);
  },
  getSpritePath(fileName) {
    return electron.ipcRenderer.invoke(ipc.IPC.PET_GET_SPRITE_PATH, fileName);
  }
});
