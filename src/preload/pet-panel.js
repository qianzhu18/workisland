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
  onSurface(cb) {
    electron.ipcRenderer.on(ipc.IPC.PET_PANEL_SURFACE, (_event, surface) => cb(surface));
  },
  getLocale() {
    return electron.ipcRenderer.invoke(ipc.IPC.GET_LOCALE);
  },
  setLocale(locale) {
    return electron.ipcRenderer.invoke(ipc.IPC.SET_LOCALE, { locale });
  }
});
electron.contextBridge.exposeInMainWorld("islandBridge", sessionApi);
