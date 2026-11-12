import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {createAtollServer}=require('../src/main/atoll-web-server.cjs');
test('private Atoll surface authenticates actions, rejects stale repeats and serves shared UI',async t=>{
 let approvals=0;const c={getSessions:()=>[{id:'s',phase:'waitingForApproval',permissionRequest:{id:'p'}}],approveSession:async()=>{approvals++},getSettings:()=>({}),getQuotaMap:()=>({}),getUsageSummary:()=>({})};
 const server=await createAtollServer({coordinator:c});t.after(()=>server.close());const url=server.url;
 assert.equal((await fetch(url+'/api/state')).status,401);
 const state=await fetch(url+'/api/state?token='+server.token).then(r=>r.json());assert.equal(state.sessions.length,1);
 assert.equal((await fetch(url+'/renderer/atoll/app.js')).status,200);
 const send=()=>fetch(url+'/api/action?token='+server.token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'approve',sessionId:'s',requestId:'p',choice:'allowOnce'})});
 assert.equal((await send()).status,200);assert.equal((await send()).status,409);assert.equal(approvals,1);
});

test('shared Agent metadata and continuation results cross the authenticated browser surface',async t=>{
 const calls=[];
 const server=await createAtollServer({
  coordinator:{getSessions:()=>[{id:'done',phase:'completed'}],continueSessionViaTerminalPrompt:async(id,text)=>{calls.push([id,text]);return {ok:true}}},
  getAgentMeta:()=>[{tool:'plugin:review',label:'Review Agent',badgeColor:'#123456'}]
 });
 t.after(()=>server.close());
 const metadata=await fetch(server.url+'/api/agents?token='+server.token).then(r=>r.json());
 assert.equal(metadata[0].label,'Review Agent');
 const result=await fetch(server.url+'/api/action?token='+server.token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'continue',sessionId:'done',text:'next'})}).then(r=>r.json());
 assert.deepEqual(result,{success:true,result:{ok:true}});
 assert.deepEqual(calls,[['done','next']]);
});
