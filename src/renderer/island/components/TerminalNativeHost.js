import { R as React } from '../../vendor/react-runtime.js';
export function TerminalNativeHost({ session, visible, onError }) {
  const host = React.useRef(null);
  React.useEffect(() => {
    if (!visible) { window.islandBridge.hideTerminalView(session.id); return undefined; }
    let frame = 0, disposed = false, focus = true;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const element = host.current; if (!element || disposed) return;
        const r = element.getBoundingClientRect();
        const panel = element.closest('.panel')?.getBoundingClientRect();
        const x = Math.max(0, r.x), y = Math.max(0, r.y, panel?.top || 0);
        const right = Math.min(innerWidth, r.right, panel?.right || innerWidth), bottom = Math.min(innerHeight, r.bottom, panel?.bottom || innerHeight);
        if (right <= x || bottom <= y) { focus = true; window.islandBridge.hideTerminalView(session.id); return; }
        const shouldFocus = focus;
        window.islandBridge.layoutTerminalView(session.id, { x, y, width: right - x, height: bottom - y }, shouldFocus).then(result => { if (result) focus = false; }).catch(() => { if (!disposed) onError(); });
      });
    };
    const observer = new ResizeObserver(update); observer.observe(host.current);
    document.addEventListener('scroll', update, true); window.addEventListener('resize', update); update();
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); window.islandBridge.hideTerminalView(session.id); };
  }, [session.id, session.generation, visible, onError]);
  return React.createElement('div', { ref: host, className: 'terminal-native-host', 'data-native-visible': visible ? 'true' : 'false', 'data-terminal-id': session.id, hidden: !visible });
}
