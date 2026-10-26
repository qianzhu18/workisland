import { R as React, b as ReactDOM } from '../../vendor/react-runtime.js';
import { t } from '../../shared/i18n.js';
import { placeFloatingLayer } from './floating-layer-model.mjs';
import { codexQuotaSummary, quotaPeriods, usageTotals } from './usage-entry-model.mjs';

const codexIcon = new URL('../assets/brands/codex.svg', import.meta.url).href;
const compact = number => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(number);

export function UsageEntry({ quota, showQuota = true, labelled = false, notchHeight = 0, panelOpen = true, onOpenDashboard }) {
  const [preview, setPreview] = React.useState(false);
  const [pinned, setPinned] = React.useState(false);
  const [summary, setSummary] = React.useState(null);
  const [failed, setFailed] = React.useState(false);
  const [position, setPosition] = React.useState({ left: 12, top: 40 });
  const trigger = React.useRef(null), layer = React.useRef(null), timer = React.useRef(null);
  const visible = preview || pinned;
  const cancelTimer = () => { clearTimeout(timer.current); timer.current = null; };
  const close = () => { cancelTimer(); setPreview(false); setPinned(false); };
  const enter = () => {
    cancelTimer();
    if (document.documentElement.hasAttribute('data-toolbar-dragging')) return;
    timer.current = setTimeout(() => setPreview(true), 240);
  };
  const leave = () => { cancelTimer(); timer.current = setTimeout(() => setPreview(false), 180); };
  React.useEffect(() => {
    const dismiss = event => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'pointerdown' && (trigger.current?.contains(event.target) || layer.current?.contains(event.target))) return;
      if (event.type === 'keydown' && layer.current?.contains(document.activeElement)) trigger.current?.focus();
      close();
    };
    for (const type of ['keydown', 'pointerdown', 'blur', 'workisland:toolbar-drag-start']) window.addEventListener(type, dismiss);
    return () => {
      cancelTimer();
      for (const type of ['keydown', 'pointerdown', 'blur', 'workisland:toolbar-drag-start']) window.removeEventListener(type, dismiss);
    };
  }, []);
  React.useEffect(() => { if (!panelOpen) close(); }, [panelOpen]);
  React.useEffect(() => {
    if (!visible) return;
    let current = true;
    const refresh = async () => {
      try {
        const result = await window.islandBridge?.getUsageSummary?.(7);
        if (current) { setSummary(result || null); setFailed(!result); }
      } catch { if (current) setFailed(true); }
    };
    setFailed(false); void refresh();
    const off = window.islandBridge?.onTodayBurnUpdate?.(refresh);
    return () => { current = false; off?.(); };
  }, [visible]);
  React.useLayoutEffect(() => {
    if (!visible) return;
    const update = () => {
      if (!trigger.current || !layer.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const bounds = layer.current.getBoundingClientRect();
      const safeTop = Math.max(notchHeight + 8, anchor.bottom + 8);
      const placed = placeFloatingLayer(anchor, { width: window.innerWidth, height: window.innerHeight }, bounds);
      setPosition({ left: placed.left, top: safeTop });
    };
    update(); window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [visible, notchHeight, summary, failed]);
  const primary = showQuota ? codexQuotaSummary(quota) : null;
  const periods = showQuota ? quotaPeriods(quota) : [];
  const remaining = primary ? `${Math.round(primary.remainingPct)}%` : '—';
  const totals = usageTotals(summary);
  const cost = !totals || (!totals.costMicroUsd && totals.unknownCostTokens > 0)
    ? t('common.unknown') : `$${(totals.costMicroUsd / 1e6).toFixed(3)}`;
  const popup = visible && React.createElement('section', {
    ref: layer, className: 'usage-entry-popover', role: 'dialog', 'aria-label': t('usage.entry.title'),
    style: { left: position.left, top: position.top, maxHeight: Math.max(60, window.innerHeight - position.top - 12) },
    onMouseEnter: () => { cancelTimer(); setPreview(true); }, onMouseLeave: leave,
    onFocusCapture: () => { cancelTimer(); setPreview(true); },
    onBlurCapture: event => { if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) leave(); }
  },
    React.createElement('div', { className: 'usage-entry-heading' },
      React.createElement('strong', null, t('usage.entry.title')),
      React.createElement('button', { type: 'button', onClick: close, 'aria-label': t('common.close') }, '×')),
    React.createElement('h4', null, t('usage.entry.codex')),
    periods.length ? periods.map(period => React.createElement('div', { key: period.key, className: 'usage-entry-period' },
      React.createElement('div', null, React.createElement('span', null, period.total),
        React.createElement('strong', null, t('usage.entry.remaining', { pct: period.remainingPct }))),
      React.createElement('progress', { max: 100, value: period.remainingPct, 'aria-label': t('usage.entry.remainingWindow', { window: period.total }) }),
      period.remaining && period.remaining !== '-' && React.createElement('small', null, t('usage.entry.reset', { time: period.remaining }))
    )) : React.createElement('p', { className: 'usage-entry-muted' }, t(showQuota ? 'usage.entry.unavailable' : 'usage.entry.quotaHidden')),
    React.createElement('h4', null, t('usage.entry.api')),
    totals ? React.createElement('div', { className: 'usage-entry-stats' },
      React.createElement('div', null, React.createElement('span', null, t('usage.stat.totalTokens')), React.createElement('strong', null, compact(totals.tokens))),
      React.createElement('div', null, React.createElement('span', null, t('usage.stat.estimatedCost')), React.createElement('strong', null, cost)),
      totals.unknownCostTokens > 0 && React.createElement('small', null, t('usage.stat.unknownPricing', { tokens: compact(totals.unknownCostTokens) }))
    ) : React.createElement('p', { className: 'usage-entry-muted', role: 'status' }, t(failed ? 'usage.entry.failed' : 'usage.loading.summary')),
    React.createElement('p', { className: 'usage-entry-muted' }, t('usage.entry.localHint')),
    React.createElement('button', { type: 'button', className: 'usage-entry-details', onClick: () => { close(); onOpenDashboard(); } }, t('usage.entry.details'))
  );
  return React.createElement(React.Fragment, null,
    React.createElement('button', {
      ref: trigger, type: 'button', className: `panel-btn toolbar-tool usage-entry-button${visible ? ' is-active' : ''}${labelled ? ' is-labelled' : ''}`,
      'aria-label': `${t('usage.entry.title')} · ${primary ? t('usage.entry.remaining', { pct: primary.remainingPct }) : t('usage.entry.noData')}`,
      'aria-haspopup': 'dialog', 'aria-expanded': visible,
      onMouseEnter: enter, onMouseLeave: leave,
      onFocus: event => { if (event.currentTarget.matches(':focus-visible')) { cancelTimer(); setPreview(true); } },
      onBlur: event => { if (!layer.current?.contains(event.relatedTarget)) leave(); },
      onClick: () => { cancelTimer(); setPreview(false); setPinned(value => !value); }
    }, React.createElement('span', { className: 'usage-entry-glyph' },
      React.createElement('img', { src: codexIcon, alt: '', draggable: false }),
      React.createElement('span', { className: primary?.remainingPct <= 20 ? 'is-low' : '' }, showQuota ? remaining : 'API')),
      labelled && React.createElement('span', null, t('usage.entry.title'))),
    popup && ReactDOM.createPortal(popup, document.body)
  );
}
