"use strict";
const fs=require('node:fs'),path=require('node:path');
const BUNDLE_ID='app.workisland.desktop',EXPERIENCE_ID='workisland-agents',ACTIVITY_ID='workisland-agents-status';
const icon=fs.readFileSync(path.join(__dirname,'../renderer/atoll/workisland-icon.png'));
const accent={red:.43,green:.62,blue:1,alpha:1};
function counts(snapshot){const sessions=snapshot?.sessions||[];return {running:sessions.filter(s=>s.phase==='running').length,attention:sessions.filter(s=>['waitingForApproval','waitingForAnswer'].includes(s.phase)).length,done:sessions.filter(s=>s.phase==='completed').length}}
function buildDescriptor(snapshot,baseURL,token){
 const config=JSON.stringify({baseURL,token}).replaceAll('<','\\u003c');
 const html=fs.readFileSync(path.join(__dirname,'../renderer/atoll/index.html'),'utf8').replace('<!--CONFIG-->',`<base href="${baseURL}/renderer/atoll/"><script>window.ATOLL_CONFIG=${config}</script>`);
 return {id:EXPERIENCE_ID,bundleIdentifier:BUNDLE_ID,priority:'normal',accentColor:accent,metadata:{source:'WorkIsland'},tab:{title:'WorkIsland',iconSymbolName:'link',badgeIcon:{type:'image',data:icon.toString('base64'),size:[20,20],cornerRadius:0},contentLayout:'contentOnly',preferredHeight:420,sections:[],allowWebInteraction:true,webContent:{html,preferredHeight:340,isTransparent:true,allowLocalhostRequests:true,allowRemoteRequests:false,maximumContentWidth:640}}};
}
function buildLiveActivity(s){const {running,attention,done}=counts(s);if(!running&&!attention&&!done)return null;const zh=(s.settings?.locale||s.settings?.languagePreference)==='zh-CN';return {id:ACTIVITY_ID,bundleIdentifier:BUNDLE_ID,priority:attention?'high':'normal',title:zh?`${running} 运行 · ${attention} 待处理`:`${running} running · ${attention} attention`,leadingIcon:{type:'image',data:icon.toString('base64'),size:[18,18],cornerRadius:0},trailingContent:{type:'text',text:String(attention||running||done),font:{size:12,weight:'medium',design:'monospaced',isMonospacedDigit:true}},accentColor:accent,progress:0,allowsMusicCoexistence:true,sneakPeekConfig:{enabled:true,duration:2,style:'standard',showOnUpdate:false}}}
function excerpt(text,limit){
 if(typeof text!=='string')return '';
 const chars=Array.from(text.replace(/\s+/g,' ').trim());return chars.length>limit?chars.slice(0,limit-1).join('')+'…':chars.join('');
}
function buildNotification(event,request,snapshot){
 const session=snapshot.sessions?.find(s=>s.id===event.sessionId);if(!session||!request)return null;
 const zh=snapshot.settings?.locale==='zh-CN';
 const type=event.type==='permissionRequested'?'approval':event.type==='questionAsked'?'answer':request.priority;
 const copy={approval:['等待你的审批','Waiting for your approval'],answer:['等待你的回答','Waiting for your answer'],completion:['任务已完成','Task completed'],error:['任务遇到错误','Task failed'],submission:['任务已开始','Task started']}[type];if(!copy)return null;
 const identity=type==='approval'?session.permissionRequest?.id:type==='answer'?(session.questionPrompt?.id||session.planConfirmation?.id):session.turnStartedAt||event.timestamp||event.latestUserPrompt;
 const key=JSON.stringify([session.id,type,identity||session.updatedAt||session.createdAt]);
 const agent={claude:'Claude Code',codex:'Codex'}[session.tool]||session.tool||'Agent';
 const task=excerpt(session.latestUserPrompt || event.latestUserPrompt || session.title,36);
 if(type==='completion'||type==='error'){
  const result=excerpt(type==='error'?(session.errorDetail || event.error?.message || session.error || event.error):(event.lastAssistantMessage || session.lastAssistantMessage || event.summary),72);
  return {key,priority:request.priority,title:agent+' · '+(result||copy[zh?0:1]),subtitle:task};
 }
 if(type==='submission'&&task)return {key,priority:request.priority,title:agent+' · '+copy[zh?0:1],subtitle:task};
 const detail=type==='answer'?session.questionPrompt?.questions?.[0]?.question:type==='approval'?session.permissionRequest?.toolName:'';
 return {key,priority:request.priority,title:`WorkIsland · ${agent}`,subtitle:detail?copy[zh?0:1]+(zh?'：':': ')+String(detail).replace(/\s+/g,' ').slice(0,72):copy[zh?0:1]};
}
module.exports={BUNDLE_ID,EXPERIENCE_ID,ACTIVITY_ID,buildDescriptor,buildLiveActivity,buildNotification};
