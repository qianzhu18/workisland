#!/usr/bin/env node
// Uses real main -> renderer IPC and an isolated PTY; never target the installed app.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import WebSocket from 'ws';
import { terminalFrames } from './lib/electron-smoke-cdp.mjs';
const rendererPort = Number(process.env.FLUX_DEBUG_PORT || 9354), mainPort = Number(process.env.FLUX_INSPECT_PORT || 9364);
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label) { for (let n = 0; n < 100; n++) { const value = await fn(); if (value) return value; await wait(100); } throw new Error(`Timed out: ${label}`); }
async function connect(port, select) {
  const target = await until(async () => { try { return (await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())).find(select); } catch { return null; } }, 'debug target');
  const socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => socket.once('open', r));
  let id = 0; const pending = new Map();
  socket.on('message', raw => { const message = JSON.parse(raw), item = pending.get(message.id); if (!item) return; pending.delete(message.id); clearTimeout(item.timer); message.error ? item.reject(new Error(JSON.stringify(message.error)+'; request='+item.label)) : item.resolve(message.result); });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject, label: method+' '+String(params.expression||'').slice(0,100), timer: setTimeout(() => reject(new Error(method)), 10000) }); socket.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  return { target, call, evaluate, close: () => socket.close() };
}
const frames = terminalFrames(rendererPort);
const renderer = await connect(rendererPort, t => t.url.endsWith('/island.html'));
assert.ok(!renderer.target.url.includes('/Applications/'), 'Use an isolated preview');
const main = await connect(mainPort, () => true);
const api = (method, ...args) => renderer.evaluate(`window.islandBridge.${method}(${args.map(a => JSON.stringify(a)).join(',')})`);
const click = async selector => { await until(() => renderer.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), selector); return renderer.evaluate(`document.querySelector(${JSON.stringify(selector)}).click();true`); };
const isOpen = () => renderer.evaluate("!document.querySelector('.island-panel-layer').classList.contains('is-hidden')");
const send = (channel, value) => main.evaluate(`(()=>{const w=process.mainModule.require('electron').webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(renderer.target.url)});if(!w)throw new Error('Preview not found');w.send(${JSON.stringify(channel)},${JSON.stringify(value)});return true})()`);
const session = (id, phase, more = {}) => ({ id, tool: 'claude', title: `Notification QA ${id}`, phase, isProcessAlive: true, createdAt: Date.now(), updatedAt: Date.now(), latestUserPrompt: 'QA task', ...more });
const notify = (id, autoDismiss = true) => send('island:present-surface', { surface: { type: 'sessionList', actionableSessionId: id, visibleSessionIds: [id] }, reason: 'notification', autoDismiss });
const output = resolve('.local-data/terminal-notifications'); await mkdir(output, { recursive: true });
const report = {}, owned = [], settings = await api('getSettings');
assert.equal((await api('getTerminalState')).sessions.length, 0, 'No unrelated PTYs allowed');
await renderer.evaluate(`(()=>{window.__qaEvents=[];window.__qaAbort?.abort();window.__qaAbort=new AbortController();for(const type of ['blur','focus','workisland-window-blur'])window.addEventListener(type,e=>window.__qaEvents.push({type,target:e.target?.tagName||'window',time:performance.now(),viewing:document.querySelector('.terminal-panel')?.dataset.terminalViewing}),{signal:window.__qaAbort.signal});window.__qaObserver?.disconnect();window.__qaObserver=new MutationObserver(()=>window.__qaEvents.push({type:'page',time:performance.now(),layer:document.querySelector('.island-panel-layer')?.className,viewing:document.querySelector('.terminal-panel')?.dataset.terminalViewing}));window.__qaObserver.observe(document.querySelector('.island-panel-layer'),{attributes:true,attributeFilter:['class']});return true})()`);
async function terminalPage() {
  await renderer.call('Page.bringToFront'); if (!(await isOpen())) await click('.pill'); await wait(200);
  if (await renderer.evaluate("document.querySelector('.terminal-panel').classList.contains('is-hidden')")) await click('[data-tool-id=terminal] button');
  await until(() => renderer.evaluate("document.querySelector('.terminal-panel').getBoundingClientRect().width>0"), 'visible terminal');
}
try {
  await api('setSettings', { terminalEnabled: true, autoCollapseOnMouseLeave: false, completionPopupDurationSec: 5 });
  await send('island:session-update', [session('timer', 'running')]);
  await notify('timer'); await until(isOpen, 'notification opened');
  await terminalPage();
  await renderer.evaluate('document.activeElement?.blur();true');
  await wait(5500);
  assert.equal(await isOpen(), true, 'notification scheduled before entering the manager must not collapse it');
  report.previousTimerCannotCloseManager = true;
  await send('island:session-update', []); await wait(200);
  assert.equal(await isOpen(), true, 'expired Agent surface cannot close the terminal page');
  report.expiredAgentCannotCloseManager = true;
  await click('.terminal-new');
  const terminal = await until(async () => { const s = await api('getTerminalState'); return s.id && s.running && s; }, 'real PTY'); owned.push(terminal.id);
  const frame = await until(() => frames.get(terminal.id), 'native frame');
  const textarea = '.xterm-helper-textarea';
  await until(() => frame.evaluate(`!!document.querySelector(${JSON.stringify(textarea)})`), 'real xterm');
  await frame.evaluate(`document.querySelector(${JSON.stringify(textarea)}).focus();document.querySelector('.xterm').dataset.qaInstance='kept';true`);
  const marker = Date.now().toString(36), command = `printf '%s%s\\n' 'GUARD_' '${marker}'`;
  await frame.call('Input.insertText', { text: command });
  const snapshots = [
    [session('submission', 'running')],
    [session('complete', 'completed')],
    [session('approval', 'waitingForApproval')],
    [session('question', 'waitingForAnswer')],
    [session('error', 'completed', { error: 'QA failure' })]
  ];
  for (const rows of snapshots) {
    await send('island:session-update', rows); await notify(rows[0].id, !['approval', 'question', 'error'].includes(rows[0].id)); await wait(100);
    assert.equal(await isOpen(), true);
    assert.equal(await frame.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(textarea)})`), true, rows[0].id + ' must not steal input');
    assert.equal((await api('getTerminalState')).activeId, terminal.id);
    assert.equal(await frame.evaluate(`document.querySelector('.xterm').dataset.qaInstance`), 'kept');
  }
  report.allAutomaticAgentTypesKeepFocus = true;
  const rows = [session('approval', 'waitingForApproval'), session('question', 'waitingForAnswer'), session('error', 'completed', { error: 'QA failure' })];
  await send('island:session-update', rows); await wait(100);
  await click('.terminal-agent-notices summary');
  await until(() => renderer.evaluate("document.querySelectorAll('.terminal-agent-notice').length===3"), 'three pending actions');
  const clip = await renderer.evaluate("(()=>{const r=document.querySelector('.terminal-panel').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:Math.min(r.height,innerHeight-r.y),scale:1}})()");
  const screenshot = await renderer.call('Page.captureScreenshot', { format: 'png', clip }); await writeFile(resolve(output, 'pending-actions.png'), Buffer.from(screenshot.data, 'base64'));
  await click('[data-agent-session-id="approval"]');
  await until(() => renderer.evaluate("document.querySelector('.terminal-panel').classList.contains('is-hidden')"), 'explicit Agent navigation');
  assert.deepEqual(await renderer.evaluate("[...document.querySelectorAll('.session-row .session-title')].map(e=>e.textContent)"), ['Notification QA approval']);
  report.explicitPendingNavigation = true;
  await terminalPage();
  await until(() => frame.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(textarea)})`), 'terminal focus restored');
  await frame.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await frame.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await until(async () => (await api('getTerminalState', terminal.id)).recentOutput.includes('GUARD_' + marker), 'half-input command executed');
  report.halfInputAndPtyPreserved = true;
  await send('island:session-update', [session('approval', 'running')]);
  await until(() => renderer.evaluate("!document.querySelector('.terminal-agent-notices')"), 'resolved items removed');
  report.pendingClearsOnResolution = true;
  await click('.terminal-back'); await renderer.evaluate('document.activeElement?.blur();true');
  await notify('approval'); await wait(5500);
  assert.equal(await isOpen(), true, 'reading manager without input focus is protected');
  report.unfocusedManagerProtected = true;
  await click('[data-tool-id=shelf] button'); await renderer.evaluate('document.activeElement?.blur();true');
  await notify('approval'); await until(async () => !(await isOpen()), 'other tools retain automatic dismissal');
  report.otherToolsKeepOriginalBehavior = true;
  await notify('approval', false); await until(isOpen, 'closed Island still receives notification');
  report.closedIslandStillNotifies = true;
  report.pass = true;
} catch (error) {
  report.failure = { message: error.message, panel: await renderer.evaluate("document.querySelector('.terminal-panel')?.outerHTML.slice(0,1500)"), events: await renderer.evaluate('window.__qaEvents') };
  throw error;
} finally {
  for (const id of owned) await api('closeTerminal', id).catch(() => {});
  await send('island:session-update', []).catch(() => {});
  await api('setSettings', { terminalEnabled: settings.terminalEnabled, autoCollapseOnMouseLeave: settings.autoCollapseOnMouseLeave, completionPopupDurationSec: settings.completionPopupDurationSec }).catch(() => {});
  await writeFile(resolve(output, 'validation.json'), JSON.stringify(report, null, 2)); frames.close(); renderer.close(); main.close();
}
console.log(JSON.stringify(report));
