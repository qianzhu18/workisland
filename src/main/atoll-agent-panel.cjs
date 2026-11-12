"use strict";
const {IPC}=require('../shared/ipc.cjs');
const {usesAtoll}=require('./atoll-mode.cjs');

// Temporarily borrows the existing native Island. No second renderer or engine.
class AtollAgentPanel {
 constructor(coordinator,{getScreen,platform=process.platform}={}){Object.assign(this,{coordinator,getScreen,platform});this.active=false;}
 get isOpen(){return this.active&&!!this.window&&!this.window.isDestroyed();}
 openForAttention(session){
  const key = JSON.stringify([session.id,session.permissionRequest?.id ?? session.questionPrompt?.id ?? session.planConfirmation?.id ?? session.updatedAt]);
  if((this.isOpen && !this.resultNotice) || this.lastAttentionKey===key)return;
  this.open({attentionId:session.id});this.lastAttentionKey=key;
 }
 closeIfResolved(sessions){
  if(this.active && this.attentionId && !sessions.some(s=>s.id===this.attentionId && ['waitingForAnswer','waitingForApproval'].includes(s.phase)))this.close();
 }
 openForResult(request){
  // Never replace a manual view, an unanswered question or an active error.
  if(this.isOpen && (!this.resultNotice || !this.resultNotice.autoDismiss))return;
  this.open({resultNotice:request});
 }
 open({attentionId=null,resultNotice=null}={}){
  const c=this.coordinator,win=c.islandWindow,native=c.islandWin;
  if(!usesAtoll(c.getSettings(),this.platform))throw Error('Atoll display mode is not enabled');
  if(!win||win.isDestroyed()||!native||win.webContents.isLoadingMainFrame?.())throw Error('WorkIsland panel is not ready');
  if(!this.active){
   this.window=win;this.native=native;this.previousTarget=native.currentTarget;this.previousFullscreenHidden=native.isFullscreenHidden;
   const screen=this.getScreen?.();
   const clicked=screen?.getDisplayNearestPoint(screen.getCursorScreenPoint());
   const target=c.displayMgr?.getAllTargets().find(t=>t.display.id===clicked?.id);
   if(target)native.moveToDisplay(target);
   this.active=true;
   if(this.boundWindow!==win){this.boundWindow=win;win.once('closed',()=>{if(this.window===win){this.active=false;this.window=null;}});}
  }
  this.attentionId=attentionId;this.resultNotice=resultNotice;
  native.setFullscreenHidden(false);native.setFocusHidden(false);
  win.webContents.send(IPC.ATOLL_PANEL_MODE,true);
  c.broadcastSessionUpdate();
  win.webContents.send(IPC.ISLAND_PRESENT_SURFACE,resultNotice ? {surface:resultNotice.surface,reason:'notification',autoDismiss:resultNotice.autoDismiss} : {surface:{type:'sessionList',...(attentionId?{actionableSessionId:attentionId}:{})},reason:'click',autoDismiss:false});
  native.setOutputSuppressed(false);
  win.setIgnoreMouseEvents(false);if(attentionId || resultNotice)win.showInactive();else{win.show();win.focus();}
  return {opened:true};
 }
 handleCollapsed(sender){if(sender===this.window?.webContents)this.close();}
 close(){
  if(!this.active)return;
  this.active=false;
  const win=this.window,native=this.native;
  if(win&&!win.isDestroyed()){
   win.webContents.send(IPC.ATOLL_PANEL_MODE,false);
   win.webContents.send(IPC.ISLAND_COLLAPSE);
   native.setOutputSuppressed(usesAtoll(this.coordinator.getSettings(),this.platform));
   native.setFocusHidden(false);
   native.setFullscreenHidden(this.previousFullscreenHidden);
   const target=this.coordinator.displayMgr?.getCurrentTarget()||this.previousTarget;
   if(target)native.moveToDisplay(target);
  }
  this.coordinator.evaluateFullscreenVisibility?.();
 }
}
module.exports={AtollAgentPanel};
