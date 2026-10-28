'use strict';
const path = require('node:path');
const EVENTS = Object.freeze({ session_start:'SessionStart', user_prompt_submit:'UserPromptSubmit', pre_tool_use:'PreToolUse', post_tool_use:'PostToolUse', post_tool_use_failure:'PostToolUseFailure', stop:'Stop', stop_failure:'StopFailure', stop_cancelled:'StopCancelled', notification:'Notification', permission_denied:'PermissionDenied', session_end:'SessionEnd' });
const CANONICAL = new Set(Object.values(EVENTS));
const text = value => typeof value === 'string' && value.trim() && value.length <= 256 ? value.trim() : undefined;
function isGrokHookEnvironment(env = process.env) { return Boolean(text(env.GROK_SESSION_ID) && (EVENTS[env.GROK_HOOK_EVENT] || CANONICAL.has(env.GROK_HOOK_EVENT))); }
function normalizeGrokPayload(value, env = {}) {
  const p = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
  const event = p.hook_event_name || p.hookEventName || env.GROK_HOOK_EVENT;
  p.hook_event_name = CANONICAL.has(event) ? event : EVENTS[event];
  p.session_id = text(p.sessionId) || text(p.session_id) || (isGrokHookEnvironment(env) ? text(env.GROK_SESSION_ID) : undefined);
  p.cwd = p.cwd || p.workspaceRoot || env.GROK_WORKSPACE_ROOT;
  p.tool_name = p.toolName || p.tool_name;
  p.notification_type = p.notificationType || p.notification_type;
  p.turn_id = p.promptId || p.turn_id;
  return p;
}
// Input is `ps ... comm`, not a command line containing arbitrary shell text.
function findGrokProcess(raw, startPid) {
  const entries = new Map();
  for (const line of String(raw).split('\n')) { const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/); if (m) entries.set(+m[1], {parent:+m[2],tty:m[3],executable:m[4]}); }
  const seen = new Set(); let pid = Number(startPid);
  while (pid > 1 && !seen.has(pid) && seen.size < 32) {
    seen.add(pid); const entry = entries.get(pid); if (!entry) break;
    if (['grok','xai-grok-pager'].includes(path.basename(entry.executable))) return {pid, ...(/^tty[a-z0-9]+$/i.test(entry.tty) ? {tty:`/dev/${entry.tty}`} : {})};
    pid = entry.parent;
  }
  return {};
}
function isGrokCompatibilityInvocation(source,payload,env=process.env){
  if(source==='grok-build'||!isGrokHookEnvironment(env))return false;
  const id=text(payload?.sessionId)||text(payload?.session_id)||text(payload?.conversation_id);
  return !id||id===env.GROK_SESSION_ID;
}
module.exports = {normalizeGrokPayload,isGrokHookEnvironment,findGrokProcess,isGrokCompatibilityInvocation};
