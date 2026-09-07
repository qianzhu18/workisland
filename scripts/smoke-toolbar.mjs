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
const pause = (ms = 280) => new Promise(resolve => setTimeout(resolve, ms));
const settings = () => evaluate('window.islandBridge.getSettings()');
const selector = id => '.toolbar-slot[data-tool-id="' + id + '"] button';
async function point(css) {
  return evaluate('(() => { const e=document.querySelector(' + JSON.stringify(css) + '); if(!e)throw Error("missing "+' + JSON.stringify(css) + '); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()');
}
const mouse = (type, p, extra = {}) => send('Input.dispatchMouseEvent', { type, ...p, ...extra });
async function openPanel() {
  await evaluate('window.islandBridge.enterIsland(); document.querySelector(".pill").click()');
  await pause();
}
async function click(css) {
  const p = await point(css);
  await mouse('mouseMoved', p);
  await mouse('mousePressed', p, {button:'left',clickCount:1});
  await mouse('mouseReleased', p, {button:'left',clickCount:1});
  await pause();
}
async function drag(css, destination, cancel = '') {
  await evaluate(`window.__toolbarEvents=[];if(!window.__toolbarTrace){window.__toolbarTrace=true;['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'].forEach(type=>document.addEventListener(type,e=>window.__toolbarEvents.push([type,e.buttons,e.target.className,document.documentElement.hasAttribute('data-toolbar-dragging')]),true));}`);
  const from = await point(css);
  await mouse('mouseMoved', from);
  await evaluate('document.querySelector(".pill").click()');
  await mouse('mousePressed', from, {button:'left',clickCount:1});
  for(let i=1;i<=12;i++) {
    await mouse('mouseMoved', {x:from.x+(destination.x-from.x)*i/12,y:from.y+(destination.y-from.y)*i/12}, {button:'left',buttons:1});
  }
  await pause();
  if (!await evaluate('!!document.querySelector(".toolbar-drag-ghost")')) console.log(await evaluate('window.__toolbarEvents'));
  assert.equal(await evaluate('!!document.querySelector(".toolbar-drag-ghost")'), true, 'drag must visibly preview its destination');
  if(cancel==='escape') await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await mouse('mouseReleased',cancel==='outside'?{x:destination.x,y:destination.y+90}:destination,{button:'left',clickCount:1});
  await pause();
}
async function menu() {
  await openPanel();
  if(!await evaluate('!!document.querySelector(".toolbar-overflow")')) await click('.toolbar-more');
}
async function snapshot() {
  return evaluate('(() => { const root=document.querySelector(".toolbar-tools").getBoundingClientRect(); const c=document.querySelector(".toolbar-camera-space").getBoundingClientRect(); return {root:{x:root.x,y:root.y,width:root.width},camera:{left:c.left,right:c.right},slots:[...document.querySelectorAll(".toolbar-slot")].map(e=>{const r=e.getBoundingClientRect();return {id:e.dataset.toolId,bank:e.dataset.bank,x:r.x,y:r.y,width:r.width};})};})()');
}
let saved;
try {
  for (let attempt=0; attempt<25; attempt++) {
    if (await evaluate('!!document.querySelector(".pill")')) break;
    await pause(200);
  }
  saved = await settings();
  await evaluate('window.islandBridge.setSettings({fileShelfEnabled:true, clipboardHistoryEnabled:true, terminalEnabled:true, usageDashboardEnabled:true, performanceEnabled:true, toolboxModuleOrder:[], toolbarHiddenModules:[], toolbarModuleSides:{}})');
  await openPanel();
  let geometry = await snapshot();
  assert.ok(geometry.slots.some(s=>s.bank==='left'), 'left spare space must be usable');
  for(const s of geometry.slots) assert.ok(s.x+s.width<=geometry.camera.left || s.x>=geometry.camera.right, 'no camera overlap: '+s.id);
  await click(selector('shelf'));
  assert.equal(await evaluate('document.querySelector(' + JSON.stringify(selector('shelf')) + ').getAttribute("aria-pressed")'),'true','light click opens shelf');
  await openPanel();
  await drag(selector('terminal'), await point(selector('shelf')));
  assert.equal((await settings()).toolboxModuleOrder[0], 'terminal');
  await openPanel();
  const beforeCancel = (await settings()).toolboxModuleOrder;
  await drag(selector('shelf'), await point(selector('terminal')), 'escape');
  assert.deepEqual((await settings()).toolboxModuleOrder, beforeCancel);
  await openPanel();
  await drag(selector('shelf'), await point(selector('terminal')), 'outside');
  assert.deepEqual((await settings()).toolboxModuleOrder, beforeCancel);

  // Explicitly hide a formerly fixed system utility, then drag it out of the menu.
  await menu();
  await click('[aria-label="将性能监视器移入更多"]');
  assert.ok((await settings()).toolbarHiddenModules.includes('performance'));
  await menu();
  await drag('[data-menu-tool="performance"] .performance-button', await point(selector('terminal')));
  assert.equal((await settings()).toolbarHiddenModules.includes('performance'), false);
  assert.equal((await settings()).toolboxModuleOrder[0], 'performance');

  // A slot on the opposite bank remains a valid cross-camera destination.
  await openPanel();
  geometry = await snapshot();
  const right = geometry.slots.find(s=>s.bank==='right');
  const target = right ? {x:right.x+16,y:right.y+15} : {
    x:geometry.camera.right+48,y:geometry.root.y+15
  };
  await drag(selector('performance'), target);
  assert.equal(await evaluate('document.querySelector(".toolbar-slot[data-tool-id=performance]").dataset.bank'),'right');
  await openPanel();
  await drag(selector('performance'), await point('.toolbar-more'));
  assert.ok((await settings()).toolbarHiddenModules.includes('performance'));

  // Force a genuinely full toolbar; dragging the hidden item must replace the tail.
  await evaluate('document.querySelector(".toolbar-header").style.width="420px"');
  await pause();
  await menu();
  await drag('[data-menu-tool="performance"] .performance-button', await point(selector((await snapshot()).slots[0].id)));
  assert.equal((await settings()).toolboxModuleOrder[0],'performance');
  assert.ok(await evaluate('document.querySelectorAll(".toolbar-slot").length < 6'));
  await evaluate('document.querySelector(".toolbar-header").style.removeProperty("width")');
  await openPanel();
  await menu();
  const shot=await send('Page.captureScreenshot');
  writeFileSync('/tmp/workisland-toolbar-v2-preview.png',Buffer.from(shot.data,'base64'));

  // Fixture process is never terminated. Exercise the real component's click
  // selection and dismissal without depending on the machine's process list.
  await evaluate(`(async()=>{
    const base=new URL('../', location.href);
    const {R:React,a:ReactDOM}=await import(new URL('../vendor/react-runtime.js',base));
    const {PerformancePopover}=await import(new URL('components/PerformancePopover.js',base));
    const host=document.createElement('div'); host.id='toolbar-perf-test'; host.style='position:fixed;left:60px;top:100px;z-index:20000';
    document.body.appendChild(host); window.__perfTestRoot=ReactDOM.createRoot(host);
    window.__perfTestRoot.render(React.createElement(PerformancePopover,{state:{cpuPct:12,memoryPct:20,processesLoaded:true,processes:[{pid:999999,name:'Toolbar Test Process',cpuPct:1,memoryBytes:4096}]}}));
  })()`);
  await pause();
  await evaluate('document.querySelector("#toolbar-perf-test button").click()');
  await pause();
  await evaluate('document.querySelector(".performance-process").click()');
  assert.equal(await evaluate('document.querySelector(".performance-popover").innerText.includes("已固定")'),false);
  await evaluate('document.querySelector(".performance-popover").dispatchEvent(new MouseEvent("mouseout",{bubbles:true,relatedTarget:document.body}))');
  await pause(500);
  assert.equal(await evaluate('!!document.querySelector(".performance-popover")'),false,'selecting a process must not pin the panel');
  await evaluate('document.querySelector("#toolbar-perf-test button").click()');
  await pause();
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await pause();
  assert.equal(await evaluate('!!document.querySelector(".performance-popover")'),false);
  console.log('PASS: both banks, camera exclusion, click, repeated sort, cancellation, menu drag-out, cross-camera move, drag into More, full capacity, performance auto-close and Escape.');
} finally {
  await mouse('mouseReleased',{x:700,y:400},{button:'left',clickCount:1}).catch(()=>{});
  if(saved) await evaluate('window.islandBridge.setSettings('+JSON.stringify({fileShelfEnabled:saved.fileShelfEnabled,clipboardHistoryEnabled:saved.clipboardHistoryEnabled,terminalEnabled:saved.terminalEnabled,usageDashboardEnabled:saved.usageDashboardEnabled,performanceEnabled:saved.performanceEnabled,toolboxModuleOrder:saved.toolboxModuleOrder,toolbarHiddenModules:saved.toolbarHiddenModules||[],toolbarModuleSides:saved.toolbarModuleSides||{}})+')');
  await evaluate('window.__perfTestRoot?.unmount();document.querySelector("#toolbar-perf-test")?.remove(); document.querySelector(".toolbar-header").style.removeProperty("width");document.querySelector(".toolbar-more[aria-expanded=true]")?.click()');
  ws.close();
}
