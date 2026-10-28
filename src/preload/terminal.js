"use strict";
// This preload is sandboxed. Only Electron's limited preload require is used;
// commands bind to event.sender in main, never to a renderer-supplied PTY ID.
const { contextBridge, ipcRenderer } = require('electron');
const CHANNEL = { action: 'terminal:frame-action', state: 'terminal:frame-state', data: 'terminal:data', drag: 'terminal:drag', dragState: 'terminal:drag-state' };
const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const on = (channel, callback) => { const listener = (_event, value) => callback(value); ipcRenderer.on(channel, listener); return () => ipcRenderer.removeListener(channel, listener); };
contextBridge.exposeInMainWorld('terminalBridge', {
  identity: { id: argument('terminal-id'), generation: Number(argument('terminal-generation')) },
  getState: () => ipcRenderer.invoke(CHANNEL.action, { action: 'state' }),
  input: data => ipcRenderer.invoke(CHANNEL.action, { action: 'input', data }),
  resize: (cols, rows) => ipcRenderer.invoke(CHANNEL.action, { action: 'resize', size: { cols, rows } }),
  restart: () => ipcRenderer.invoke(CHANNEL.action, { action: 'restart' }),
  dock: () => ipcRenderer.invoke(CHANNEL.action, { action: 'dock' }),
  minimize: () => ipcRenderer.invoke(CHANNEL.action, { action: 'minimize' }),
  drag: (phase, point) => ipcRenderer.invoke(CHANNEL.drag, { phase, point }),
  onState: callback => on(CHANNEL.state, callback),
  onData: callback => on(CHANNEL.data, callback),
  onDragState: callback => on(CHANNEL.dragState, callback),
  onLocaleChanged: callback => on('locale:did-change', callback),
  getLocaleState: () => ipcRenderer.invoke('locale:get-state')
});
