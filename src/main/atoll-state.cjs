"use strict";
const {i18n}=require("./i18n.cjs");
const {isAllowedExternalUrl}=require('./external-url-policy.cjs');
const usageCache=new WeakMap();
function invalidateUsage(c){usageCache.delete(c)}
function usageSnapshot(c){const cached=usageCache.get(c);if(cached&&cached.expires>Date.now())return cached.value;const value=c.getUsageSummary?.(7)||null;usageCache.set(c,{expires:Date.now()+30000,value});return value}
const SESSION_FIELDS=['id','tool','isHookManaged','isProcessAlive','isSessionEnded','parentSessionId','phase','createdAt','startedAt','turnStartedAt','updatedAt','title','currentActivity','latestUserPrompt','lastAssistantMessage','activeSubagents','permissionRequest','questionPrompt','planConfirmation','isRemote','remoteHostName','error','errorDetail','jumpTarget','completionDismissed'];
function snapshot(c){
 const settings=c.getSettings?.()||{};
 return {sessions:(c.getSessions?.()||[]).map(s=>Object.fromEntries(SESSION_FIELDS.filter(k=>s[k]!==undefined).map(k=>[k,s[k]]))),quotas:c.getQuotaMap?.()||{},usage:usageSnapshot(c),settings:{locale:i18n.getLocale(),languagePreference:settings.languagePreference,shortcuts:settings.shortcuts,pillFirstRow:settings.pillFirstRow},connection:c.atollIntegration?.getStatus?.()||{state:'starting'}};
}
async function dispatchAction(c,action,p={}, {openExternal}={}){
 if(action==='openAgentPanel')return c.atollPanel.open();
 if(action==='openSettings')return c.openSettingsTab?.('agents');
 if(action==='openExternal'){
  if(!isAllowedExternalUrl(p.url)||!openExternal)throw Error('External link unavailable');
  return openExternal(p.url);
 }
 const s=c.getSessions?.().find(s=>s.id===p.sessionId);
 if(!s)throw Error('Session unavailable');
 // Deleting an observed remote card only removes the local record.
 if(action==='delete')return c.deleteSession(s.id);
 if(s.isRemote)throw Error('Session unavailable');
 if(['approve','deny'].includes(action)){
  if(s.phase!=='waitingForApproval'||!s.permissionRequest||s.permissionRequest.approvalMode==='terminalNative'||(s.permissionRequest.id&&p.requestId!==s.permissionRequest.id))throw Error('Approval is no longer actionable');
  if(action==='deny')return c.denySession(s.id);
  if(!['allowOnce','allowAlways'].includes(p.choice||p.action))throw Error('Invalid approval action');
  return c.approveSession(s.id,p.choice||p.action);
 }
 if(action==='answer'||action==='cancelQuestion'){
  if(s.phase!=='waitingForAnswer'||!s.questionPrompt||s.questionPrompt.desktopOnly||(s.questionPrompt.id&&p.questionId!==s.questionPrompt.id))throw Error('Question is no longer actionable');
  if(action==='answer')return c.answerSession(s.id,p.answer);
  return c.cancelQuestion(s.id,{});
 }
 if(action==='jump')return c.jumpToSession(s.id);
 if(action==='continue'){
  const text=typeof p.text==='string'?p.text.trim():'';
  if(s.phase!=='completed'||!text||text.length>32768)throw Error('Follow-up is no longer available');
  return c.continueSessionViaTerminalPrompt(s.id,text,{source:'atoll'});
 }
 throw Error('Unsupported action');
}
module.exports={snapshot,dispatchAction,invalidateUsage};
