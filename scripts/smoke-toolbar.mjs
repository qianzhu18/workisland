import WebSocket from 'ws';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const target = targets.find(t => t.url.endsWith('/island.html'));
assert.ok(target, 'development Island renderer must be running');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
let sequence = 0;
const pending = new Map();
ws.on('message', raw => {
  const reply = JSON.parse(raw);
  if (pending.has(reply.id)) {
    const { resolve, reject, timer } = pending.get(reply.id);
    clearTimeout(timer); pending.delete(reply.id);
    if (reply.error) reject(new Error(reply.error.message)); else resolve(reply.result);
  }
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 5000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const pause = () => new Promise(resolve => setTimeout(resolve, 250));
const readOrder = () => evaluate(`window.islandBridge.getSettings().then(s => s.toolboxModuleOrder)`);
async function point(label) {
  return evaluate(`(() => { const e = [...document.querySelectorAll('.toolbar-tools > .toolbar-slot button, .toolbar-tools > button')].find(e => e.getAttribute('aria-label') === ${JSON.stringify(label)}); const r = e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
}
async function mouse(type, p, extra = {}) { await send('Input.dispatchMouseEvent', { type, ...p, ...extra }); }
async function drag(source, destination, cancel = false) {
  await evaluate(`window.islandBridge.enterIsland(); document.querySelector('.pill').click()`);
  await pause();
  await evaluate(`window.__toolbarEvents=[]; if(!window.__toolbarTrace){ window.__toolbarTrace=true; ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'].forEach(name=>document.addEventListener(name,e=>window.__toolbarEvents.push([name,e.target.className,e.clientX,e.clientY,document.documentElement.hasAttribute('data-toolbar-dragging')]),true)); }`);
  const from = await point(source), to = await point(destination);
  await mouse('mouseMoved', from);
  await evaluate(`document.querySelector('.pill').click()`);
  await mouse('mousePressed', from, { button: 'left', clickCount: 1 });
  for (let i = 1; i <= 8; i++) await mouse('mouseMoved', { x: from.x+(to.x-from.x)*i/8, y: from.y }, { button: 'left', buttons: 1 });
  await pause();
  if (!await evaluate(`!!document.querySelector('.toolbar-drag-ghost')`)) console.log(await evaluate(`window.__toolbarEvents`));
  assert.equal(await evaluate(`!!document.querySelector('.toolbar-drag-ghost')`), true, 'drag must show a live preview');
  if (cancel === true) await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await mouse('mouseReleased', cancel === 'outside' ? {x:to.x,y:to.y+80} : to, { button: 'left', clickCount: 1 });
  await pause();
}
let saved;
try {
  saved = await evaluate('window.islandBridge.getSettings()');
  await evaluate(`window.islandBridge.setSettings({fileShelfEnabled:true, clipboardHistoryEnabled:true, terminalEnabled:true, usageDashboardEnabled:true, toolboxModuleOrder:[]})`);
  await evaluate(`document.querySelector('.pill').click()`);
  await pause();
  const geometry = await evaluate(`(() => { const a = document.querySelector('.toolbar-camera-space').getBoundingClientRect(); const b = document.querySelector('.toolbar-tools').getBoundingClientRect(); return {cameraRight:a.right, toolsLeft:b.left, width:b.width, buttons:[...document.querySelectorAll('.toolbar-tools > button')].map(b=>b.getAttribute('aria-label'))}; })()`);
  assert.ok(geometry.toolsLeft >= geometry.cameraRight, 'toolbar must stay outside camera');
  assert.ok(geometry.buttons.includes('智能体主页') && geometry.buttons.includes('设置'));
  console.log('Toolbar geometry', geometry, await point('终端'), await point('文件架'));
  const shelf = await point('文件架');
  await mouse('mouseMoved', shelf);
  await mouse('mousePressed', shelf, {button:'left',clickCount:1});
  await mouse('mouseReleased', shelf, {button:'left',clickCount:1});
  await pause();
  assert.equal(await evaluate(`document.querySelector('[aria-label="文件架"]').getAttribute('aria-pressed')`), 'true', 'a light click must open its module');
  await drag('终端', '文件架');
  assert.deepEqual((await readOrder()).slice(0, 3), ['terminal','shelf','clipboard']);
  await drag('文件架', '终端', true);
  assert.deepEqual((await readOrder()).slice(0, 3), ['terminal','shelf','clipboard']);
  await drag('文件架', '终端');
  assert.deepEqual((await readOrder()).slice(0, 3), ['shelf','terminal','clipboard']);
  await drag('文件架', '终端', 'outside');
  assert.deepEqual((await readOrder()).slice(0, 3), ['shelf','terminal','clipboard']);
  await evaluate(`document.querySelector('.toolbar-tools').style.width='128px'`);
  await pause();
  await evaluate(`document.querySelector('[aria-label="更多功能"]').click()`);
  await pause();
  assert.ok(await evaluate(`document.querySelector('.toolbar-overflow').innerText.includes('用量')`));
  await evaluate(`document.querySelector('[aria-label="将用量移到快捷栏首位"]').click()`);
  await pause();
  assert.equal((await readOrder())[0], 'usage');
  await evaluate(`document.querySelector('.toolbar-tools').style.removeProperty('width'); document.querySelector('.pill').click()`);
  await pause();
  await evaluate(`document.querySelector('[aria-label="更多功能"]')?.click()`);
  await pause();
  const shot = await send('Page.captureScreenshot');
  writeFileSync('/tmp/workisland-toolbar-preview.png', Buffer.from(shot.data, 'base64'));
  console.log('Toolbar smoke passed: camera exclusion, fixed entries, real pointer reorder, Escape cancellation, repeated sorting, overflow and promotion.', geometry);
} finally {
  if (saved) await evaluate(`window.islandBridge.setSettings(${JSON.stringify({fileShelfEnabled:saved.fileShelfEnabled,clipboardHistoryEnabled:saved.clipboardHistoryEnabled,terminalEnabled:saved.terminalEnabled,usageDashboardEnabled:saved.usageDashboardEnabled,toolboxModuleOrder:saved.toolboxModuleOrder})})`);
  await evaluate(`document.querySelector('.toolbar-tools').style.removeProperty('width')`);
  ws.close();
}
