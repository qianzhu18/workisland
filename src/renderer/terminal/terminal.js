import { Terminal } from '../../../node_modules/@xterm/xterm/lib/xterm.mjs';
import { FitAddon } from '../../../node_modules/@xterm/addon-fit/lib/addon-fit.mjs';
import { initializeI18n, onLocaleChange, t } from '../shared/i18n.js';
import { createTerminalStream } from '../island/components/terminal-stream.mjs';
import { bindTerminalDrag } from '../island/components/terminal-drag.mjs';
const bridge = window.terminalBridge, host = document.getElementById('terminal');
export const terminal = new Terminal({ cursorBlink: true, fontFamily: 'SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.25,
  theme: { background: '#07090c', foreground: '#e7edf5', cursor: '#72e7a7', selectionBackground: '#315b48' }, scrollback: 5000 });
const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(host);
const stream = createTerminalStream({ ...bridge.identity, write: data => terminal.write(data) });
const offData = bridge.onData(frame => stream.accept(frame));
let state = null, lastSize = '';
const fail = () => { const note = document.getElementById('error'); note.hidden = false; note.textContent = t('terminal.manager.operationFailed'); };
function apply(next) {
  if (!next || next.generation !== bridge.identity.generation) return;
  state = next; document.documentElement.dataset.location = next.location;
  document.getElementById('title').textContent = next.name || t('terminal.manager.defaultName', { number: next.ordinal });
  document.getElementById('drag').title = t('terminal.window.dragBack');
  document.getElementById('dock').textContent = t('terminal.window.dock');
  document.getElementById('exit').hidden = next.running;
  document.querySelector('#exit span').textContent = t('terminal.manager.exitCode', { code: next.exitCode ?? '–' });
  document.getElementById('restart').textContent = t('terminal.full.restart'); terminal.options.disableStdin = !next.running;
}
function resize() {
  // Ignore the intermediate native resize while location/header and viewport
  // metadata cross processes. Only fit the committed host's content geometry.
  if (!state?.viewport || innerWidth !== state.viewport.width || innerHeight !== state.viewport.height) return;
  const rect = host.getBoundingClientRect(); if (rect.width < 1 || rect.height < 1) return;
  const dimensions = fit.proposeDimensions(); if (!dimensions) return;
  const cols = Math.max(20, Math.min(500, dimensions.cols)), rows = Math.max(5, Math.min(200, dimensions.rows));
  const size = `${cols}:${rows}`; if (size === lastSize) return; lastSize = size;
  terminal.resize(cols, rows); bridge.resize(cols, rows).catch(fail);
}
const offLocale = onLocaleChange(() => apply(state));
const offState = bridge.onState(next => { apply(next); requestAnimationFrame(resize); });
const offDrag = bridge.onDragState(drag => { document.documentElement.dataset.dockReady = String(Boolean(drag.active && drag.over)); });
terminal.onData(data => { if (state?.running) bridge.input(data).catch(fail); });
const observer = new ResizeObserver(resize); observer.observe(host);
bindTerminalDrag(document.getElementById('drag'), { send: (phase, point) => bridge.drag(phase, point), onError: fail });
document.getElementById('dock').onclick = () => bridge.dock().catch(fail);
document.getElementById('restart').onclick = () => bridge.restart().catch(fail);
window.addEventListener('focus', () => { terminal.focus(); void initializeI18n(bridge).then(() => apply(state)); });
window.addEventListener('unload', () => { offData(); offState(); offDrag(); offLocale(); stream.dispose(); observer.disconnect(); terminal.dispose(); });
await initializeI18n(bridge);
for (let n = 0; n < 5; n++) {
  const snapshot = await bridge.getState(); apply(snapshot);
  if (stream.restore(snapshot)) break;
  if (n === 4) fail();
}
resize();
