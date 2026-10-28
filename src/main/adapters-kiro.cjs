'use strict';
const path = require('node:path');
const { normalizeKiroPayload } = require('./kiro-payload.cjs');
const ACK = { type: 'acknowledged' };
class KiroAdapter {
  agentId = 'kiro';
  prompts = new Map();
  handleHook(clientId, raw, ctx) {
    const p = normalizeKiroPayload(raw), sessionId = p.session_id, event = p.hook_event_name;
    if (!sessionId || !event) { ctx.sendResponse(clientId, ACK); return; }
    const base = { sessionId, tool: this.agentId, timestamp: Date.now() };
    const jump = () => ctx.updateJumpTarget(sessionId, this.agentId, { terminal_app: p.terminal_app, terminal_tty: p.terminal_tty, terminal_session_id: p.terminal_session_id, warp_pane_uuid: p.warp_pane_uuid, tmux_target: p.tmux_target, cwd: p.cwd, pid: p.pid });
    if (event === 'SessionStart') { jump(); ctx.sendResponse(clientId, ACK); return; }
    if (event === 'UserPromptSubmit') {
      const prompt = typeof p.prompt === 'string' ? p.prompt.slice(0, 1000) : '';
      this.prompts.delete(sessionId); this.prompts.set(sessionId, prompt);
      if (this.prompts.size > 256) this.prompts.delete(this.prompts.keys().next().value);
      ctx.emitEvent({ ...base, type: 'sessionStarted', title: path.basename(p.cwd || 'Kiro'), latestUserPrompt: prompt.slice(0, 120) }); jump();
      ctx.emitEvent({ ...base, type: 'activityUpdated', activity: 'Thinking...', latestUserPrompt: prompt.slice(0, 120) });
    } else if (event === 'PreToolUse') {
      // A tool hook observes activity; it must not grant or deny native permission.
      ctx.emitEvent({ ...base, type: 'toolUseStarted', activity: typeof p.tool_name === 'string' ? p.tool_name.slice(0, 160) : 'Running tool' }); jump();
    } else if (event === 'PostToolUse') {
      ctx.emitEvent({ ...base, type: 'activityUpdated', activity: 'Thinking...' });
    } else if (event === 'Stop' || event === 'SessionEnd') {
      ctx.emitEvent({ ...base, type: 'sessionCompleted', latestUserPrompt: this.prompts.get(sessionId)?.slice(0, 120), isSessionEnd: event === 'SessionEnd' });
      if (event === 'SessionEnd') this.prompts.delete(sessionId);
    }
    ctx.sendResponse(clientId, ACK);
  }
  isBlockingEvent() { return false; }
}
module.exports = { KiroAdapter };
