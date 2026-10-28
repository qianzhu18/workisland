"use strict";
const path = require('node:path');
const { IPC } = require('../shared/ipc.cjs');
const { normalizeViewBounds, containsPoint, desktopBounds } = require('../shared/terminal-window-geometry.cjs');

class TerminalViewController {
  constructor({ service, getIslandWindow, createView, createWindow, screen, onDock = () => {}, onDesktopFocus = () => {}, onDragState = () => {}, onDragLease = () => {}, onRestart,
    filePath = path.join(__dirname, '../renderer/terminal/terminal.html'), preloadPath = path.join(__dirname, '../preload/terminal.js') }) {
    const native = (!createView || !createWindow || !screen) ? require('electron') : null;
    this.service = service; this.getIslandWindow = getIslandWindow;
    this.createView = createView || (options => new native.WebContentsView(options));
    this.createWindow = createWindow || (options => new native.BaseWindow(options));
    this.screen = screen || native.screen; this.onDock = onDock; this.onDesktopFocus = onDesktopFocus;
    this.onDragState = onDragState; this.onDragLease = onDragLease; this.onRestart = onRestart || (id => service.restart({}, id));
    this.filePath = filePath; this.preloadPath = preloadPath; this.records = new Map(); this.disposed = false; this.layoutTicket = 0;
    this.statusListener = state => this.sync(state); this.dataListener = frame => {
      const record = this.records.get(frame.id);
      if (record && record.generation === frame.generation) this.send(record, IPC.TERMINAL_DATA, frame);
    };
    this.displayListener = () => { this.cancelDrag(); this.repositionDesktopWindows(); };
    this.screen.on?.('display-removed', this.displayListener);
    this.screen.on?.('display-metrics-changed', this.displayListener);
    service.on('status', this.statusListener); service.on('data', this.dataListener);
  }
  current(record) { return !this.disposed && this.records.get(record.id) === record && this.service.enabled && this.service.sessions.get(record.id)?.generation === record.generation; }
  send(record, channel, value) { if (!record.view.webContents.isDestroyed()) record.view.webContents.send(channel, value); }
  frameSnapshot(record, history = true) {
    const state = this.service.snapshot(record.id, history);
    if (!state) return null;
    const { sessions, activeId, revision, enabled, maxSessions, ...own } = state;
    return { ...own, location: record.host, viewport: record.viewport || null };
  }
  push(record) { if (this.current(record)) this.send(record, IPC.TERMINAL_FRAME_STATE, this.frameSnapshot(record, false)); }
  async ensure(id) {
    const session = this.service.sessions.get(id);
    if (this.disposed || !this.service.enabled || !session) return null;
    const existing = this.records.get(id);
    if (existing && existing.generation === session.generation) return existing.ready;
    if (existing) this.release(existing);
    const view = this.createView({ webPreferences: { preload: this.preloadPath, contextIsolation: true, sandbox: true, nodeIntegration: false,
      backgroundThrottling: false, additionalArguments: [`--terminal-id=${id}`, `--terminal-generation=${session.generation}`] } });
    const record = { id, generation: session.generation, view, host: 'island', parent: null, window: null, bounds: null };
    this.records.set(id, record); view.setVisible(false);
    view.webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
    view.webContents.on('will-navigate', event => event.preventDefault());
    view.webContents.on('render-process-gone', () => { if (this.records.get(id) === record) { this.release(record); this.service.setLocation(id, 'island'); } });
    record.ready = Promise.resolve(view.webContents.loadFile(this.filePath)).then(() => {
      if (!this.current(record)) return null;
      this.push(record); return record;
    }).catch(error => { if (this.records.get(id) === record) this.release(record); throw error; });
    return record.ready;
  }
  transfer(record, parent) {
    const previous = record.parent;
    if (previous === parent) return;
    previous?.contentView.removeChildView(record.view);
    try { parent.contentView.addChildView(record.view); record.parent = parent; }
    catch (error) { previous?.contentView.addChildView(record.view); throw error; }
  }
  async show(id, bounds, { focus = false } = {}) {
    const island = this.getIslandWindow(); if (!island || island.isDestroyed()) return false;
    const rect = normalizeViewBounds(bounds, island.getContentBounds()); if (!rect) return false;
    const ticket = ++this.layoutTicket; this.islandRequest = { id, ticket };
    const record = await this.ensure(id);
    if (!record || !this.current(record) || this.islandRequest?.ticket !== ticket || this.service.activeId !== id || record.host === 'desktop') return false;
    for (const other of this.records.values()) if (other !== record && other.host === 'island') other.view.setVisible(false);
    this.transfer(record, island); record.bounds = rect; record.viewport = { width: rect.width, height: rect.height }; record.view.setBounds(rect); this.push(record); record.view.setVisible(true);
    if (focus) record.view.webContents.focus();
    return this.service.snapshot(id, false);
  }
  hide(id) {
    if (this.islandRequest?.id === id) this.islandRequest = null;
    const record = this.records.get(id);
    if (record?.host === 'island') {
      const focused = record.view.webContents.isFocused?.(); record.view.setVisible(false);
      const island = this.getIslandWindow();
      if (focused && island && !island.isDestroyed() && island.isFocused()) island.webContents?.focus();
    }
  }
  fitDesktop(record) {
    if (!record.window || record.window.isDestroyed()) return;
    const bounds = record.window.getContentBounds();
    record.viewport = { width: bounds.width, height: bounds.height };
    record.view.setBounds({ x: 0, y: 0, ...record.viewport }); this.push(record);
  }
  async detach(id, dropPoint) {
    const record = await this.ensure(id); if (!record || !this.current(record)) return false;
    if (record.host === 'desktop') return this.focus(id);
    const point = dropPoint || this.screen.getCursorScreenPoint(), display = this.screen.getDisplayNearestPoint(point);
    const size = record.bounds ? { width: record.bounds.width, height: record.bounds.height + 36 } : {};
    const bounds = desktopBounds({ x: point.x - 90, y: point.y - 18 }, display.workArea, size);
    const window = this.createWindow({ ...bounds, minWidth: 420, minHeight: 260, show: false, useContentSize: true,
      title: this.service.snapshot(id, false)?.name || 'WorkIsland Terminal', backgroundColor: '#07090c' });
    const outer = window.getBounds();
    window.setBounds(desktopBounds(outer, display.workArea, outer));
    try { this.transfer(record, window); }
    catch (error) { window.destroy(); throw error; }
    record.window = window; record.host = 'desktop'; this.hide(id);
    window.on('resize', () => this.fitDesktop(record));
    window.on('focus', () => this.onDesktopFocus(this.hasFocusedDesktop()));
    window.on('blur', () => { this.onDesktopFocus(false); if (this.dragState?.id === id) this.cancelDrag(); });
    window.on('close', event => {
      if (!this.disposed && this.current(record) && record.window === window) {
        event.preventDefault(); void this.dock(id).catch(() => {});
      }
    });
    window.on('closed', () => { if (record.window === window) { record.window = null; this.onDesktopFocus(this.hasFocusedDesktop()); } });
    this.fitDesktop(record); record.view.setVisible(true); this.service.setLocation(id, 'desktop'); this.push(record);
    window.show(); window.focus(); record.view.webContents.focus();
    return this.service.snapshot(id, false);
  }
  async dock(id) {
    const record = await this.ensure(id); if (!record || !this.current(record)) return false;
    const island = this.getIslandWindow(); if (!island || island.isDestroyed()) return false;
    const oldWindow = record.window;
    this.transfer(record, island); record.window = null; record.host = 'island'; record.view.setVisible(false);
    if (record.bounds) { record.viewport = { width: record.bounds.width, height: record.bounds.height }; record.view.setBounds(record.bounds); }
    oldWindow?.destroy(); this.service.setLocation(id, 'island'); this.service.select(id); this.push(record);
    this.onDesktopFocus(this.hasFocusedDesktop()); this.onDock(id);
    return this.service.snapshot(id, false);
  }
  repositionDesktopWindows() {
    for (const record of this.records.values()) {
      if (record.host !== 'desktop' || !record.window || record.window.isDestroyed()) continue;
      const bounds = record.window.getBounds(), point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      const workArea = this.screen.getDisplayNearestPoint(point).workArea;
      record.window.setBounds(desktopBounds(bounds, workArea, bounds));
    }
  }
  focus(id) {
    const record = this.records.get(id);
    if (!record || record.host !== 'desktop' || record.window?.isDestroyed()) return false;
    record.window.show(); record.window.focus(); record.view.webContents.focus(); return this.service.snapshot(id, false);
  }
  hasFocusedDesktop() { return [...this.records.values()].some(r => r.host === 'desktop' && r.window && !r.window.isDestroyed() && r.window.isFocused()); }
  recordFor(sender) { return [...this.records.values()].find(r => r.view.webContents === sender && this.current(r)); }
  async frameAction(sender, payload = {}) {
    const record = this.recordFor(sender); if (!record || (payload.id && payload.id !== record.id)) return false;
    switch (payload.action) {
      case 'state': return this.frameSnapshot(record);
      case 'input': return this.service.input(payload.data, record.id);
      case 'resize': return this.service.resize(payload.size, record.id);
      case 'restart': return this.onRestart(record.id);
      case 'dock': return this.dock(record.id);
      case 'minimize': record.window?.minimize(); return true;
      default: return false;
    }
  }
  setDockBounds(bounds) {
    const island = this.getIslandWindow(); if (!island || island.isDestroyed()) return;
    this.dockBounds = normalizeViewBounds(bounds, { ...island.getContentBounds(), height: Math.max(96, island.getContentBounds().height) });
  }
  overDock(point) {
    const island = this.getIslandWindow(); if (!island || island.isDestroyed() || !this.dockBounds) return false;
    const origin = island.getContentBounds(); return containsPoint({ ...this.dockBounds, x: origin.x + this.dockBounds.x, y: origin.y + this.dockBounds.y }, point);
  }
  drag(sender, payload = {}) {
    const bound = this.recordFor(sender), islandSender = this.getIslandWindow()?.webContents;
    const id = bound?.id || (sender === islandSender ? payload.id : null);
    if (!id || !this.service.sessions.has(id) || !['begin', 'move', 'end', 'cancel'].includes(payload.phase)) return false;
    // Capture the event's DIP position before IPC delivery; sampling only the
    // live cursor here can lose an entire fast drag. Only this owned view moves.
    const point = payload.point && [payload.point.x, payload.point.y].every(Number.isFinite)
      && Math.abs(payload.point.x) < 100000 && Math.abs(payload.point.y) < 100000
      ? { x: payload.point.x, y: payload.point.y } : this.screen.getCursorScreenPoint();
    if (payload.phase === 'begin') {
      this.cancelDrag();
      const record = this.records.get(id);
      this.dragState = { id, sender, from: record?.host || 'island', start: point, bounds: record?.window?.getBounds(), moved: false };
      this.dragTimer = setTimeout(() => this.cancelDrag(), 20000); this.dragTimer.unref?.(); this.onDragLease(true); return true;
    }
    const state = this.dragState; if (!state || state.id !== id || state.sender !== sender) return false;
    if (payload.phase === 'cancel') { this.cancelDrag(); return true; }
    state.moved ||= Math.hypot(point.x - state.start.x, point.y - state.start.y) >= 6;
    if (state.from === 'desktop' && state.moved) {
      const record = this.records.get(id);
      record?.window?.setBounds({ ...state.bounds, x: Math.round(state.bounds.x + point.x - state.start.x), y: Math.round(state.bounds.y + point.y - state.start.y) });
    }
    const over = this.overDock(point), drag = { active: state.moved, from: state.from, over, id };
    this.onDragState(drag);
    const record = this.records.get(id); if (record) this.send(record, IPC.TERMINAL_DRAG_STATE, drag);
    if (payload.phase !== 'end') return true;
    this.finishDrag();
    if (state.moved && state.from === 'desktop' && over) return this.dock(id);
    if (state.moved && state.from === 'island' && !over) return this.detach(id, point);
    return true;
  }
  finishDrag() {
    clearTimeout(this.dragTimer); const record = this.records.get(this.dragState?.id); this.dragState = null;
    if (record) this.send(record, IPC.TERMINAL_DRAG_STATE, { active: false });
    this.onDragState({ active: false }); this.onDragLease(false);
  }
  cancelDrag() {
    const state = this.dragState;
    if (state?.from === 'desktop' && state.moved) this.records.get(state.id)?.window?.setBounds(state.bounds);
    this.finishDrag();
  }
  sync(state) {
    for (const record of [...this.records.values()]) {
      const next = state.sessions.find(s => s.id === record.id);
      if (!state.enabled || !next) { this.release(record); continue; }
      if (next.generation !== record.generation) {
        const desktop = record.host === 'desktop'; this.release(record);
        if (desktop) void this.detach(next.id).catch(() => {});
      } else { record.window?.setTitle(next.name || `WorkIsland Terminal ${next.ordinal}`); this.push(record); }
    }
  }
  release(record) {
    if (this.records.get(record.id) !== record) return;
    if (this.dragState?.id === record.id) this.cancelDrag();
    this.records.delete(record.id); record.parent?.contentView.removeChildView(record.view); record.parent = null;
    const window = record.window; record.window = null; window?.destroy();
    if (!record.view.webContents.isDestroyed()) record.view.webContents.close({ waitForBeforeUnload: false });
    this.onDesktopFocus(this.hasFocusedDesktop());
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.cancelDrag();
    this.screen.off?.('display-removed', this.displayListener);
    this.screen.off?.('display-metrics-changed', this.displayListener);
    this.service.off('status', this.statusListener); this.service.off('data', this.dataListener);
    for (const record of [...this.records.values()]) this.release(record);
  }
}
module.exports = { TerminalViewController };
