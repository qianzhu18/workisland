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
    const cameraSafety = process.argv.includes('--camera-safety');
    if (cameraSafety) await client.evaluate(`(() => {
      window.__hudMotion = { running:true, frames:[], flashes:0, lastHUD:-1000 };
      const tick = time => {
        const trace=window.__hudMotion; if (!trace?.running) return;
        const layer=document.querySelector('.island-panel-layer'), hud=layer?.querySelector('.system-notice-panel');
        const opacity=layer ? Number(getComputedStyle(layer).opacity) : 0;
        if (opacity > .05 && hud) {
          trace.lastHUD=time;
          const icon=hud.querySelector('.system-icon').getBoundingClientRect(),title=hud.querySelector('strong').getBoundingClientRect();
          const transform=getComputedStyle(document.querySelector('.island-pop-wrapper')).transform;
          const matrix=new DOMMatrix(transform==='none'?undefined:transform);
          trace.frames.push({time,top:title.top,iconTop:icon.top,height:hud.getBoundingClientRect().height,scaleX:matrix.a,scaleY:matrix.d,exiting:layer.classList.contains('is-hidden')});
        } else if (opacity > .05 && time-trace.lastHUD < 280 && !hud) trace.flashes++;
        requestAnimationFrame(tick);
      }; requestAnimationFrame(tick);
    })()`);
    const movie = resolve(evidence, 'temporary-capture.mov');
    const recording = spawn('screencapture', ['-x', '-v', '-V', cameraSafety ? '8' : '4', movie], { stdio: 'ignore' });
    const completion = new Promise(resolveExit => recording.once('exit', resolveExit));
    await wait(1200);
    const during = await client.evaluate('window.islandBridge.getSystemStatus()');
    const popup = await client.evaluate("document.querySelector('.system-notice-content')?.textContent || ''");
    await writeFile(resolve(evidence, 'capture-observation.json'), JSON.stringify({ active: during.capture.active, notice: during.notice, popup, locked: during.locked }, null, 2));
    const noticeClip = await client.evaluate("(()=>{const r=document.querySelector('.island-panel-layer').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()");
    const captureShot = await client.call('Page.captureScreenshot', { format: 'png', clip: noticeClip });
    await writeFile(resolve(evidence, 'capture-status-popup.png'), Buffer.from(captureShot.data, 'base64'));
    if (cameraSafety) {
      await wait(4500);
      const wings = await client.evaluate(`(() => {
        const p=document.querySelector('.pill-notch-system'), icon=p?.querySelector('.system-icon')?.getBoundingClientRect(), indicator=p?.querySelector('.system-pill-indicator')?.getBoundingClientRect();
        const width=window.islandBridge.__initialNotchInfo.notchWidth;
        return {notched:window.islandBridge.__initialNotchInfo.hasNotch,leftRight:icon?.right,rightLeft:indicator?.left,cameraLeft:(innerWidth-width)/2,cameraRight:(innerWidth+width)/2,labels:p?.querySelectorAll('.pill-label').length};
      })()`);
      if (wings.notched) {
        assert.ok(wings.leftRight <= wings.cameraLeft - 6, 'persistent recording icon clears camera');
        assert.ok(wings.rightLeft >= wings.cameraRight + 6, 'persistent recording indicator clears camera');
        assert.equal(wings.labels, 0, 'no recording text behind physical camera');
      }
      await writeFile(resolve(evidence, 'persistent-recording-wings.json'), JSON.stringify(wings, null, 2));
    }
    await completion; await wait(500);
    const after = await client.evaluate('window.islandBridge.getSystemStatus()');
    await rm(movie, { force: true });
    assert.equal(during.capture.active, true, 'actual recording detected');
    assert.equal(after.capture.active, false, 'recording end detected');
    assert.ok(popup, 'capture change automatically presents a compact popup');
    const clearance = await client.evaluate(`(() => {
      const inset = window.islandBridge.__initialNotchInfo;
      const title = document.querySelector('.system-notice-content strong');
      const icon = document.querySelector('.system-notice-content .system-icon');
      return { safeTop: inset.hasNotch ? inset.notchHeight : 0, titleTop: title?.getBoundingClientRect().top, iconTop: icon?.getBoundingClientRect().top };
    })()`);
    assert.ok(clearance.titleTop >= clearance.safeTop + 6, 'HUD title must clear the physical MacBook camera');
    assert.ok(clearance.iconTop >= clearance.safeTop + 6, 'HUD icon must clear the physical MacBook camera');
    assert.equal(after.notice.kind, 'capture-stopped', 'recording end announces its own transition');
    assert.ok(await client.evaluate("!!document.querySelector('.system-notice-content')"), 'end notification is visible');
    await wait(5200);
    assert.ok(await client.evaluate("document.querySelector('.island-panel-layer').classList.contains('is-hidden')"), 'status popup automatically retracts');
    if (cameraSafety) {
      const trace = await client.evaluate('window.__hudMotion.running=false;window.__hudMotion');
      const info = await client.evaluate('window.islandBridge.__initialNotchInfo');
      const safeTop = info.hasNotch ? info.notchHeight : 0;
      assert.ok(trace.frames.length > 20, 'capture real entry and exit frames');
      assert.ok(trace.frames.every(frame => frame.top >= safeTop + 6 && frame.iconTop >= safeTop + 6), 'all animated frames clear physical camera');
      assert.ok(trace.frames.every(frame => Math.abs(frame.scaleX-1)<.001 && Math.abs(frame.scaleY-1)<.001), 'camera-anchored HUD never scales the whole island');
      assert.equal(trace.flashes, 0, 'exit never flashes the Agent workspace');
      const heights=[...new Set(trace.frames.map(frame=>frame.height))];
      assert.deepEqual(heights, [safeTop+68], 'no measurement-driven shell height jump');
      await writeFile(resolve(evidence, 'hud-motion-trace.json'), JSON.stringify(trace, null, 2));
      console.log(JSON.stringify({cameraSafeFrames:trace.frames.length,exitFrames:trace.frames.filter(frame=>frame.exiting).length,heights,workspaceFlashes:trace.flashes}));
      await client.evaluate('delete window.__hudMotion');
    }
  }
  console.log(JSON.stringify({ ok: true, evidence, battery: status.battery, networkAvailable: status.network.available, audioAvailable: status.audio.available }, null, 2));
} finally { client.close(); }
