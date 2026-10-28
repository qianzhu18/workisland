'use strict';
const path = require('node:path');
const EVENTS = Object.freeze({ SessionStart: 'SessionStart', agentSpawn: 'SessionStart', sessionStart: 'SessionStart', UserPromptSubmit: 'UserPromptSubmit', userPromptSubmit: 'UserPromptSubmit', promptSubmit: 'UserPromptSubmit', PreToolUse: 'PreToolUse', preToolUse: 'PreToolUse', PostToolUse: 'PostToolUse', postToolUse: 'PostToolUse', Stop: 'Stop', stop: 'Stop', agentStop: 'Stop', SessionEnd: 'SessionEnd', sessionEnd: 'SessionEnd' });
// Input is ps comm, not command: shell text mentioning kiro-cli is not identity.
function detectKiroParentContext(raw, startPid) {
  const entries = new Map();
  for (const line of String(raw).split('\n')) { const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/); if (m) entries.set(+m[1], { parent: +m[2], executable: m[3] }); }
  const seen = new Set(); let pid = Number(startPid), cli;
  while (pid > 1 && !seen.has(pid) && seen.size < 32) {
    seen.add(pid); const e = entries.get(pid); if (!e) break;
    if (!cli && ['kiro-cli', 'kiro-cli-chat', 'kiro-cli-chat-v3'].includes(path.basename(e.executable))) cli = { surface: 'cli', pid };
    if (/\/Kiro\.app\/Contents\//i.test(e.executable)) return cli ? { ...cli, hostApp: 'Kiro' } : { surface: 'ide', pid };
    pid = e.parent;
  }
  return cli || {};
}
function normalizeKiroPayload(value, context = {}) {
  const p = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
  p.hook_event_name = EVENTS[p.hook_event_name || p.event_type];
  const nativeId = [p.session_id, p.sessionId, p.conversation_id].find(v => typeof v === 'string' && v.trim() && v.length <= 256);
  const surface = context.surface || p.kiro_surface || (String(p.terminal_app).toLowerCase() === 'kiro' ? 'ide' : undefined);
  const pid = context.pid || p.kiro_agent_pid;
  if (surface) p.kiro_surface = surface;
  if (context.hostApp) p.terminal_app = context.hostApp;
  if (Number.isSafeInteger(pid) && pid > 1) { p.kiro_agent_pid = pid; p.pid = pid; }
  p.session_id = nativeId?.trim() || (surface === 'cli' && Number.isSafeInteger(pid) && pid > 1 ? `kiro-cli-pid-${pid}` : undefined);
  if (surface === 'ide') { p.terminal_app = 'Kiro'; delete p.terminal_tty; delete p.terminal_session_id; }
  return p;
}
module.exports = { normalizeKiroPayload, detectKiroParentContext };
