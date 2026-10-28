// Capture stays on the source element until release; reparenting occurs in main
// only after 'end'. All cancellation paths share the same idempotent cleanup.
export function bindTerminalDrag(element, { send, onActive = () => {}, onError = () => {} }) {
  let pointer = null, timer;
  const point = event => event && Number.isFinite(event.screenX) && Number.isFinite(event.screenY) ? { x: event.screenX, y: event.screenY } : undefined;
  const request = (phase, event) => Promise.resolve(send(phase, point(event))).catch(onError);
  const finish = (phase, event) => {
    if (pointer === null) return;
    const id = pointer; pointer = null; clearTimeout(timer);
    onActive(false); request(phase, event);
    if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
  };
  const down = event => {
    if (event.button !== 0 || pointer !== null) return;
    event.preventDefault(); pointer = event.pointerId; element.setPointerCapture(pointer);
    onActive(true); request('begin', event); timer = setTimeout(() => finish('cancel'), 20000);
  };
  const move = event => {
    if (event.pointerId !== pointer) return;
    // Native accessibility drags on macOS can omit buttons on move events.
    // Capture + pointerup/lostcapture/blur/timeout own this gesture's lifetime.
    request('move', event);
  };
  const up = event => { if (event.pointerId === pointer) finish('end', event); };
  const cancel = () => finish('cancel');
  const key = event => { if (event.key === 'Escape' && pointer !== null) { event.preventDefault(); event.stopPropagation(); cancel(); } };
  element.addEventListener('pointerdown', down); window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true);
  element.addEventListener('pointercancel', cancel); element.addEventListener('lostpointercapture', cancel);
  window.addEventListener('blur', cancel); window.addEventListener('keydown', key, true);
  return () => {
    cancel(); element.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true);
    element.removeEventListener('pointercancel', cancel); element.removeEventListener('lostpointercapture', cancel);
    window.removeEventListener('blur', cancel); window.removeEventListener('keydown', key, true);
  };
}
