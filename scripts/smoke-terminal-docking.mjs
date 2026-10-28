#!/usr/bin/env node
// Real PTY / persistent native view verification. Use a disposable, isolated preview.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connect, wait, until, terminalFrames } from './lib/electron-smoke-cdp.mjs';
const port=Number(process.env.FLUX_DEBUG_PORT||9355), mainPort=Number(process.env.FLUX_INSPECT_PORT||9365);
const island=await connect(port,t=>t.url.endsWith('/island.html')), main=await connect(mainPort), frames=terminalFrames(port);
assert.equal(await island.evaluate("location.pathname.includes('/Applications/')"),false,'Use an isolated preview');
const api=(method,...args)=>island.evaluate(`islandBridge.${method}(${args.map(a=>JSON.stringify(a)).join(',')})`);
const state=id=>id?api('getTerminalState',id):api('getTerminalState');
assert.equal((await state()).sessions.length,0,'No unrelated PTYs');
const output=resolve(process.env.FLUX_DOCKING_OUTPUT||'.local-data/terminal-docking'),owned=[],report={};await mkdir(output,{recursive:true});
const original=await api('getSettings');
const click=async selector=>{await until(()=>island.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`),selector);return island.evaluate(`document.querySelector(${JSON.stringify(selector)}).click();true`);};
async function expand(){await island.call('Page.bringToFront');if(await island.evaluate("document.querySelector('.island-panel-layer').classList.contains('is-hidden')"))await click('.pill');await wait(120);}
async function open(id){await expand();if(await island.evaluate("document.querySelector('.terminal-panel').classList.contains('is-hidden')"))await click('[data-tool-id=terminal] button');if(await island.evaluate("!!document.querySelector('.terminal-back')"))await click('.terminal-back');await click(`[data-session-id="${id}"] .terminal-session-open`);await until(()=>island.evaluate(`(()=>{const h=document.querySelector('.terminal-native-host[data-native-visible="true"]');return h?.dataset.terminalId===${JSON.stringify(id)}&&h.getBoundingClientRect().height>0})()`),'selected terminal visible');return until(()=>frames.get(id),'native frame');}
const press=async(f,key,text)=>{await f.call('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:key==='Enter'?13:0,...(text?{text}:{})});await f.call('Input.dispatchKeyEvent',{type:'keyUp',key,code:key});};
async function type(id,text,submit=true){const f=await until(async()=>{const frame=await frames.get(id);return frame&&await frame.evaluate("!!document.querySelector('.xterm-helper-textarea')")&&frame;},'ready xterm');await f.evaluate("document.querySelector('.xterm-helper-textarea').focus();true");await f.call('Input.insertText',{text});if(submit)await press(f,'Enter','\r');}
const hasOutput=(id,marker)=>until(async()=> (await state(id)).recentOutput.includes(marker),marker);
const terminalExpr=expression=>`import('./terminal.js').then(({terminal:t})=>(${expression}))`;
const wcInfo=id=>main.evaluate(`(async()=>{const e=process.mainModule.require('electron');for(const w of e.webContents.getAllWebContents().filter(w=>w.getURL().endsWith('/terminal.html'))){if((await w.executeJavaScript('window.terminalBridge?.identity'))?.id===${JSON.stringify(id)})return {id:w.id,pid:w.getOSProcessId(),focused:w.isFocused()};}return null;})()`);
async function dock(id) {
  await api('dockTerminal',id);
  await until(()=>island.evaluate(`(()=>{const h=document.querySelector('.terminal-native-host[data-native-visible="true"]');return h?.dataset.terminalId===${JSON.stringify(id)}&&h.getBoundingClientRect().height>0&&!document.querySelector('.island-panel-layer').classList.contains('is-hidden')})()`),'docked terminal is actually visible');
  await wait(100);
}
const desktopOrigin=id=>main.evaluate(`(async()=>{const e=process.mainModule.require('electron');for(const w of e.BaseWindow.getAllWindows()){for(const v of w.contentView.children){if(v.webContents?.getURL().endsWith('/terminal.html')&&(await v.webContents.executeJavaScript('terminalBridge.identity.id'))===${JSON.stringify(id)})return w.getContentBounds();}}})()`);
async function pointer(client,type,x,y,buttons) { await client.call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons,clickCount:1}); }
async function dragOut(id) {
  await open(id); await wait(250);
  const start=await island.evaluate("(()=>{const r=document.querySelector('.terminal-drag-handle').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
  await pointer(island,'mousePressed',start.x,start.y,1);
  await pointer(island,'mouseMoved',785,400,1); await pointer(island,'mouseReleased',785,400,0);
  await until(async()=> (await state(id)).location==='desktop','pointer drag out');
}
async function dragBack(id) {
  const f=await frames.get(id); await api('focusTerminalWindow',id); await until(()=>f.evaluate("document.documentElement.dataset.location==='desktop'&&document.querySelector('#drag').getBoundingClientRect().height>0"),'desktop grab handle visible'); await wait(250); const origin=await desktopOrigin(id);
  const start=await f.evaluate("(()=>{const r=document.querySelector('#drag').getBoundingClientRect();return {x:r.x+50,y:r.y+r.height/2}})()");
  const target=await island.evaluate("(()=>{const r=document.querySelector(document.querySelector('.island-panel-layer').classList.contains('is-hidden')?'.pill':'.island-panel-layer').getBoundingClientRect();return {x:r.x+25,y:r.y+Math.min(20,r.height/2)}})()");
  const islandOrigin=await main.evaluate("process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/island.html')).getContentBounds()");
  const drop={x:islandOrigin.x+target.x,y:islandOrigin.y+target.y};
  await pointer(f,'mousePressed',start.x,start.y,1); await pointer(f,'mouseMoved',drop.x-origin.x,drop.y-origin.y,1); await wait(80);
  const moved=await desktopOrigin(id); await pointer(f,'mouseReleased',drop.x-moved.x,drop.y-moved.y,0);
  await until(async()=> (await state(id)).location==='island','pointer drag back');
  await until(()=>island.evaluate("!!document.querySelector('.terminal-native-host[data-native-visible=\"true\"]')"),'visible after pointer dock');
}
const metrics=()=>main.evaluate("process.mainModule.require('electron').app.getAppMetrics().map(p=>({pid:p.pid,type:p.type,workingSetSize:p.memory.workingSetSize}))");
try{
  await api('setSettings',{terminalEnabled:true,autoCollapseOnMouseLeave:false});await expand();await click('[data-tool-id=terminal] button');
  const baselineMetrics=await metrics();
  for(let n=0;n<3;n++){const s=await api('createTerminal');owned.push(s.id);await api('renameTerminal',s.id,`Dock QA ${n+1}`);await open(s.id);}
  const [a,b,c]=owned, f=await frames.get(a), nonce=Date.now().toString(36);await open(a);
  const pid=(await state(a)).pid,wc=await wcInfo(a);
  await f.evaluate("document.querySelector('.xterm').dataset.qaIdentity='persistent';true");
  await type(a,`export DOCK_QA=kept; printf '%s%s\\n' 'DOCK_HALF_' '${nonce}'`,false);
  await dragOut(a);await dragBack(a);await wait(250);report.bidirectionalPointerDrag=true;
  assert.equal((await state(a)).pid,pid);assert.equal((await wcInfo(a)).id,wc.id);
  await type(a,'');await hasOutput(a,'DOCK_HALF_'+nonce);
  report.halfInputPreserved=true;
  await type(a,"for i in {1..160}; do printf 'SCROLL_%s\\n' \"$i\"; done");await hasOutput(a,'SCROLL_160');await wait(200);
  await f.evaluate(terminalExpr('(t.scrollLines(-40),t.select(0,t.buffer.active.baseY-30,8),true)'));
  const before=await f.evaluate(terminalExpr('({selection:t.getSelection(),viewport:t.buffer.active.viewportY})'));
  for(let n=0;n<20;n++){await api('detachTerminal',a);await wait(25);await dock(a);}
  await wait(300);
  const after=await f.evaluate(terminalExpr('({selection:t.getSelection(),viewport:t.buffer.active.viewportY})'));
  assert.deepEqual(after,before);assert.equal((await state(a)).pid,pid);assert.equal((await wcInfo(a)).id,wc.id);
  assert.equal(await f.evaluate("document.querySelector('.xterm').dataset.qaIdentity"),'persistent');
  report.twentyHandoffsSamePtyViewDomScrollSelection=true;
  await f.evaluate(terminalExpr('(t.clearSelection(),t.scrollToBottom(),true)'));
  await type(a,`printf '\\033[?1049h\\033[2J\\033[H%s%s\\n' 'DOCK_ALT_' '${nonce}'`);await wait(100);
  await api('detachTerminal',a);await dock(a);await wait(200);
  assert.equal(await f.evaluate(terminalExpr(`t.buffer.active.type==='alternate'&&t.buffer.active.getLine(0).translateToString().includes('DOCK_ALT_${nonce}')`)),true);
  await type(a,"printf '\\033[?1049l'");report.alternateScreenPreserved=true;
  await open(b);await type(b,`(sleep .3; printf '%s%s\\n' 'DOCK_BG_' '${nonce}') &`);await open(c);await hasOutput(b,'DOCK_BG_'+nonce);
  for(const id of owned)await api('detachTerminal',id);
  assert.equal((await state()).sessions.filter(s=>s.location==='desktop').length,3);report.metricsThree=await metrics();report.baselineMetrics=baselineMetrics;
  for(const id of owned)await type(id,`printf 'ENV_%s\\n' "${id===a?'$DOCK_QA':'other'}"`);
  await hasOutput(a,'ENV_kept');await hasOutput(b,'ENV_other');assert.equal((await state(b)).recentOutput.includes('ENV_kept'),false);
  report.independentDesktopInputAndBackgroundOutput=true;
  await api('setLanguagePreference','en');await until(()=>f.evaluate("document.querySelector('#dock').textContent==='Return to Island'"),'desktop localization');await api('setLanguagePreference','zh-CN');
  report.liveLocalization=true;
  await writeFile(resolve(output,'desktop-terminal.png'),Buffer.from((await f.call('Page.captureScreenshot')).data,'base64'));
  const aWc=await wcInfo(a);
  await main.evaluate(`(()=>{const e=process.mainModule.require('electron'),w=e.BaseWindow.getAllWindows().find(w=>w.contentView.children.some(v=>v.webContents?.id===${aWc.id}));w.close();return true})()`);
  await until(async()=> (await state(a)).location==='island','native close docks');assert.equal((await state(a)).pid,pid);
  report.nativeCloseDocksWithoutEndingTask=true;
  await api('closeTerminal',b);await until(async()=>!(await wcInfo(b)),'terminated frame disposed');
  assert.equal((await state(a)).running,true);assert.equal((await state(c)).running,true);report.closeIsolation=true;
  await dock(c);await open(c);await type(c,'exit 7');await until(async()=> (await state(c)).exitCode===7,'natural exit');
  const oldWc=await wcInfo(c);const exited=await frames.get(c);await exited.evaluate("document.querySelector('#restart').click();true");
  await until(async()=> (await state(c)).running,'restart');await until(async()=> (await wcInfo(c))?.id!==oldWc.id,'replacement frame');
  await open(c);await type(c,"printf 'RESTART_%s\\n' OK");await hasOutput(c,'RESTART_OK');report.restartUsesNewGeneration=true;
  for(let n=(await state()).sessions.length;n<8;n++){const s=await api('createTerminal');owned.push(s.id);await open(s.id);}
  report.metricsEight=await metrics();
  await api('setSettings',{terminalEnabled:false});await until(async()=> (await main.evaluate("process.mainModule.require('electron').webContents.getAllWebContents().filter(w=>w.getURL().endsWith('/terminal.html')).length"))===0,'views disposed');
  assert.ok((await state()).sessions.every(s=>!s.running));report.disableCleansAll=true;report.pass=true;
}catch(error){report.failure={message:error.message,state:await state(),ui:await island.evaluate("({text:document.querySelector('.terminal-panel')?.innerText,open:!document.querySelector('.island-panel-layer').classList.contains('is-hidden')})")};throw error;}finally{
  for(const id of owned)await api('closeTerminal',id).catch(()=>{});
  await api('setSettings',{terminalEnabled:original.terminalEnabled,autoCollapseOnMouseLeave:original.autoCollapseOnMouseLeave}).catch(()=>{});
  await writeFile(resolve(output,'validation.json'),JSON.stringify(report,null,2));frames.close();island.close();main.close();
}
console.log(JSON.stringify(report));
