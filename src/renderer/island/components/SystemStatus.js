import { r as hooks, R as React } from '../../vendor/react-runtime.js';
import { t } from '../../shared/i18n.js';
import { systemActivity, formatWatts, formatTransferRate } from './system-status-model.mjs';
const h = React.createElement;

const paths = {
  battery: ['M2 6h16v12H2z', 'M20 10v4', 'M6 10v4m4-4v4m4-4v4'],
  network: ['M2 8a16 16 0 0 1 20 0', 'M5 12a11 11 0 0 1 14 0', 'M8.5 15.5a5.5 5.5 0 0 1 7 0', 'M12 19h.01'],
  audio: ['M4 14v-3a8 8 0 0 1 16 0v3', 'M4 12H3v7h4v-7z', 'M20 12h1v7h-4v-7z'],
  capture: ['M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5', 'M9 9h6v6H9z'],
  downloads: ['M12 3v12m-5-5 5 5 5-5', 'M4 17v4h16v-4'],
  lockScreen: ['M6 11h12v10H6z', 'M8 11V7a4 4 0 0 1 8 0v4']
};
export function SystemIcon({ kind, className = '' }) {
  return h('svg', { className: `system-icon ${className}`, viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    (paths[kind] || paths.network).map((d, i) => h('path', { d, key: i })));
}
export function useSystemActivity(state, suppressed = false) {
  const [now, setNow] = hooks.useState(Date.now);
  hooks.useEffect(() => {
    setNow(Date.now());
    const remaining = (state?.notice?.at || 0) + 6000 - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), remaining + 5);
    return () => clearTimeout(timer);
  }, [state?.notice?.at]);
  return systemActivity(state, Math.max(now, Date.now()), suppressed);
}
function availability(value) { return t(value?.enabled === false ? 'system.disabled' : 'system.unavailable'); }
function batteryLabel(value) {
  if (!value?.available) return availability(value);
  if (!value.present) return t('system.battery.noBattery');
  return `${value.percent == null ? '—' : `${Math.round(value.percent)}%`} · ${t(value.charging ? 'system.battery.charging' : value.externalConnected ? 'system.battery.plugged' : 'system.battery.onBattery')}`;
}
function networkLabel(value) {
  if (!value?.available) return availability(value);
  if (value.connected == null) return t('system.unavailable');
  if (!value.connected) return t('system.network.disconnected');
  return value.name || t(`system.network.${value.type === 'wifi' && value.expensive ? 'hotspot' : value.type}`);
}
function audioLabel(value) {
  if (!value?.available) return availability(value);
  return value.devices?.find(device => device.id === value.activeDeviceId)?.name || t('system.audio.noOutput');
}
export function SystemStatus({ state }) {
  const [previewError, setPreviewError] = hooks.useState(false);
  if (!state || !['battery', 'network', 'audio', 'capture', 'downloads', 'lockScreen'].some(kind => state[kind]?.enabled)) return null;
  const battery = state.battery;
  const rows = [
    ['battery', batteryLabel(battery)],
    ['network', networkLabel(state.network)],
    ['audio', audioLabel(state.audio)],
    ['capture', state.capture?.available ? t(state.capture.active ? 'system.capture.active' : 'system.capture.idle') : availability(state.capture)],
    ['downloads', state.downloads?.available ? state.downloads.active ? t('system.downloads.active', { count: state.downloads.items.length }) : t('system.downloads.idle') : availability(state.downloads)]
  ].filter(([kind]) => state[kind]?.enabled);
  return h('section', { className: 'system-status', 'aria-label': t('system.title') },
    h('h2', { className: 'system-status-heading' }, t('system.title')),
    h('div', { id: 'system-status-details', className: 'system-status-details' },
      h('dl', { className: 'system-status-rows' }, rows.map(([kind, label]) => h('div', { className: 'system-status-row', key: kind }, h('dt', null, h(SystemIcon, { kind }), t(`system.${kind}.title`)), h('dd', null, label)))),
      battery?.enabled && battery?.available && battery?.present && h('div', { className: 'system-power-readings' },
        ...[['chargingWatts', 'chargePower'], ['inputWatts', 'inputPower'], ['adapterWatts', 'adapterPower']].map(([field, label]) => h('div', { key: field }, h('span', null, t(`system.battery.${label}`)), h('strong', null, formatWatts(battery[field])))),
        h('p', null, t('system.battery.powerHint'))),
      state.audio?.available && state.audio.devices?.filter(device => device.connected && device.transport === 'bluetooth').map(device => h('div', { className: 'system-device-row', key: device.id }, h('span', null, device.name), h('span', null, device.id === state.audio.activeDeviceId ? t('system.audio.currentOutput') : t('system.audio.connected'), device.batteryPercent == null ? '' : ` · ${Math.round(device.batteryPercent)}%`))),
      state.downloads?.active && h('div', { className: 'system-download-list' }, state.downloads.items.map(item => h('div', { className: 'system-device-row', key: item.id || item.name }, h('span', { title: item.name }, item.name), h('span', null, formatTransferRate(item.speedBytesPerSecond)))), h('p', null, t('system.downloads.scope'))),
      h('div', { className: 'system-lock-actions' },
        h('span', null, t('system.lockScreen.title'), ' · ', state.lockScreen?.enabled === false ? t('system.disabled') : state.lockScreen?.available ? t('system.lockScreen.ready') : t('system.unavailable')),
        state.lockScreen?.available && h('button', { type: 'button', onClick: async () => { try { setPreviewError(!await window.islandBridge?.previewSystemLockScreen?.()); } catch { setPreviewError(true); } } }, t('system.lockScreen.preview'))),
      previewError && h('p', { className: 'system-status-error', role: 'status' }, t('system.lockScreen.previewFailed')),
      h('p', { className: 'system-status-footnote' }, t('system.localOnly'))));
}
