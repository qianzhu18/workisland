#!/usr/bin/env node
// Exercise the helper through its signed Electron parent: launching the helper
// directly does not reproduce TCC's responsible-app permission checks.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import WebSocket from 'ws';

const app = resolve(process.argv[2]);
const root = await mkdtemp(join(tmpdir(), 'workisland-native-smoke-'));
const server = createServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
await writeFile(join(root, 'settings.json'), JSON.stringify({
  hasCompletedOnboarding: true, telemetryEnabled: false, telemetryPolicyVersion: 2,
  updateChecksEnabled: false, systemAudioEnabled: true, systemLockScreenEnabled: false
}));
const child = spawn(join(app, 'Contents/MacOS/WorkIsland'), [
  `--smoke-user-data=${root}`, `--remote-debugging-port=${port}`, '--smoke-quit-after=30000'
], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', b => { output = (output + b).slice(-16000); });
child.stderr.on('data', b => { output = (output + b).slice(-16000); });
const exited = once(child, 'exit');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let target;
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null) throw new Error(`Packaged app exited early: ${output}`);
    try {
      target = (await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())).find(t => t.url.endsWith('/island.html'));
    } catch {}
    if (target) break;
    await wait(100);
  }
  assert.ok(target, `Packaged island did not start: ${output}`);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await once(socket, 'open');
  let id = 0;
  const pending = new Map();
  socket.on('message', raw => {
    const msg = JSON.parse(raw), p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id); clearTimeout(p.timer);
    if (msg.error || msg.result?.exceptionDetails) p.reject(new Error(JSON.stringify(msg)));
    else p.resolve(msg.result?.result?.value);
  });
  const evaluate = expression => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject, timer: setTimeout(() => reject(new Error('Packaged IPC timed out')), 5000) });
    socket.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  let state;
  for (let n = 0; n < 60; n++) {
    state = await evaluate('window.islandBridge.getSystemStatus()');
    assert.equal(state.nativeError, null, `Native helper failed: ${JSON.stringify(state)}`);
    if (state.battery.available && state.network.available) break;
    await wait(100);
  }
  assert.equal(state.battery.available, true, 'No battery capability snapshot from signed parent');
  assert.equal(state.network.available, true, 'No network capability snapshot from signed parent');
  // A no-op configure still exercises audio again; observe several timer ticks.
  await evaluate('window.islandBridge.setSettings({systemAudioEnabled:false})');
  await evaluate('window.islandBridge.setSettings({systemAudioEnabled:true})');
  await wait(4000);
  state = await evaluate('window.islandBridge.getSystemStatus()');
  assert.equal(state.nativeError, null);
  assert.equal(state.audio.enabled, true);
  assert.equal(state.battery.available, true);
  assert.equal(state.network.available, true);
  console.log('Packaged native status passed: signed parent, audio re-enable, battery/network snapshots, no TCC termination.');
} finally {
  socket?.close();
  if (child.exitCode === null) child.kill('SIGTERM');
  await exited;
  await rm(root, { recursive: true, force: true });
}
