import { R as React } from '../../vendor/react-runtime.js';
import { t } from '../../shared/i18n.js';
import { insertTool, moveToolbarTool, TOOL_SLOT, toolbarActivationTarget, toolbarSlots, toolbarDropTarget, visibleToolbarOrder, placeToolbarTools } from './toolbar-model.mjs';

export function ToolbarTools({ modules, active, onSelect, onOrder, order = [], hiddenModules = [], moduleSides = {}, moduleSlots = {},
  homeIcon, settingsIcon, onSettings, extras = [], leading, notchWidth = 0, notchHeight = 32 }) {
  const root = React.useRef(null);
  const leadingRef = React.useRef(null);
  const dragRef = React.useRef(null);
  const latest = React.useRef({});
  const previousPositions = React.useRef(new Map());
  const suppressClick = React.useRef(false);
  const suppressionTimer = React.useRef(null);
  const [measure, setMeasure] = React.useState({ width: 640, leading: 0 });
  const [drag, setDrag] = React.useState(null);
  const [menu, setMenu] = React.useState(false);
  const [error, setError] = React.useState('');
  const defs = [...modules, ...extras];
  const ids = [...order.filter(id => defs.some(tool => tool.id === id)), ...defs.map(tool => tool.id).filter(id => !order.includes(id))];
  const all = ids.map(id => defs.find(tool => tool.id === id));
  const layout = toolbarSlots(measure.width, notchWidth, measure.leading);
  const arranged = drag?.preview || visibleToolbarOrder(ids, hiddenModules);
  const placements = placeToolbarTools(arranged, layout, drag?.sides || moduleSides, drag?.saved || moduleSlots);
  const shownIds = [...placements.keys()];
  const hidden = all.filter(tool => !shownIds.includes(tool.id));
  const menuTools = [...hidden, ...all.filter(tool => shownIds.includes(tool.id))];
  latest.current = { ids, layout, onOrder, hiddenModules, moduleSides, moduleSlots };

  const save = (nextOrder, nextHidden, nextSides = latest.current.moduleSides, nextSlots = latest.current.moduleSlots) => {
    setError('');
    Promise.resolve(latest.current.onOrder(nextOrder, nextHidden, nextSides, nextSlots)).catch(() => setError(t('toolbar.saveFailed')));
  };
  const finish = (commit = false) => {
    const state = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (state?.started) {
      clearInterval(state.lease);
      document.documentElement.removeAttribute('data-toolbar-dragging');
      window.islandBridge?.setFileDragActive?.(false);
      if (commit && state.target !== null) {
        const current = latest.current;
        const nextHidden = current.hiddenModules.filter(id => id !== state.id);
        if (state.target === 'more') nextHidden.push(state.id);
        const next = state.target === 'more' ? current.ids : [
          ...state.preview, ...current.ids.filter(id => !state.preview.includes(id))
        ];
        save(next, nextHidden, state.sides || current.moduleSides, state.saved || current.moduleSlots);
        setMenu(false);
      }
      // Suppress the synthesized click from this release, not a later keyboard click.
      clearTimeout(suppressionTimer.current);
      suppressionTimer.current = setTimeout(() => { suppressClick.current = false; }, 0);
    }
  };

  React.useLayoutEffect(() => {
    const update = () => setMeasure({ width: root.current.clientWidth,
      leading: leadingRef.current.getBoundingClientRect().width });
    const observer = new ResizeObserver(update);
    observer.observe(root.current);
    observer.observe(leadingRef.current);
    update();
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => { finish(); }, [measure.width, measure.leading, notchWidth, ids.join(','), hiddenModules.join(','), JSON.stringify(moduleSides), JSON.stringify(moduleSlots)]);
  React.useEffect(() => {
    const cancel = event => {
      if (event.type === 'blur' || event.key === 'Escape') { finish(); setMenu(false); }
    };
    const outside = event => {
      if (!root.current?.contains(event.target) && !event.target.closest?.('.performance-popover')) setMenu(false);
    };
    window.addEventListener('keydown', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('pointerdown', outside);
    const release = () => { if (dragRef.current && !dragRef.current.started) finish(); };
    window.addEventListener('pointerup', release);
    return () => {
      window.removeEventListener('keydown', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('pointerup', release);
      finish();
      clearTimeout(suppressionTimer.current);
    };
  }, []);

  const down = event => {
    if (event.button !== 0 || event.target.closest('[data-toolbar-command]')) return;
    const handle = event.target.closest('[data-tool-id]');
    if (!handle || !root.current.contains(handle)) return;
    suppressClick.current = false;
    dragRef.current = { id: handle.dataset.toolId, x: event.clientX, y: event.clientY,
      started: false, target: null, bounds: root.current.getBoundingClientRect() };
  };
  const move = event => {
    const state = dragRef.current;
    if (!state) return;
    if (event.type !== 'pointerup' && !(event.buttons & 1)) { finish(); return; }
    if (!state.started && Math.hypot(event.clientX - state.x, event.clientY - state.y) < 6) return;
    event.preventDefault();
    const current = latest.current;
    if (!state.started) {
      state.started = true;
      suppressClick.current = true;
      // Capture on the stable toolbar, so a menu item can move between banks
      // without losing the gesture when its original DOM element disappears.
      root.current.setPointerCapture(event.pointerId);
      document.documentElement.setAttribute('data-toolbar-dragging', 'true');
      window.dispatchEvent(new Event('workisland:toolbar-drag-start'));
      window.islandBridge?.setFileDragActive?.(true);
      state.lease = setInterval(() => window.islandBridge?.setFileDragActive?.(true), 10000);
    }
    const x = event.clientX - state.bounds.left;
    const y = event.clientY - state.bounds.top;
    state.target = toolbarDropTarget(current.layout, x, y, state.bounds.height);
    const base = visibleToolbarOrder(current.ids, current.hiddenModules, state.id);
    if (typeof state.target === 'number') {
      const destination = current.layout.slots[state.target];
      const original = placeToolbarTools(base, current.layout, current.moduleSides, current.moduleSlots);
      const occupant = [...original.entries()].find(([, slot]) => slot.index === state.target)?.[0];
      state.sides = { ...current.moduleSides, [state.id]: destination.bank };
      state.saved = moveToolbarTool(visibleToolbarOrder(current.ids, current.hiddenModules), current.layout, current.moduleSides, current.moduleSlots, state.id, state.target);
      state.preview = insertTool(base, state.id, occupant ? base.indexOf(occupant) : base.length - 1);
    } else {
      state.sides = current.moduleSides;
      state.saved = state.target === 'more'
        ? { ...current.moduleSlots, ...Object.fromEntries(placeToolbarTools(visibleToolbarOrder(current.ids, current.hiddenModules), current.layout, current.moduleSides, current.moduleSlots).entries().map(([id, slot]) => [id, slot.key])) }
        : current.moduleSlots;
      state.preview = state.target === 'more' ? base.filter(id => id !== state.id) : visibleToolbarOrder(current.ids, current.hiddenModules);
    }
    state.left = Math.max(0, Math.min(measure.width - TOOL_SLOT, x - TOOL_SLOT / 2));
    // The ghost takes a visible path below the physical camera when crossing it.
    const crossesCamera = notchWidth > 0 && state.left < current.layout.cameraRight &&
      state.left + TOOL_SLOT > current.layout.cameraLeft;
    state.top = crossesCamera ? Math.max(notchHeight + 4, y - 15) : Math.max(0, y - 15);
    setDrag({ ...state });
  };
  const up = event => {
    const state = dragRef.current;
    if (state?.started) move(event);
    finish(true);
  };
  const activate = tool => {
    if (tool.disabled) return;
    if (tool.action) tool.action(); else onSelect(toolbarActivationTarget(active, tool.id));
    setMenu(false);
  };
  const promote = tool => {
    if (!layout.slots.length) return;
    const target = layout.slots.findIndex(slot => ![...placements.values()].some(p => p.key === slot.key));
    const saved = moveToolbarTool(visibleToolbarOrder(ids, hiddenModules), layout, moduleSides, moduleSlots, tool.id, Math.max(0, target));
    save(insertTool(ids, tool.id, 0), hiddenModules.filter(id => id !== tool.id), moduleSides, saved);
    setMenu(false);
  };
  const hide = tool => {
    save(ids, [...new Set([...hiddenModules, tool.id])], moduleSides,
      { ...moduleSlots, ...Object.fromEntries([...placements].map(([id, slot]) => [id, slot.key])) });
    setMenu(false);
  };
  const basicButton = (tool, labelled = false) => {
    const returnsHome = !tool.action && active === tool.id;
    const label = active === tool.id ? t('toolbar.agentHome') : tool.label;
    const icon = active === tool.id ? homeIcon : tool.icon;
    return React.createElement('button', {
    type: 'button', className: 'panel-btn toolbar-tool' + (tool.id === 'pet' ? ' panel-pet-button' : '') + (active === tool.id ? ' is-active' : ''),
    'aria-label': label, title: label, 'aria-pressed': tool.action ? undefined : active === tool.id,
    'aria-disabled': tool.disabled,
    onClick: () => activate(tool)
    }, React.createElement('span', { className: 'toolbar-tool-icon' + (returnsHome ? ' is-home' : '') }, icon),
      labelled && React.createElement('span', null, returnsHome ? label : tool.label));
  };

  const positions = new Map();
  const slots = all.map(tool => {
    const slot = placements.get(tool.id);
    if (!slot) return null;
    const previous = previousPositions.current.get(tool.id);
    positions.set(tool.id, slot);
    return React.createElement('div', { key: tool.id, 'data-tool-id': tool.id,
      className: 'toolbar-slot', 'data-bank': slot.bank, 'data-slot': slot.key,
      'data-drag-source': drag?.id === tool.id ? 'true' : undefined,
      style: { position: 'absolute', left: 0, transform: 'translateX(' + slot.x + 'px)',
        transition: drag && previous?.bank === slot.bank ? 'transform 150ms ease' : 'none' }
    }, tool.render ? tool.render(false) : basicButton(tool));
  });
  React.useLayoutEffect(() => { previousPositions.current = positions; });
  const selectedHidden = hidden.find(tool => tool.id === active);
  return React.createElement('div', { className: 'toolbar-header', style: { minHeight: Math.max(32, notchHeight) } },
    React.createElement('div', { className: 'toolbar-tools' + (drag ? ' is-sorting' : ''), ref: root,
      onPointerDownCapture: down, onPointerMove: move, onPointerUp: up, onPointerCancel: () => finish(),
      onLostPointerCapture: () => finish(),
      onClickCapture: event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); } }
    },
      React.createElement('div', { ref: leadingRef, className: 'usage-row-agents toolbar-leading', style: { maxWidth: layout.cameraLeft } }, leading),
      React.createElement('div', { className: 'toolbar-camera-space', 'aria-hidden': true, style: { left: layout.cameraLeft, width: notchWidth } }),
      ...slots,
      drag && layout.slots.map((slot, index) => ![...placements.values()].some(position => position.index === index) && React.createElement('div', {
        key: 'empty-' + index, className: 'toolbar-empty-slot', style: { left: slot.x }, 'aria-hidden': true
      })),
      React.createElement('button', { type: 'button', className: 'panel-btn toolbar-tool toolbar-more' + (selectedHidden ? ' is-active' : '') + (drag?.target === 'more' ? ' is-drop-target' : ''),
        style: { left: layout.more }, title: selectedHidden ? t('toolbar.moreSelected', { tool: selectedHidden.label }) : t('toolbar.moreAndShortcuts'),
        'aria-label': t('toolbar.more'), 'aria-expanded': menu, onClick: () => setMenu(value => !value)
      }, selectedHidden?.icon || '···'),
      React.createElement('button', { type: 'button', className: 'panel-btn toolbar-tool toolbar-settings',
        style: { left: layout.settings }, title: t('common.settings'), 'aria-label': t('common.settings'), onClick: onSettings }, settingsIcon),
      drag && React.createElement('div', { className: 'toolbar-drag-ghost' + (drag.target === null ? ' is-cancel' : ''),
        style: { left: drag.left, top: drag.top }, 'aria-hidden': true }, defs.find(tool => tool.id === drag.id)?.icon),
      menu && React.createElement('div', { className: 'toolbar-overflow' + (drag ? ' is-dragging' : ''), 'aria-label': t('toolbar.more'),
        style: { top: Math.max(32, notchHeight) + 6, maxHeight: Math.max(64, Math.min(300, (root.current?.closest('.panel')?.clientHeight || 320) - Math.max(32, notchHeight) - 24)) }
      },
        React.createElement('div', { className: 'toolbar-menu-hint' }, t('toolbar.dragHint')),
        ...menuTools.map(tool => React.createElement('div', { key: tool.id, className: 'toolbar-overflow-row',
          'data-tool-id': tool.id, 'data-menu-tool': tool.id, 'data-drag-source': drag?.id === tool.id ? 'true' : undefined
        },
          tool.render ? tool.render(true) : basicButton(tool, true),
          React.createElement('button', { type: 'button', 'data-toolbar-command': true,
            title: t(shownIds.includes(tool.id) ? 'toolbar.moveToMore' : 'toolbar.pin'),
            'aria-label': t(shownIds.includes(tool.id) ? 'toolbar.moveToolToMore' : 'toolbar.pinTool', { tool: tool.label }),
            onClick: () => shownIds.includes(tool.id) ? hide(tool) : promote(tool)
          }, t(shownIds.includes(tool.id) ? 'toolbar.store' : 'toolbar.pinShort'))
        ))
      ),
      error && React.createElement('div', { className: 'toolbar-save-error', role: 'alert' }, error)
    )
  );
}
