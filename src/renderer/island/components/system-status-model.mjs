export function systemActivity(state, now = Date.now(), hasAttention = false) {
  if (!state || hasAttention) return null;
  if (state.capture?.available && state.capture.active) return { kind: 'capture', key: 'system.capture.active' };
  if (state.downloads?.available && state.downloads.active) return { kind: 'downloads', key: 'system.downloads.active', count: state.downloads.items?.length || 1 };
  if (state.notice && now >= state.notice.at && now - state.notice.at < 6000) return { ...state.notice, key: `system.notice.${state.notice.kind}` };
  return null;
}
const noticeCapabilities = { 'capture-started': 'capture', 'capture-stopped': 'capture', 'download-started': 'downloads', 'download-completed': 'downloads', 'download-cancelled': 'downloads', 'audio-changed': 'audio', 'audio-connected': 'audio', 'audio-disconnected': 'audio', 'network-connected': 'network', 'network-disconnected': 'network', 'power-connected': 'battery', 'power-disconnected': 'battery' };
export function systemNotice(state, now = Date.now()) {
  const notice = state?.notice;
  const capability = noticeCapabilities[notice?.kind];
  if (!capability || state?.[capability]?.enabled === false || !Number.isFinite(notice.at) || now < notice.at || now - notice.at >= 6000) return null;
  return { ...notice, key: `system.notice.${notice.kind}`, icon: capability };
}
export function shouldPresentSystemNotice({ state, now = Date.now(), hasAttention = false, isOpen = false, surfaceType } = {}) {
  return !!systemNotice(state, now) && !state?.locked && !state?.notificationsSuppressed && !hasAttention && (!isOpen || surfaceType === 'systemStatus');
}
export function formatWatts(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${value.toFixed(1)} W` : '—'; }
export function formatTransferRate(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—';
  return value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB/s` : `${(value / 1024).toFixed(0)} KB/s`;
}
