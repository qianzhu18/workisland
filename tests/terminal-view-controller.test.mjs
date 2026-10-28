import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { TerminalService } from '../src/main/terminal-service.cjs';
import { TerminalViewController } from '../src/main/terminal-view-controller.cjs';
let nextId = 100;
class Contents extends EventEmitter {
  id = ++nextId; dead = false; sent = []; loads = 0;
  async loadFile() { this.loads++; }
  isDestroyed() { return this.dead; }
  send(channel, value) { this.sent.push({ channel, value }); }
  close() { this.dead = true; this.emit('destroyed'); }
  focus() { this.focused = true; }
  setWindowOpenHandler() {}
}
class Parent { children = new Set(); addChildView(view) { this.children.add(view); } removeChildView(view) { this.children.delete(view); } }
class Host extends EventEmitter {
  contentView = new Parent(); dead = false; visible = false; focused = false;
  bounds = { x: 200, y: 150, width: 740, height: 480 };
  isDestroyed() { return this.dead; }
  isFocused() { return this.focused; }
  getBounds() { return { ...this.bounds }; }
  getContentBounds() { return this.getBounds(); }
  setBounds(bounds) { this.bounds = { ...bounds }; this.emit('resize'); }
  setTitle(title) { this.title = title; }
  show() { this.visible = true; }
  focus() { this.focused = true; this.emit('focus'); }
  minimize() { this.focused = false; this.emit('blur'); }
  destroy() { this.dead = true; this.emit('closed'); }
  close() { let prevented = false; this.emit('close', { preventDefault() { prevented = true; } }); if (!prevented) this.destroy(); }
}
function setup() {
  const children = [], views = [], hosts = [], island = new Host(); let cursor = { x: 700, y: 400 }, failWindow = false;
  const service = new TerminalService({ homeDir: '/home/test', pathExists: () => true, spawnPty: () => {
    const child = { pid: ++nextId, write() {}, resize() {}, kill() { this.killed = true; }, onData(fn) { this.data = fn; }, onExit(fn) { this.exit = fn; } }; children.push(child); return child;
  } });
  const controller = new TerminalViewController({ service, getIslandWindow: () => island,
    createView: () => { const view = { webContents: new Contents(), setBounds(value) { this.bounds = value; }, setVisible(value) { this.visible = value; } }; views.push(view); return view; },
    createWindow: options => { if (failWindow) throw new Error('Host unavailable'); const host = new Host(); host.bounds = { x: options.x, y: options.y, width: options.width, height: options.height }; hosts.push(host); return host; },
    screen: { getCursorScreenPoint: () => cursor, getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }), getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1440, height: 900 } }] }
  });
  return { service, controller, island, children, views, hosts, cursor: p => { cursor = p; }, failWindow: () => { failWindow = true; } };
}
const bounds = { x: 20, y: 100, width: 600, height: 300 };

test('detach and dock move the same view without spawning or destroying a PTY', async () => {
  const f = setup(), id = f.service.create().id;
  await f.controller.show(id, bounds);
  const view = f.views[0];
  assert.ok(f.island.contentView.children.has(view));
  await f.controller.detach(id);
  assert.equal(f.service.snapshot(id).location, 'desktop');
  assert.equal(f.island.contentView.children.has(view), false);
  assert.ok(f.hosts[0].contentView.children.has(view));
  await f.controller.dock(id);
  assert.equal(f.service.snapshot(id).location, 'island');
  assert.ok(f.island.contentView.children.has(view));
  assert.equal(f.hosts[0].dead, true);
  assert.equal(view.webContents.loads, 1);
  assert.equal(view.webContents.dead, false);
  assert.equal(f.children.length, 1);
  assert.equal(f.children[0].killed, undefined);
  f.controller.dispose(); f.service.dispose();
});

test('closing a desktop window docks; closing the session disposes only its view', async () => {
  const f = setup(), a = f.service.create().id, b = f.service.create().id;
  await f.controller.detach(a); await f.controller.detach(b);
  f.hosts[0].close(); await new Promise(r => setImmediate(r));
  assert.equal(f.service.snapshot(a).location, 'island');
  assert.equal(f.children[0].killed, undefined);
  f.service.close(a);
  assert.equal(f.views[0].webContents.dead, true);
  assert.equal(f.views[1].webContents.dead, false);
  assert.equal(f.service.snapshot(b).running, true);
  f.controller.dispose(); f.service.dispose();
});

test('bound frame commands cannot address siblings or old generations', async () => {
  const f = setup(), a = f.service.create().id, b = f.service.create().id;
  await f.controller.show(a, bounds); const sender = f.views[0].webContents;
  assert.equal(await f.controller.frameAction(sender, { action: 'input', id: b, data: 'bad' }), false);
  const snapshot = await f.controller.frameAction(sender, { action: 'state' });
  assert.equal(snapshot.id, a); assert.equal(snapshot.sessions, undefined);
  f.service.restart({}, a); await new Promise(r => setImmediate(r));
  assert.equal(await f.controller.frameAction(sender, { action: 'input', data: 'late' }), false);
  f.controller.dispose(); f.service.dispose();
});

test('window creation failure keeps the original view and task in the Island', async () => {
  const f = setup(), id = f.service.create().id; await f.controller.show(id, bounds); f.failWindow();
  await assert.rejects(f.controller.detach(id), /Host unavailable/);
  assert.ok(f.island.contentView.children.has(f.views[0]));
  assert.equal(f.service.snapshot(id).location, 'island');
  assert.equal(f.children[0].killed, undefined);
  f.controller.dispose(); f.service.dispose();
});

test('disable and disposal clean windows and views without leaving a late load attached', async () => {
  const f = setup(), id = f.service.create().id; await f.controller.detach(id);
  f.service.setEnabled(false);
  assert.equal(f.views[0].webContents.dead, true); assert.equal(f.hosts[0].dead, true);
  assert.equal(f.children[0].killed, true);
  f.controller.dispose(); f.service.dispose();
});

test('a view loading after disable cannot attach or revive its terminal', async () => {
  const f = setup(), id = f.service.create().id;
  let ready; const original = f.controller.createView;
  f.controller.createView = options => { const view = original(options); view.webContents.loadFile = () => new Promise(resolve => { ready = resolve; }); return view; };
  const opening = f.controller.detach(id);
  f.service.setEnabled(false); ready();
  assert.equal(await opening, false); assert.equal(f.hosts.length, 0);
  assert.equal(f.views[0].webContents.dead, true); assert.equal(f.children[0].killed, true);
  f.controller.dispose(); f.service.dispose();
});

test('drag commits only on release; cancel restores window bounds without moving the view', async () => {
  const f = setup(), id = f.service.create().id; await f.controller.detach(id);
  f.controller.setDockBounds({ x: 0, y: 0, width: 600, height: 200 });
  const sender = f.views[0].webContents, initial = f.hosts[0].getBounds();
  f.controller.drag(sender, { phase: 'begin' }); f.cursor({ x: 300, y: 180 });
  f.controller.drag(sender, { phase: 'move' });
  assert.equal(f.service.snapshot(id).location, 'desktop');
  assert.notDeepEqual(f.hosts[0].getBounds(), initial);
  f.controller.drag(sender, { phase: 'cancel' });
  assert.deepEqual(f.hosts[0].getBounds(), initial);
  assert.equal(f.views[0].webContents.sent.at(-1).value.active, false);
  f.controller.drag(sender, { phase: 'begin' }); f.cursor({ x: 350, y: 200 });
  await f.controller.drag(sender, { phase: 'end' });
  assert.equal(f.service.snapshot(id).location, 'island');
  assert.equal(f.children[0].killed, undefined);
  f.controller.dispose(); f.service.dispose();
});

test('removed display restores desktop hosts inside the remaining work area', async () => {
  const f = setup(), id = f.service.create().id; await f.controller.detach(id);
  f.hosts[0].setBounds({ x: 3000, y: -800, width: 740, height: 460 });
  f.controller.repositionDesktopWindows();
  const b = f.hosts[0].getBounds();
  assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= 1440 && b.y + b.height <= 900);
  assert.equal(f.service.snapshot(id).location, 'desktop');
  assert.equal(f.children[0].killed, undefined);
  f.controller.dispose(); f.service.dispose();
});

test('captured event positions survive cursor movement before asynchronous IPC delivery', async () => {
  const f = setup(), id = f.service.create().id; await f.controller.detach(id);
  const sender = f.views[0].webContents, initial = f.hosts[0].getBounds();
  // The live cursor has already returned elsewhere by the time IPC is handled.
  f.cursor({ x: 900, y: 800 });
  f.controller.drag(sender, { phase: 'begin', point: { x: 700, y: 400 } });
  await f.controller.drag(sender, { phase: 'end', point: { x: 760, y: 430 } });
  const after = f.hosts[0].getBounds();
  assert.equal(after.x - initial.x, 60); assert.equal(after.y - initial.y, 30);
  f.controller.dispose(); f.service.dispose();
});

test('dragging out places the new host at the captured drop point instead of the later live cursor', async () => {
  const f = setup(), id = f.service.create().id; await f.controller.show(id, bounds);
  f.island.webContents = new Contents(); f.controller.setDockBounds({ x: 0, y: 0, width: 600, height: 200 });
  f.cursor({ x: 1200, y: 800 });
  f.controller.drag(f.island.webContents, { id, phase: 'begin', point: { x: 300, y: 200 } });
  await f.controller.drag(f.island.webContents, { id, phase: 'end', point: { x: 700, y: 500 } });
  assert.equal(f.service.snapshot(id).location, 'desktop');
  assert.equal(f.hosts[0].getBounds().x, 610);
  assert.equal(f.children[0].killed, undefined);
  f.controller.dispose(); f.service.dispose();
});
