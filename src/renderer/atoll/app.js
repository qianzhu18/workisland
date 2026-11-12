import { R as React, a as ReactDOM } from '../vendor/react-runtime.js';
import { initializeI18n, t, onLocaleChange } from '../shared/i18n.js';
import { l as loadPluginAgentMeta } from '../shared/settings.js';
import { SessionRow, AgentQuotaCell, SubagentList, ContinuePromptInput, renderActionableCard } from '../island/components/IslandPanel.js';
import { canContinueSessionViaTerminalPrompt, sortVisibleSessions } from '../island/session-model.mjs';
import { UsagePanel } from '../island/components/UsagePanel.js';
import { request, updateBridge } from './bridge.js';

await initializeI18n();
await loadPluginAgentMeta(() => window.islandBridge.getPluginAgentMeta());

function Quota({ tool, quota }) {
  if (!quota) return React.createElement('span', { className: 'atoll-missing-quota' }, t('atoll.noQuota', { agent: tool === 'codex' ? 'Codex' : 'Claude' }));
  const historical = Number.isFinite(quota.capturedAt) && Date.now() - quota.capturedAt > 15 * 60 * 1000;
  return React.createElement('div', { className: 'atoll-quota', title: quota.capturedAt ? new Date(quota.capturedAt).toLocaleString() : undefined },
    React.createElement(AgentQuotaCell, { tool, quota }),
    historical && React.createElement('small', { className: 'atoll-quota-history' }, t('atoll.staleQuota')));
}

function Icon({ name }) {
  const paths = { up: 'm5 10 3-3 3 3', down: 'm5 6 3 3 3-3', settings: 'M6 2h4l.5 2 1.8 1 2-.5 2 3.5-1.5 1.5v2l1.5 1.5-2 3.5-2-.5-1.8 1L10 18H6l-.5-2-1.8-1-2 .5-2-3.5L1.2 10V8L-.3 6.5l2-3.5 2 .5 1.8-1Z' };
  return React.createElement('svg', { width: 16, height: 16, viewBox: name === 'settings' ? '-2 0 20 20' : '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    React.createElement('path', { d: paths[name] }), name === 'settings' && React.createElement('circle', { cx: 8, cy: 9, r: 2.5 }));
}

function SessionCard({ session, initiallyExpanded, followUpOpen, onFollowUp, onCloseFollowUp }) {
  const [expanded, setExpanded] = React.useState(initiallyExpanded);
  const article = React.useRef(null);
  const showDetails = expanded || followUpOpen;
  const pending = ['waitingForApproval', 'waitingForAnswer'].includes(session.phase);
  const label = t(session.phase === 'waitingForApproval' ? 'atoll.reviewApproval' : session.phase === 'waitingForAnswer' ? 'atoll.reviewAnswer' : 'atoll.details');
  function toggle() {
    if (showDetails) { setExpanded(false); onCloseFollowUp(); }
    else { setExpanded(true); requestAnimationFrame(() => article.current?.scrollIntoView({ block: 'start' })); }
  }
  const canFollowUp = !session.isRemote && canContinueSessionViaTerminalPrompt(session);
  // Local hook sessions cannot submit legacy plan choices through WorkIsland.
  // Reuse the native external-approval card to preview the plan and return to its Agent.
  const actionable = session.planConfirmation ? {
    ...session,
    phase: 'waitingForApproval',
    permissionRequest: { toolName: t('plan.awaitingConfirmation'), toolInput: session.planConfirmation.plan || '', approvalMode: 'terminalNative' }
  } : session;
  return React.createElement('article', { ref: article, className: `session-row-container atoll-session${showDetails ? ' is-expanded' : ''}${pending ? ' needs-attention' : ''}` },
    React.createElement(SessionRow, {
      session, isActive: false, isFollowUpOpen: followUpOpen,
      onClick: toggle,
      onFollowUpClick: canFollowUp ? onFollowUp : undefined
    }),
    React.createElement('button', { className: 'atoll-card-toggle', type: 'button', 'aria-expanded': showDetails, 'aria-label': showDetails ? t('common.collapse') : label, onClick: toggle },
      pending && !showDetails && React.createElement('span', null, label), React.createElement(Icon, { name: showDetails ? 'up' : 'down' })),
    React.createElement('div', { className: 'atoll-session-details', hidden: !showDetails },
      !session.isRemote && React.createElement('button', { className: 'atoll-jump', onClick: () => window.islandBridge.jumpToSession(session.id) }, t('atoll.openAgent')),
      session.activeSubagents?.length > 0 && React.createElement(SubagentList, { subagents: session.activeSubagents }),
      React.createElement('div', { className: 'session-action-area' },
        renderActionableCard({ session: actionable, actionableId: session.id, isFollowUpOpen: followUpOpen, onCollapse: () => setExpanded(false), onFollowUpClick: canFollowUp ? onFollowUp : undefined }),
        followUpOpen && React.createElement(ContinuePromptInput, { session, onCancel: onCloseFollowUp, onSubmitted: onCloseFollowUp }))));
}

function AgentMonitor() {
  const [, localeChanged] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => onLocaleChange(() => localeChanged()), []);
  const [data, setData] = React.useState({ sessions: [], quotas: {} });
  const [view, setView] = React.useState('agents');
  const [connectionError, setConnectionError] = React.useState(false);
  const [actionError, setActionError] = React.useState(null);
  const [followUpId, setFollowUpId] = React.useState(null);
  const monitor = React.useRef(null);
  function scrollPage(direction) {
    const scroller = monitor.current?.querySelector('.atoll-content:not([hidden])');
    scroller?.scrollBy({ top: direction * 100, behavior: 'instant' });
  }
  React.useEffect(() => {
    let active = true, busy = false;
    async function refresh() {
      if (busy) return;
      busy = true;
      try {
        const next = await request('state');
        if (active) { updateBridge(next); setData(next); setConnectionError(false); }
      } catch (e) { if (active) setConnectionError(true); }
      finally { busy = false; }
    }
    const fail = e => { console.warn('[Atoll action]', e.detail); setActionError({ at: Date.now() }); };
    window.addEventListener('atoll-error', fail);
    refresh();
    const timer = setInterval(refresh, 1500);
    return () => { active = false; clearInterval(timer); window.removeEventListener('atoll-error', fail); };
  }, []);
  React.useEffect(() => {
    if (followUpId && !data.sessions.some(s => s.id === followUpId && !s.isRemote && canContinueSessionViaTerminalPrompt(s))) setFollowUpId(null);
  }, [data.sessions, followUpId]);
  React.useEffect(() => {
    if (!actionError) return;
    const timer = setTimeout(() => setActionError(null), 6000);
    return () => clearTimeout(timer);
  }, [actionError]);
  const sessions = sortVisibleSessions(data.sessions || []);
  return React.createElement('main', { className: 'atoll-monitor', ref: monitor },
    React.createElement('header', { className: 'atoll-toolbar' },
      React.createElement('button', { 'data-view':'agents', className: view === 'agents' ? 'selected' : '', onClick: () => setView('agents') }, `${t('atoll.agents')} ${sessions.length}`),
      React.createElement('button', { className: 'atoll-expand-native', onClick: () => window.islandBridge.openAgentPanel().catch(() => {}) }, t('atoll.expandNative')),
      React.createElement('button', { 'data-view':'usage', className: view === 'usage' ? 'selected' : '', onClick: () => setView('usage') }, t('atoll.usage')),
      React.createElement('div', { className: 'atoll-quotas' }, ...['codex', 'claude'].map(tool => React.createElement(Quota, { key: tool, tool, quota: data.quotas?.[tool] }))),
      ...['up', 'down'].map((name, i) => React.createElement('button', { key: name, className: 'atoll-page', title: t(i ? 'atoll.pageDown' : 'atoll.pageUp'), 'aria-label': t(i ? 'atoll.pageDown' : 'atoll.pageUp'), onClick: () => scrollPage(i ? 1 : -1) }, React.createElement(Icon, { name }))),
      React.createElement('button', { title: t('settings.atoll.title'), 'aria-label': t('settings.atoll.title'), onClick: () => window.islandBridge.openSettings() }, React.createElement(Icon, { name: 'settings' }))),
    (connectionError || actionError) && React.createElement('p', { role: 'status', className: 'atoll-error' }, t(connectionError ? 'atoll.loadFailed' : 'atoll.actionFailed')),
    React.createElement('section', { className: 'atoll-content', hidden: view !== 'agents', tabIndex: 0, 'aria-label': t('atoll.agents') },
      React.createElement('div', { className: 'session-list' }, sessions.length ? sessions.map(session => React.createElement(SessionCard, {
        key: session.id, session, initiallyExpanded: sessions.length === 1, followUpOpen: followUpId === session.id,
        onFollowUp: () => setFollowUpId(session.id), onCloseFollowUp: () => setFollowUpId(null)
      })) : React.createElement('p', { className: 'atoll-empty' }, t('session.empty')))),
    view === 'usage' && React.createElement('section', { className: 'atoll-content', tabIndex: 0, 'aria-label': t('atoll.usage') }, React.createElement(UsagePanel, { allowDataManagement: false })));
}

ReactDOM.createRoot(document.getElementById('root'), { onUncaughtError: error => {
  document.getElementById('root').textContent = error.message;
  console.error(error.stack || error.message);
} }).render(React.createElement(AgentMonitor));
