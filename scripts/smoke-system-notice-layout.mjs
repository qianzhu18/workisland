// Layout fixtures exercise the shipped components, not simulated hardware.
// Run against the isolated source app on FLUX_DEBUG_PORT (default 9347).
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import WebSocket from 'ws';
const port = Number(process.env.FLUX_DEBUG_PORT || 9347);
const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.url.endsWith('/island.html'));
assert.ok(target?.url.includes('/workisland/src/'), 'use the isolated source app');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((done, fail) => { socket.once('open', done); socket.once('error', fail); });
let sequence = 0;
const pending = new Map();
socket.on('message', raw => {
  const message = JSON.parse(raw);
  if (!pending.has(message.id)) return;
  const { done, fail, timer } = pending.get(message.id); pending.delete(message.id); clearTimeout(timer);
  if (message.error) fail(new Error(message.error.message)); else done(message.result);
});
const call = (method, params = {}) => new Promise((done, fail) => {
  const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); fail(new Error(`Timeout: ${method}`)); }, 8000);
  pending.set(id, { done, fail, timer }); socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result?.value;
};
const evidence = resolve('.local-data/native-status-evidence/camera-layout');
await mkdir(evidence, { recursive: true });
const cases = [
  ['power-connected', 'battery', ''], ['audio-connected', 'audio', 'AirPods Pro · long connected-device name'],
  ['capture-started', 'capture', ''], ['capture-stopped', 'capture', ''],
  ['download-started', 'downloads', 'archive-with-a-long-descriptive-file-name.zip'],
  ['network-connected', 'network', 'Wi-Fi · long wireless network name']
];
const results = [];
try {
  await evaluate(`(async () => {
    const { R: React, a: ReactDOM } = await import('../../vendor/react-runtime.js');
    const { SystemNoticeCard } = await import('../components/SystemNoticeCard.js');
    const { I: IslandPill } = await import('../components/IslandPill.js');
    const { systemNoticeLayout } = await import('../components/system-notice-layout.mjs');
    const element = document.createElement('div'); element.className = 'island-panel-layer is-system-notice';
    element.style.cssText = 'z-index:99999;background:#000;color:#fff;pointer-events:none;';
    document.body.append(element);
    window.__noticeFixture = { React, root: ReactDOM.createRoot(element), element, SystemNoticeCard, IslandPill, systemNoticeLayout };
  })()`);
  for (const hasNotch of [true, false]) for (const tall of hasNotch ? [32, 38] : [0]) for (const [kind, icon, name] of cases) {
    const data = { hasNotch, notchHeight: tall, notchWidth: hasNotch ? 179 : 0, kind, icon, name };
    await evaluate(`(() => {
      const f = window.__noticeFixture, data = ${JSON.stringify(data)};
      const layout = f.systemNoticeLayout({ ...data, maxWidth: innerWidth - 40 });
      f.element.style.width = layout.width + 'px';
      f.root.render(f.React.createElement(f.SystemNoticeCard, { notice: { kind: data.kind, icon: data.icon, key: 'system.notice.' + data.kind, name: data.name }, layout }));
    })()`);
    await new Promise(done => setTimeout(done, 280));
    const geometry = await evaluate(`(() => {
      const f=window.__noticeFixture, panel=f.element.querySelector('.system-notice-panel'), title=panel.querySelector('strong'), icon=panel.querySelector('.system-icon');
      const rect = element => { const r=element.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}; };
      return { panel:rect(panel), title:rect(title), icon:rect(icon), paddingTop:getComputedStyle(panel).paddingTop };
    })()`);
    assert.ok(geometry.title.y >= tall + 6, `${kind}: title overlaps camera`);
    assert.ok(geometry.icon.y >= tall + 6, `${kind}: icon overlaps camera`);
    assert.equal(geometry.panel.height, tall + 68, `${kind}: HUD height must be stable`);
    results.push({ fixture: true, ...data, geometry });
    if (hasNotch && tall === 32) {
      const shot = await call('Page.captureScreenshot', { format: 'png', clip: { ...geometry.panel, bottom: undefined, scale: 1 } });
      await writeFile(resolve(evidence, `${kind}.png`), Buffer.from(shot.data, 'base64'));
    }
  }
  for (const activity of ['capture', 'downloads', 'power-connected']) {
    await evaluate(`(() => {
      const f=window.__noticeFixture, kind=${JSON.stringify(activity)};
      f.element.className='island-pill-layer'; f.element.style.width='255px'; f.element.style.height='32px';
      const state = kind === 'capture' ? {capture:{available:true,active:true}} : kind === 'downloads' ? {downloads:{available:true,active:true,items:[{name:'a.zip'}]}} : {notice:{kind,at:Date.now()}};
      f.root.render(f.React.createElement(f.IslandPill,{sessions:[],visibleCount:0,hasNotch:true,notchWidth:179,systemStatus:state}));
    })()`);
    await new Promise(done => setTimeout(done, 80));
    const pill = await evaluate(`(() => {
      const f=window.__noticeFixture, left=f.element.querySelector('.pill-left .system-icon').getBoundingClientRect(), right=f.element.querySelector('.system-pill-indicator').getBoundingClientRect();
      return {leftRight:left.right,rightLeft:right.left,cameraLeft:(innerWidth-179)/2,cameraRight:(innerWidth+179)/2,labels:f.element.querySelectorAll('.pill-label').length};
    })()`);
    assert.ok(pill.leftRight <= pill.cameraLeft - 6, `${activity}: icon under camera`);
    assert.ok(pill.rightLeft >= pill.cameraRight + 6, `${activity}: indicator under camera`);
    assert.equal(pill.labels, 0, `${activity}: no centered text behind camera`);
    results.push({ fixture: true, activity, pill });
  }
  await writeFile(resolve(evidence, 'report.json'), JSON.stringify({ fixturesOnly: true, results }, null, 2));
  console.log(`Camera layout passed: ${results.length} cases (notched, tall-notch, external, and collapsed wings).`);
} finally {
  await evaluate('window.__noticeFixture?.root.unmount(); window.__noticeFixture?.element.remove(); delete window.__noticeFixture').catch(() => {});
  socket.close();
}
