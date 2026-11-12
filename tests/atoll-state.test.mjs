import {sortVisibleSessions} from '../src/renderer/island/session-model.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {snapshot,dispatchAction,invalidateUsage}=require('../src/main/atoll-state.cjs');
const session={id:'one',tool:'claude',phase:'waitingForApproval',permissionRequest:{id:'p1',toolName:'Write',approvalMode:'bridge'},latestUserPrompt:'task',privateCredential:'never send'};
function fake(){return {getSessions:()=>[session],getQuotaMap:()=>({codex:{daily:{usedPct:20,total:'5h'}}}),getUsageSummary:()=>({totals:{inputTokens:12}}),getSettings:()=>({languagePreference:'en'}),approveSession:async(id,action)=>({id,action})}}
test('one coordinator supplies sessions, quotas and usage without private internals',()=>{const s=snapshot(fake());assert.equal(s.sessions[0].id,'one');assert.equal(s.sessions[0].privateCredential,undefined);assert.equal(s.quotas.codex.daily.usedPct,20);assert.equal(s.usage.totals.inputTokens,12)});
test('the explicit expand action opens the shared native panel without inventing a session',async()=>{
 let opens=0;const c={atollPanel:{open:()=>{opens++;return {opened:true}}}};
 assert.deepEqual(await dispatchAction(c,'openAgentPanel'),{opened:true});assert.equal(opens,1);
});
test('actions require a current actionable request and never bridge remote or native approvals',async()=>{const c=fake();assert.deepEqual(await dispatchAction(c,'approve',{sessionId:'one',requestId:'p1',action:'allowOnce'}),{id:'one',action:'allowOnce'});await assert.rejects(dispatchAction(c,'approve',{sessionId:'one',requestId:'old',action:'allowOnce'}));await assert.rejects(dispatchAction(c,'approve',{sessionId:'gone',action:'allowOnce'}));await assert.rejects(dispatchAction(c,'execute',{command:'bad'}));await assert.rejects(dispatchAction({...c,getSessions:()=>[{...session,isRemote:true}]},'approve',{sessionId:'one',requestId:'p1',action:'allowOnce'}));});

test('regular session refreshes reuse usage totals until the shared stats source changes',()=>{let reads=0;const c={getSessions:()=>[],getUsageSummary:()=>({read:++reads})};assert.equal(snapshot(c).usage.read,1);assert.equal(snapshot(c).usage.read,1);invalidateUsage(c);assert.equal(snapshot(c).usage.read,2)});

test('serialized active sessions remain visible to the shared native session filter',()=>{const c={getSessions:()=>[{id:'hook',tool:'codex',phase:'running',isHookManaged:true,latestUserPrompt:'Task',updatedAt:1},{id:'process',tool:'claude',phase:'running',isProcessAlive:true,updatedAt:2}]};assert.deepEqual(sortVisibleSessions(snapshot(c).sessions).map(s=>s.id),['process','hook'])});

test('a stale question cannot submit an answer to the next question',async()=>{
 let answers=0;
 const c={getSessions:()=>[{id:'s',phase:'waitingForAnswer',questionPrompt:{id:'new'}}],answerSession:async()=>{answers++}};
 await assert.rejects(dispatchAction(c,'answer',{sessionId:'s',questionId:'old',answer:'stale'}));
 await dispatchAction(c,'answer',{sessionId:'s',questionId:'new',answer:'current'});
 assert.equal(answers,1);
});

test('follow-up prompts use the existing completed-session channel and reject invalid targets',async()=>{
 const s={id:'done',tool:'claude',phase:'completed',jumpTarget:{app:'Terminal',tty:'/dev/ttys001'}};
 const calls=[];const c={getSessions:()=>[s],continueSessionViaTerminalPrompt:async(...args)=>{calls.push(args);return {ok:true}}};
 assert.deepEqual(await dispatchAction(c,'continue',{sessionId:'done',text:'  review the fix  '}),{ok:true});
 assert.deepEqual(calls,[['done','review the fix',{source:'atoll'}]]);
 await assert.rejects(dispatchAction(c,'continue',{sessionId:'done',text:''}));
 await assert.rejects(dispatchAction({...c,getSessions:()=>[{...s,phase:'running'}]},'continue',{sessionId:'done',text:'next'}));
 await assert.rejects(dispatchAction({...c,getSessions:()=>[{...s,isRemote:true}]},'continue',{sessionId:'done',text:'next'}));
});

test('links reuse WorkIsland external URL policy without permitting command or file URLs',async()=>{
 const opened=[];const options={openExternal:async url=>opened.push(url)};
 await dispatchAction({},'openExternal',{url:'https://workisland.ai'},options);
 assert.deepEqual(opened,['https://workisland.ai']);
 for(const url of ['file:///etc/passwd','javascript:alert(1)','some-app://run'])await assert.rejects(dispatchAction({},'openExternal',{url},options));
});
