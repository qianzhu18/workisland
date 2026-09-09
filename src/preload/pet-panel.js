"use strict";
const electron = require("electron");
const ipc = require("../../src/shared/ipc.cjs");
const sessionApi = {
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
  dismissCompletion(sessionId) {
    electron.ipcRenderer.send(ipc.IPC.SESSION_DISMISS_COMPLETION, { sessionId });
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
  openExternal(url) {
    electron.ipcRenderer.send(ipc.IPC.APP_OPEN_EXTERNAL, url);
  },
  openSettingsTab(tab) {
    electron.ipcRenderer.send(ipc.IPC.ISLAND_OPEN_SETTINGS_TAB, tab);
  },
  undoSettingsChanges(changeIds) {
    return electron.ipcRenderer.invoke(ipc.IPC.ISLAND_UNDO_SETTINGS_CHANGES, { changeIds });
  }
};
electron.contextBridge.exposeInMainWorld("petPanelBridge", {
  onInit(cb) {
    electron.ipcRenderer.on(ipc.IPC.PET_PANEL_INIT, (_event, payload) => cb(payload));
  },
  onSessionUpdate(cb) {
    electron.ipcRenderer.on(ipc.IPC.PET_SESSION_UPDATE, (_event, sessions) => cb(sessions));
  },
  ready() {
    electron.ipcRenderer.send(ipc.IPC.PET_PANEL_READY);
  },
  resize(height) {
    electron.ipcRenderer.send(ipc.IPC.PET_PANEL_RESIZE, height);
  },
  collapse() {
    electron.ipcRenderer.send(ipc.IPC.PET_PANEL_COLLAPSE);
  },
  onSurface(cb) {
    electron.ipcRenderer.on(ipc.IPC.PET_PANEL_SURFACE, (_event, surface) => cb(surface));
  },
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
  }
});
electron.contextBridge.exposeInMainWorld("islandBridge", sessionApi);
