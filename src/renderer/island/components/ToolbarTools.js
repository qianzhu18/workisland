import { R as React } from '../../vendor/react-runtime.js';
import { toolbarCapacity, insertTool, TOOL_SLOT } from './toolbar-model.mjs';

export function ToolbarTools({ modules, active, onSelect, onOrder, homeIcon, settingsIcon, onSettings, extras = [] }) {
  const root = React.useRef(null);
  const dragRef = React.useRef(null);
  const suppressClick = React.useRef(false);
  const [width, setWidth] = React.useState(96);
  const [drag, setDrag] = React.useState(null);
  const [menu, setMenu] = React.useState(false);
  const all = [...modules, ...extras];
  const capacity = toolbarCapacity(width, all.length);
  const visible = all.slice(0, capacity);
  const hidden = all.slice(capacity);
  const sortable = visible.filter(tool => !tool.fixed);
  const orderKey = modules.map(tool => tool.id).join(',');
  React.useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const finish = (commit = false) => {
    const state = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (state?.started) {
      document.documentElement.removeAttribute('data-toolbar-dragging');
      window.islandBridge?.setFileDragActive?.(false);
      if (commit) onOrder(state.preview);
    }
  };
  React.useEffect(() => {
    const cancel = event => {
      if (event.type === 'blur' || event.key === 'Escape') {
        finish();
        setMenu(false);
      }
    };
    const outside = event => {
      if (!root.current?.contains(event.target) && !event.target.closest?.('.performance-popover')) setMenu(false);
    };
    window.addEventListener('keydown', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('keydown', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('pointerdown', outside);
      finish();
    };
  }, []);
  React.useEffect(() => { finish(); setMenu(false); }, [width, orderKey]);
  const down = (tool, event) => {
    if (tool.fixed || event.button !== 0) return;
    suppressClick.current = false;
    const bounds = root.current.getBoundingClientRect();
    const button = event.currentTarget.getBoundingClientRect();
    dragRef.current = { id: tool.id, x: event.clientX, y: event.clientY, bounds,
      startLeft: button.left - bounds.left, started: false, preview: modules.map(tool => tool.id) };
    (event.target.closest('button') || event.currentTarget).setPointerCapture(event.pointerId);
  };
  const move = event => {
    const state = dragRef.current;
    if (!state) return;
    if (!state.started && Math.hypot(event.clientX - state.x, event.clientY - state.y) < 6) return;
    event.preventDefault();
    if (!state.started) {
      state.started = true;
      suppressClick.current = true;
      setMenu(false);
      document.documentElement.setAttribute('data-toolbar-dragging', 'true');
      window.islandBridge?.setFileDragActive?.(true);
    }
    const index = Math.max(0, Math.min(sortable.length - 1,
      Math.floor((event.clientX - state.bounds.left - TOOL_SLOT) / TOOL_SLOT)));
    state.preview = insertTool(modules.map(tool => tool.id), state.id, index);
    state.left = Math.max(TOOL_SLOT, Math.min(state.bounds.width - 2 * TOOL_SLOT, state.startLeft + event.clientX - state.x));
    state.inside = event.clientX >= state.bounds.left && event.clientX <= state.bounds.right &&
      event.clientY >= state.bounds.top && event.clientY <= state.bounds.bottom;
    setDrag({ ...state });
  };
  const up = event => {
    const state = dragRef.current;
    const bounds = state?.bounds;
    finish(Boolean(state?.started && event.clientX >= bounds.left && event.clientX <= bounds.right &&
      event.clientY >= bounds.top && event.clientY <= bounds.bottom));
  };
  const activate = tool => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (tool.action) tool.action(); else onSelect(tool.id);
    setMenu(false);
  };
  const item = tool => React.createElement('button', {
    type: 'button', className: `panel-btn toolbar-tool${tool.id === 'pet' ? ' panel-pet-button' : ''}${active === tool.id ? ' is-active' : ''}`,
    'aria-label': tool.label, title: tool.label, 'aria-pressed': !tool.fixed ? active === tool.id : undefined,
    onClick: () => activate(tool)
  }, tool.icon);
  const selectedHidden = hidden.find(tool => tool.id === active);
  return React.createElement('div', { className: `toolbar-tools${drag ? ' is-sorting' : ''}`, ref: root },
    React.createElement('button', { type: 'button', className: `panel-btn toolbar-tool${active === 'agent' ? ' is-active' : ''}`,
      title: '智能体主页', 'aria-label': '智能体主页', 'aria-pressed': active === 'agent', onClick: () => onSelect('agent') }, homeIcon),
    visible.map((tool, index) => {
      const previewIndex = drag && !tool.fixed ? drag.preview.indexOf(tool.id) : index;
      return React.createElement('div', { key: tool.id, className: 'toolbar-slot',
        style: { transform: `translateX(${(previewIndex - index) * TOOL_SLOT}px)` },
        onPointerDown: event => down(tool, event), onPointerMove: move, onPointerUp: up,
        onPointerCancel: () => finish(), onLostPointerCapture: () => finish(),
        'data-drag-source': drag?.id === tool.id ? 'true' : undefined
      }, tool.render ? tool.render() : item(tool));
    }),
    hidden.length > 0 && React.createElement('button', { type: 'button', className: `panel-btn toolbar-tool${selectedHidden ? ' is-active' : ''}`,
      title: selectedHidden ? `更多 · ${selectedHidden.label}` : '更多功能', 'aria-label': selectedHidden ? `更多功能，当前：${selectedHidden.label}` : '更多功能',
      'aria-expanded': menu, onClick: () => setMenu(value => !value) }, selectedHidden?.icon || '···'),
    React.createElement('button', { type: 'button', className: 'panel-btn toolbar-tool toolbar-settings', title: '设置', 'aria-label': '设置', onClick: onSettings }, settingsIcon),
    drag && React.createElement('div', { className: `toolbar-drag-ghost${drag.inside ? '' : ' is-cancel'}`, style: { left: drag.left }, 'aria-hidden': true }, modules.find(tool => tool.id === drag.id)?.icon),
    menu && React.createElement('div', { className: 'toolbar-overflow', 'aria-label': '更多功能',
      style: { maxHeight: Math.max(60, Math.min(260, (root.current?.closest('.panel')?.clientHeight || 320) - 60)) } },
      hidden.map(tool => React.createElement('div', { key: tool.id, className: 'toolbar-overflow-row' },
        tool.render ? React.createElement('div', { className: 'toolbar-overflow-custom' }, tool.render(), React.createElement('span', null, tool.label)) :
          React.createElement('button', { type: 'button', onClick: () => activate(tool), 'aria-pressed': active === tool.id }, tool.icon, React.createElement('span', null, tool.label)),
        !tool.fixed && React.createElement('button', { type: 'button', title: '移到快捷栏首位', 'aria-label': `将${tool.label}移到快捷栏首位`, onClick: () => {
          onOrder(insertTool(modules.map(tool => tool.id), tool.id, 0)); setMenu(false);
        } }, '置顶')
      ))
    )
  );
}
