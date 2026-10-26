import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import WebSocket from 'ws';

const port = Number(process.env.FLUX_DEBUG_PORT || 9347);
const evidence = resolve('.local-data/native-status-evidence');
await mkdir(evidence, { recursive: true });
const targets = () => fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => { socket.once('open', resolveOpen); socket.once('error', reject); });
  let id = 0;
  const pending = new Map();
  socket.on('message', raw => {
    const message = JSON.parse(raw);
    if (!pending.has(message.id)) return;
    const { resolveCall, reject, timer } = pending.get(message.id); pending.delete(message.id); clearTimeout(timer);
    if (message.error) reject(new Error(message.error.message)); else resolveCall(message.result);
  });
  const call = (method, params = {}) => new Promise((resolveCall, reject) => {
    const request = ++id;
    const timer = setTimeout(() => { pending.delete(request); reject(new Error(`Timed out: ${method}`)); }, 8000);
    pending.set(request, { resolveCall, reject, timer }); socket.send(JSON.stringify({ id: request, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  return { call, evaluate, close: () => socket.close() };
}
const welcome = (await targets()).find(target => target.url.endsWith('/welcome.html'));
if (welcome) { const client = await connect(welcome); await client.evaluate("document.querySelector('.welcome-btn')?.click()"); client.close(); await wait(1000); }
const target = (await targets()).find(item => item.url.endsWith('/island.html'));
assert.ok(target, 'isolated WorkIsland must be running');
assert.ok(target.url.includes('/workisland/src/'), 'use a source development instance');
const client = await connect(target);
try {
  await client.call('Runtime.enable');
  await client.evaluate('location.reload()'); await wait(1000);
  const status = await client.evaluate('window.islandBridge.getSystemStatus()');
  assert.ok(status.battery.available, 'native battery service available');
  assert.ok(status.network.available, 'native network service available');
  assert.ok(status.audio.available, 'native audio service available');
  await client.evaluate("document.querySelector('.pill')?.click()"); await wait(450);
  const button = await client.evaluate("!!document.querySelector('[data-tool-id=\"system-status\"] button')");
  assert.ok(button, 'system status is a toolbar button');
  assert.equal(await client.evaluate("document.querySelectorAll('.system-status-toggle').length"), 0, 'standalone disclosure row was removed');
  await client.evaluate("document.querySelector('[data-tool-id=\"system-status\"] button').click()"); await wait(250);
  assert.ok(await client.evaluate("!!document.querySelector('.system-status-heading') && !!document.querySelector('.system-status-rows')"), 'one click opens full details');
  const detailClip = await client.evaluate("(()=>{const r=document.querySelector('.island-panel-layer').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()");
  const shot = await client.call('Page.captureScreenshot', { format: 'png', clip: detailClip });
  await writeFile(resolve(evidence, 'system-status-details.png'), Buffer.from(shot.data, 'base64'));
  await writeFile(resolve(evidence, 'real-system-snapshot.json'), JSON.stringify(status, null, 2));
  // This optional path records four seconds locally, without audio, solely to
  // exercise the actual global capture notification. The movie is deleted.
  if (process.argv.includes('--capture')) {
    // Exercise the existing focus-loss close path; a pill click only opens.
    await client.evaluate("window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('blur'))");
    await wait(500);
    assert.ok(await client.evaluate("document.querySelector('.island-panel-layer').classList.contains('is-hidden')"), "island is collapsed before testing an automatic popup");
    const movie = resolve(evidence, 'temporary-capture.mov');
    const recording = spawn('screencapture', ['-x', '-v', '-V', '4', movie], { stdio: 'ignore' });
    const completion = new Promise(resolveExit => recording.once('exit', resolveExit));
    await wait(1200);
    const during = await client.evaluate('window.islandBridge.getSystemStatus()');
    const popup = await client.evaluate("document.querySelector('.system-notice-content')?.textContent || ''");
    await writeFile(resolve(evidence, 'capture-observation.json'), JSON.stringify({ active: during.capture.active, notice: during.notice, popup, locked: during.locked }, null, 2));
    const noticeClip = await client.evaluate("(()=>{const r=document.querySelector('.island-panel-layer').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()");
    const captureShot = await client.call('Page.captureScreenshot', { format: 'png', clip: noticeClip });
    await writeFile(resolve(evidence, 'capture-status-popup.png'), Buffer.from(captureShot.data, 'base64'));
    await completion; await wait(500);
    const after = await client.evaluate('window.islandBridge.getSystemStatus()');
    await rm(movie, { force: true });
    assert.equal(during.capture.active, true, 'actual recording detected');
    assert.equal(after.capture.active, false, 'recording end detected');
    assert.ok(popup, 'capture change automatically presents a compact popup');
    assert.equal(after.notice.kind, 'capture-stopped', 'recording end announces its own transition');
    assert.ok(await client.evaluate("!!document.querySelector('.system-notice-content')"), 'end notification is visible');
    await wait(5200);
    assert.ok(await client.evaluate("document.querySelector('.island-panel-layer').classList.contains('is-hidden')"), 'status popup automatically retracts');
  }
  console.log(JSON.stringify({ ok: true, evidence, battery: status.battery, networkAvailable: status.network.available, audioAvailable: status.audio.available }, null, 2));
} finally { client.close(); }
