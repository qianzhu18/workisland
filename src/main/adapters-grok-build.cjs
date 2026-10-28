'use strict';
const path = require('node:path');
const {normalizeGrokPayload} = require('./grok-build-payload.cjs');
const ACK = {type:'acknowledged'};
class GrokBuildAdapter {
  agentId = 'grok-build';
  sessions = new Map();
  handleHook(clientId, raw, ctx) {
    const p = normalizeGrokPayload(raw), id = p.session_id, event = p.hook_event_name;
    if (!id || !event || p.subagentType || p.subagent_type) {ctx.sendResponse(clientId,ACK);return;}
    const base = {sessionId:id,tool:this.agentId,timestamp:Date.now()};
    const jump = () => ctx.updateJumpTarget(id,this.agentId,{terminal_app:p.terminal_app,terminal_tty:p.terminal_tty,terminal_session_id:p.terminal_session_id,warp_pane_uuid:p.warp_pane_uuid,cwd:p.cwd,pid:p.pid,tmux_target:p.tmux_target});
    const clear = () => ctx.clearStalePendingInteraction?.(id,true);
    const start = (prompt) => {
      const known = this.sessions.get(id);
      if (!known || prompt !== undefined) {
        const latest = typeof prompt === 'string' ? prompt.slice(0,120) : known?.prompt;
        this.sessions.delete(id);this.sessions.set(id,{prompt:latest});
        if (this.sessions.size>256)this.sessions.delete(this.sessions.keys().next().value);
        ctx.emitEvent({...base,type:'sessionStarted',title:path.basename(p.cwd||'Grok Build'),latestUserPrompt:latest});
      }
      jump();
    };
    if(event==='SessionStart'){jump();ctx.sendResponse(clientId,ACK);return;}
    if(event==='UserPromptSubmit'){
      clear();start(typeof p.prompt==='string'?p.prompt:'');ctx.emitEvent({...base,type:'activityUpdated',activity:'Thinking...',latestUserPrompt:this.sessions.get(id)?.prompt});
    }else if(event==='PreToolUse'){
      clear();start();ctx.emitEvent({...base,type:'activityUpdated',activity:p.tool_name||'Running tool'});ctx.emitEvent({...base,type:'toolUseStarted',toolName:p.tool_name,activity:p.tool_name||'Running tool'});
    }else if(event==='PostToolUse'||event==='PostToolUseFailure'){
      clear();start();ctx.emitEvent({...base,type:'toolUseCompleted'});ctx.emitEvent({...base,type:'activityUpdated',activity:event==='PostToolUseFailure'?'Tool failed; Grok is continuing':'Thinking...'});
    }else if(event==='Notification'&&p.notification_type==='permission_prompt'){
      start();ctx.emitEvent({...base,type:'permissionRequested',permissionRequest:{id:`grok-native-${id}-${base.timestamp}`,sessionId:id,toolName:p.tool_name||'Grok Build',toolInput:typeof p.message==='string'?p.message.slice(0,300):'Confirm in Grok Build',riskLevel:'medium',approvalMode:'terminalNative'}});
      ctx.setPendingPermission(id,clientId,this.agentId,{approvalMode:'terminalNative',disconnectPolicy:'preserveOnDisconnect',responseChannelClosedAt:Date.now()});
      ctx.playSoundEvent?.('approvalNeeded');
    }else if(event==='PermissionDenied'){
      clear();ctx.emitEvent({...base,type:'activityUpdated',activity:'Permission denied in Grok Build'});
    }else if(['Stop','StopFailure','StopCancelled','SessionEnd'].includes(event)){
      // Grok also emits an observe-only Stop during session teardown.
      if(event==='Stop'&&p.reason&&p.reason!=='end_turn'){ctx.sendResponse(clientId,ACK);return;}
      clear();ctx.emitEvent({...base,type:'sessionCompleted',isSessionEnd:event==='SessionEnd',isInterrupt:event==='StopCancelled',latestUserPrompt:this.sessions.get(id)?.prompt,...(event==='StopFailure'?{error:p.errorType||p.error||'Grok request failed'}:{}),lastAssistantMessage:typeof p.lastAssistantMessage==='string'?p.lastAssistantMessage.slice(0,2000):undefined});
      if(event==='SessionEnd')this.sessions.delete(id);
    }
    // Empty stdout / ACK: this observer never issues allow/deny/block decisions.
    ctx.sendResponse(clientId,ACK);
  }
  isBlockingEvent(){return false;}
}
module.exports = {GrokBuildAdapter};
