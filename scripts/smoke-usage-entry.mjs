import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import WebSocket from 'ws';
await mkdir('.local-data/unified-usage',{recursive:true});
const port=Number(process.env.FLUX_DEBUG_PORT || 9347);
const list=()=>fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
const tab=(await list()).find(t=>t.url.endsWith('/island.html'));assert.ok(tab);assert.ok(tab.url.includes('/src/'),'fixture smoke requires a source preview');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.once('open',r));let id=0;const pending=new Map();
ws.on('message',raw=>{const m=JSON.parse(raw);if(!pending.has(m.id))return;const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(m.error):p.resolve(m.result);});
const call=(method,params={})=>new Promise((resolve,reject)=>{const request=++id;const timer=setTimeout(()=>reject(new Error(method+' timeout')),10000);pending.set(request,{resolve,reject,timer});ws.send(JSON.stringify({id:request,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));const rect=selector=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
const move=async selector=>{const r=await rect(selector);assert.ok(r,selector);await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x+r.width/2,y:r.y+r.height/2});};
const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'nearest'});true`);await move(selector);const r=await rect(selector);for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,x:r.x+r.width/2,y:r.y+r.height/2});};
const exists=selector=>evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);const popup='.usage-entry-popover';const report={};
try{
 await evaluate("document.querySelector('.pill')?.click();true");await wait(500);
 // Actual app integration, no injected quota.
 if(!await exists('[data-tool-id="usage"] .usage-entry-button')){await click('.toolbar-more');await wait(150);}
 assert.ok(await exists('[data-tool-id="usage"] .usage-entry-button'),'usage module retains its entry without a quota');
 assert.equal(await evaluate("[...document.querySelectorAll('.toolbar-leading .agent-monogram-image')].length"),0,'no duplicate fixed Codex entry');
 await move('[data-tool-id="usage"] .usage-entry-button');await wait(350);assert.ok(await exists(popup),'hover opens details');
 report.actualNoQuota=await evaluate("document.querySelector('.usage-entry-popover').textContent");
 await move(popup);await wait(300);assert.ok(await exists(popup),'crossing into detail keeps it open');
 await click('[data-tool-id="usage"] .usage-entry-button');await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:650,y:150});await wait(300);assert.ok(await exists(popup),'click pins detail');
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await wait(100);assert.equal(await exists(popup),false);

 // Preserve the user's toolbar preferences while exercising real hide/pin/drag.
 const saved = await evaluate(`window.islandBridge.getSettings().then(s=>({toolboxModuleOrder:s.toolboxModuleOrder,toolbarHiddenModules:s.toolbarHiddenModules,toolbarModuleSides:s.toolbarModuleSides,toolbarModuleSlots:s.toolbarModuleSlots}))`);
 try {
  await click('.toolbar-more'); await wait(100);
  await click('[data-menu-tool="usage"] [data-toolbar-command]'); await wait(100);
  assert.equal(await exists('.toolbar-slot[data-tool-id="usage"]'),false,'module can be stored in More');
  await click('.toolbar-more'); await wait(100);
  await click('[data-menu-tool="usage"] [data-toolbar-command]'); await wait(100);
  assert.ok(await exists('.toolbar-slot[data-tool-id="usage"]'),'module can be pinned again');
  const before=await evaluate(`document.querySelector('.toolbar-slot[data-tool-id="usage"]').dataset.slot`);
  const source=await rect('.toolbar-slot[data-tool-id="usage"]');const target=await rect('.toolbar-slot[data-tool-id="shelf"]');
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:source.x+16,y:source.y+15});
  await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:source.x+16,y:source.y+15});
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:target.x+16,y:target.y+15});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:target.x+16,y:target.y+15});await wait(200);
  assert.notEqual(await evaluate(`document.querySelector('.toolbar-slot[data-tool-id="usage"]').dataset.slot`),before,'drag changes the slot');
  report.toolbar=['hide','pin','drag swap'];
 } finally { await evaluate(`window.islandBridge.setSettings(${JSON.stringify(saved)})`);await wait(150); }
 // Fixture verifies nonempty quota/usage layout separately from real account data.
 await evaluate(`(async()=>{const {R:React,a:ReactDOM}=await import(${JSON.stringify(new URL('../src/renderer/vendor/react-runtime.js', import.meta.url).href)});const {UsageEntry}=await import(${JSON.stringify(new URL('../src/renderer/island/components/UsageEntry.js', import.meta.url).href)});window.__usageFixture=document.createElement('div');window.__usageFixture.style='position:fixed;left:48px;top:0;z-index:1000';document.body.append(window.__usageFixture);window.__usageFixtureRoot=ReactDOM.createRoot(window.__usageFixture);window.__usageFixtureRoot.render(React.createElement(UsageEntry,{quota:{daily:{total:'5h',usedPct:21.4,remaining:'2h'},weekly:{total:'7d',usedPct:49,remaining:'3d'}},notchHeight:32,onOpenDashboard:()=>window.__usageFullOpened=true}));})()`);
 await wait(100);assert.equal(await evaluate("window.__usageFixture.querySelector('.usage-entry-glyph span').textContent"),'79%');
 await click('body > div:last-child .usage-entry-button');await wait(250);
 const r=await rect(popup);assert.ok(r.y>=40,'detail clears camera');assert.ok(r.x>=0 && r.x+r.width<=740,'detail stays horizontally visible');assert.ok(r.y+r.height<=await evaluate('innerHeight'),'detail stays vertically visible');report.fixtureRect=r;
 const capture=await call('Page.captureScreenshot',{format:'png'});await writeFile('.local-data/unified-usage/usage-details.png',Buffer.from(capture.data,'base64'));
 await click('.usage-entry-details');await wait(100);assert.equal(await evaluate('window.__usageFullOpened'),true);
 report.passed=['entry without quota','single movable module','hover','pointer transfer','click pin','Escape','remaining percentage fixture','camera-safe popup','open dashboard'];
 console.log(JSON.stringify(report));
}finally{await evaluate('window.__usageFixtureRoot?.unmount();window.__usageFixture?.remove();true');await writeFile('.local-data/unified-usage/smoke.json',JSON.stringify(report,null,2));ws.close();}
