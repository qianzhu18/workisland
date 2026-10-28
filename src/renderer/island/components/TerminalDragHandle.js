import { R as React } from '../../vendor/react-runtime.js';
import { t } from '../../shared/i18n.js';
import { bindTerminalDrag } from './terminal-drag.mjs';
export function TerminalDragHandle({ id, Icon, onError }) {
  const ref = React.useRef(null);
  React.useEffect(() => bindTerminalDrag(ref.current, {
    send: (phase, point) => window.islandBridge.dragTerminal(id, phase, point), onError, blurEvent: 'workisland-window-blur',
    onActive: active => document.documentElement.toggleAttribute('data-terminal-dragging', active)
  }), [id, onError]);
  return React.createElement('button', { ref, type: 'button', className: 'terminal-icon-action terminal-drag-handle', title: t('terminal.window.dragOut'), 'aria-label': t('terminal.window.dragOut') }, React.createElement(Icon, { kind: 'drag' }));
}
