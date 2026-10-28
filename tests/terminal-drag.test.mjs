import assert from 'node:assert/strict';
import test from 'node:test';
import { bindTerminalDrag } from '../src/renderer/island/components/terminal-drag.mjs';

test('captured native drag handles move events without button flags and releases once', () => {
  const previous = global.window; global.window = new EventTarget();
  const element = new EventTarget(); let capture = false; const sent = [];
  element.setPointerCapture = () => { capture = true; };
  element.hasPointerCapture = () => capture;
  element.releasePointerCapture = () => { capture = false; element.dispatchEvent(new Event('lostpointercapture')); };
  const cleanup = bindTerminalDrag(element, { send: (phase, point) => sent.push({ phase, point }) });
  const event = (type, props) => { const e = new Event(type); Object.assign(e, { pointerId: 1, button: 0, buttons: 0, screenX: 100, screenY: 50 }, props); (type === 'pointermove' || type === 'pointerup' ? window : element).dispatchEvent(e); };
  try {
    event('pointerdown', { buttons: 1 }); event('pointermove', { screenX: 300 }); event('pointerup', { screenX: 300 });
    assert.deepEqual(sent.map(s => s.phase), ['begin', 'move', 'end']);
    assert.deepEqual(sent.at(-1).point, { x: 300, y: 50 }); assert.equal(capture, false);
    event('pointerdown', { buttons: 1 }); element.dispatchEvent(new Event('lostpointercapture'));
    assert.deepEqual(sent.slice(-2).map(s => s.phase), ['begin', 'cancel']);
  } finally { cleanup(); global.window = previous; }
});

test('Island drag ignores child-view DOM blur and cancels on actual native window blur', () => {
  const previous = global.window; global.window = new EventTarget();
  const element = new EventTarget(), sent = []; let captured = false;
  element.setPointerCapture = () => { captured = true; }; element.hasPointerCapture = () => captured; element.releasePointerCapture = () => { captured = false; };
  const cleanup = bindTerminalDrag(element, { blurEvent: 'workisland-window-blur', send: phase => sent.push(phase) });
  try {
    const down = new Event('pointerdown'); Object.assign(down, { button: 0, pointerId: 1 }); element.dispatchEvent(down);
    window.dispatchEvent(new Event('blur')); assert.deepEqual(sent, ['begin']);
    window.dispatchEvent(new Event('workisland-window-blur')); assert.deepEqual(sent, ['begin', 'cancel']);
  } finally { cleanup(); global.window = previous; }
});
