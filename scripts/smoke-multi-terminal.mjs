#!/usr/bin/env node
// Run against an isolated Electron preview, never the installed application.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import WebSocket from 'ws';

const port = Number(process.env.FLUX_DEBUG_PORT || 9351);
const base = `http://127.0.0.1:${port}`;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label) { for (let n = 0; n < 100; n++) { const v = await fn(); if (v) return v; await wait(100); } throw new Error(`Timed out: ${label}`); }
const target = (await fetch(`${base}/json/list`).then(r => r.json())).find(t => t.url.endsWith('/island.html'));
assert.ok(target && !target.url.includes('/Applications/'), 'Use an isolated source preview, not the installed app');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => socket.once('open', r));
let id = 0;
const pending = new Map(), errors = [];
socket.on('message', raw => {
  const m = JSON.parse(raw), p = pending.get(m.id);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
  if (!p) return;
  pending.delete(m.id); clearTimeout(p.timer);
  m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id; pending.set(n, { resolve, reject, timer: setTimeout(() => reject(new Error(`${method} timed out`)), 10000) });
  socket.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async expression => {
  const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const api = (method, ...args) => evaluate(`window.islandBridge.${method}(${args.map(a => JSON.stringify(a)).join(',')})`);
const state = () => api('getTerminalState');
const click = async selector => {
  await until(() => evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});return Boolean(b && !b.disabled)})()`), `enabled control: ${selector}`);
  return evaluate(`document.querySelector(${JSON.stringify(selector)}).click();true`);
};
const press = async key => {
  const code = key === 'Enter' ? 13 : key === 'Escape' ? 27 : 0;
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, ...(key === 'Enter' ? { text: '\r' } : {}) });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
};
const created = [], childPids = [];
const output = resolve('.local-data/multi-terminal');
await mkdir(output, { recursive: true });
const report = {}, originalSettings = await api('getSettings');
assert.equal((await state()).sessions.length, 0, 'Preview must start without unrelated terminal sessions');
await call('Runtime.enable');
async function home() { if (await evaluate("!!document.querySelector('.terminal-back')")) await click('.terminal-back'); await wait(100); }
async function expand() {
  await call('Page.bringToFront');
  if (await evaluate("document.querySelector('.island-panel-layer').classList.contains('is-hidden')")) await click('.pill');
  await until(() => evaluate("!document.querySelector('.island-panel-layer').classList.contains('is-hidden')"), 'expanded Island');
  await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
}
async function create(name) {
  await expand();
  await click('.terminal-new');
  const s = await until(async () => { const s = await state(); return s.id && !created.includes(s.id) && s.running && s; }, 'new independent PTY');
  created.push(s.id); await api('renameTerminal', s.id, name);
  await until(() => evaluate(`!!document.querySelector('[data-terminal-id="${s.id}"]:not([hidden]) .xterm-helper-textarea')`), 'xterm mounted');
  await wait(150); return s.id;
}
async function open(terminalId) {
  await expand();
  await home(); await click(`[data-session-id="${terminalId}"] .terminal-session-open`);
  await until(async () => (await state()).activeId === terminalId, 'selected terminal');
  await until(() => evaluate(`(()=>{const h=document.querySelector('[data-terminal-id="${terminalId}"]:not([hidden])');return Boolean(h && h.getBoundingClientRect().height>0 && h.querySelector('.xterm-helper-textarea')===document.activeElement)})()`), 'selected terminal visible and focused');
}
async function type(text, submit = true) {
  await expand();
  const s = await state();
  await evaluate(`document.querySelector('[data-terminal-id="${s.id}"] .xterm-helper-textarea').focus();true`);
  await call('Input.insertText', { text });
  if (submit) await press('Enter');
}
const hasOutput = (terminalId, marker) => until(async () => (await api('getTerminalState', terminalId))?.recentOutput.includes(marker), marker);
async function screenshot(name) {
  const clip = await until(() => evaluate("(()=>{const r=document.querySelector('.terminal-panel').getBoundingClientRect();return r.width>0 && r.height>0 ? {x:r.x,y:r.y,width:r.width,height:Math.min(r.height,innerHeight-r.y),scale:1}:null})()"), 'visible terminal screenshot');
  const shot = await call('Page.captureScreenshot', { format: 'png', clip });
  await writeFile(resolve(output, name), Buffer.from(shot.data, 'base64'));
}
try {
  await api('setSettings', { autoCollapseOnMouseLeave: false, terminalEnabled: true, terminalSavedCommands: [{ id: 'qa-multi-command', name: 'Quick command QA', command: "printf '%s%s\\n' 'QUICK_' 'OWN_SESSION'", cwdMode: 'home' }] });
  await expand();
  if (await evaluate("document.querySelector('.terminal-panel').classList.contains('is-hidden')")) await click('[data-tool-id=terminal] button');
  await until(() => evaluate("!!document.querySelector('.terminal-manager-empty')"), 'empty manager');
  await screenshot('empty.png');
  const nonce = Date.now().toString(36);
  const a = await create('Terminal QA A');
  await type(`export WI_QA_VALUE=first; printf '%s%s\\n' 'WI_A_' '${nonce}'`);
  await hasOutput(a, 'WI_A_' + nonce);
  const b = await create('Terminal QA B');
  await type(`export WI_QA_VALUE=second; (for i in 1 2 3 4 5 6; do printf '%s%s\\n' 'WI_BG_' '${nonce}'; sleep .2; done) &`);
  const c = await create('Terminal QA C');
  await type(`printf '%s%s\\n' 'WI_C_' '${nonce}'`);
  await hasOutput(c, 'WI_C_' + nonce);
  assert.equal((await state()).sessions.length, 3);
  await home(); await screenshot('three-terminals.png');
  report.threeIndependentPtys = true;
  await open(a);
  await evaluate(`document.querySelector('[data-terminal-id="${a}"] .xterm').dataset.qaInstance='preserved';true`);
  await type(`printf '%s%s\\n' 'WI_PART_' '${nonce}'`, false);
  await open(b); await hasOutput(b, 'WI_BG_' + nonce);
  await open(a);
  assert.equal(await evaluate(`document.querySelector('[data-terminal-id="${a}"] .xterm').dataset.qaInstance`), 'preserved');
  assert.equal((await api('getTerminalState', a)).recentOutput.includes('WI_PART_' + nonce), false);
  await press('Enter'); await hasOutput(a, 'WI_PART_' + nonce);
  await type("printf 'ENV_%s\\n' \"$WI_QA_VALUE\"");
  await hasOutput(a, 'ENV_first');
  assert.equal((await api('getTerminalState', a)).recentOutput.includes('WI_C_' + nonce), false);
  assert.equal((await api('getTerminalState', a)).recentOutput.includes('WI_BG_' + nonce), false);
  report.backgroundOutputInputAndDomPreserved = true;
  await type(`for i in {1..150}; do printf 'SCROLL_%s\\n' "$i"; done`);
  await hasOutput(a, 'SCROLL_150'); await wait(200);
  const screenText = () => evaluate(`document.querySelector('[data-terminal-id="${a}"] .xterm-screen').innerText`);
  const bottom = await screenText();
  const position = await evaluate(`(()=>{const r=document.querySelector('[data-terminal-id="${a}"] .xterm-screen').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await call('Input.dispatchMouseEvent', { type: 'mouseWheel', ...position, deltaX: 0, deltaY: -700 });
  const scrolledText = await until(async () => { const text = await screenText(); return text !== bottom && text; }, 'scrollback moved with mouse wheel');
  await open(c); await open(a);
  assert.equal(await screenText(), scrolledText);
  report.scrollPositionPreserved = true;
  await type(`printf '\\033[?1049h\\033[2J\\033[H%s%s\\n' 'WI_ALT_' '${nonce}'`);
  await wait(200); await open(c); await open(a);
  assert.ok(await evaluate(`document.querySelector('[data-terminal-id="${a}"] .xterm-screen').innerText.includes('WI_ALT_${nonce}')`));
  await type("printf '\\033[?1049l'");
  report.alternateScreenSurvivesSwitch = true;
  await open(b);
  await type("sleep 60 & printf 'QA_CHILD_%s\\n' $!");
  const childPid = await until(async () => Number((await api('getTerminalState', b)).recentOutput.match(/QA_CHILD_(\d+)/)?.[1]) || null, 'owned child PID');
  childPids.push(childPid);
  await home(); await click(`[data-session-id="${b}"] .terminal-row-actions button:last-child`); await click('.terminal-confirm-close');
  await until(async () => !(await state()).sessions.some(s => s.id === b), 'only middle terminal closed');
  assert.equal((await state()).sessions.length, 2);
  assert.equal((await state()).sessions.every(s => s.running), true);
  await until(async () => { try { process.kill(childPid, 0); return false; } catch { return true; } }, 'closed terminal child stopped');
  await open(c); await type(`printf '%s%s\\n' 'STILL_C_' '${nonce}'`); await hasOutput(c, 'STILL_C_' + nonce);
  report.closeIsolationAndChildCleanup = true;
  await home(); await click(`[data-session-id="${a}"] .terminal-row-actions button:first-child`);
  await evaluate("(()=>{const i=document.querySelector('.terminal-rename input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'Renamed terminal');i.dispatchEvent(new Event('input',{bubbles:true}));i.focus();return true})()");
  await press('Enter'); await until(async () => (await api('getTerminalState', a)).name === 'Renamed terminal', 'rename via keyboard');
  report.rename = true;
  await click('.quick-command');
  const quick = await until(async () => { const s = await state(); return s.sessions.find(s => s.name === 'Quick command QA'); }, 'new quick-command terminal');
  created.push(quick.id); await hasOutput(quick.id, 'QUICK_OWN_SESSION');
  assert.equal((await api('getTerminalState', a)).recentOutput.includes('QUICK_OWN_SESSION'), false);
  report.quickCommandUsesNewTerminal = true;
  await type('exit 7');
  await until(async () => (await api('getTerminalState', quick.id)).exitCode === 7, 'natural process exit');
  await click('.terminal-exit-note button');
  await until(async () => (await api('getTerminalState', quick.id)).running, 'restart exited terminal');
  await type(`printf '%s%s\\n' 'RESTARTED_' '${nonce}'`); await hasOutput(quick.id, 'RESTARTED_' + nonce);
  report.exitAndRestart = true;
  await evaluate("window.dispatchEvent(new Event('blur'));true");
  await until(() => evaluate("document.querySelector('.island-panel-layer').classList.contains('is-hidden')"), 'Island collapsed on blur');
  await expand();
  await until(() => evaluate(`!!document.querySelector('[data-terminal-id="${quick.id}"]:not([hidden])')`), 'same terminal restored after collapse');
  await type(`printf '%s%s\\n' 'RESUMED_' '${nonce}'`); await hasOutput(quick.id, 'RESUMED_' + nonce);
  report.collapseAndResume = true;
  await click('[data-tool-id=shelf] button'); await wait(100); await click('[data-tool-id=terminal] button'); await wait(100);
  assert.equal((await api('getTerminalState', a)).running, true);
  assert.equal((await state()).sessions.length, 3);
  await home(); await screenshot('verified-manager.png');
  const dimensions = await evaluate("(()=>{const e=document.querySelector('.terminal-panel');return {width:e.clientWidth,scrollWidth:e.scrollWidth,height:e.clientHeight}})()");
  assert.ok(dimensions.scrollWidth <= dimensions.width + 1);
  report.layout = dimensions;
  await api('setSettings', { terminalEnabled: false });
  assert.equal((await state()).sessions.every(s => !s.running), true);
  report.disableStopsAll = true;
  assert.deepEqual(errors, []);
  report.pass = true;
} catch (error) {
  report.failure = { message: error.message, state: await state(), ui: await evaluate("({focus:document.activeElement?.className,panel:document.querySelector('.terminal-panel')?.outerHTML.slice(0,2000)})") };
  for (const session of report.failure.state.sessions) session.outputTail = (await api('getTerminalState', session.id)).recentOutput.slice(-2500);
  throw error;
} finally {
  for (const terminalId of created) await api('closeTerminal', terminalId).catch(() => {});
  for (const pid of childPids) { try { process.kill(pid, 'SIGHUP'); } catch {} }
  await api('setSettings', { terminalEnabled: originalSettings.terminalEnabled, autoCollapseOnMouseLeave: originalSettings.autoCollapseOnMouseLeave, terminalSavedCommands: originalSettings.terminalSavedCommands }).catch(() => {});
  await writeFile(resolve(output, 'validation.json'), JSON.stringify(report, null, 2));
  socket.close();
}
console.log(JSON.stringify(report));
