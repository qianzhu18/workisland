import { R as React } from '../../vendor/react-runtime.js';
import { t } from '../../shared/i18n.js';
import { SystemIcon } from './SystemStatus.js';

export function SystemNoticeCard({ notice, layout, panelStyle = {}, onDetails }) {
  return React.createElement('div', {
    className: 'panel system-notice-panel',
    style: { ...panelStyle, '--system-notice-content-top': `${layout.contentTop}px`, height: layout.height }
  }, React.createElement('button', { className: 'system-notice-content', type: 'button', onClick: onDetails, 'aria-label': t('system.viewDetails') },
    React.createElement(SystemIcon, { kind: notice?.icon || 'network' }),
    React.createElement('span', null,
      React.createElement('strong', { role: 'status' }, t(notice?.key || 'system.title', notice || {})),
      notice?.name && React.createElement('span', { className: 'system-notice-name' }, notice.name)),
    React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor', 'aria-hidden': true }, React.createElement('path', { d: 'm4 2 4 4-4 4' }))));
}
