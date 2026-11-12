import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const {AtollClient}=require('../src/main/atoll-client.cjs');
class FakeSocket extends EventTarget{
 static calls=[];static instances=[];
 constructor(){super();this.readyState=0;FakeSocket.instances.push(this);queueMicrotask(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));});}
 send(raw){const message=JSON.parse(raw);FakeSocket.calls.push(message);const result=message.method.includes('Authorization')?{authorized:true}:{success:true};queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({jsonrpc:'2.0',id:message.id,result})})));}
 close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
 notify(method,params){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({jsonrpc:'2.0',method,params})}));}
}
const wait=()=>new Promise(r=>setTimeout(r,25));
test('authorizes and presents stable tab, coalesces unchanged snapshots, dismisses on shutdown',async()=>{
 FakeSocket.calls=[];const c=new AtollClient({baseURL:'http://127.0.0.1:1234',token:'a',WebSocketImpl:FakeSocket,updateDelay:1});c.start();await wait();assert.equal(c.getStatus().state,'ready');
 c.setSnapshot({sessions:[{id:'1',phase:'running'}]});await wait();c.setSnapshot({sessions:[{id:'1',phase:'running'}]});await wait();
 // The compact host launcher is stable. Session changes update its live activity
 // and local panel data without reloading the host WebView.
 assert.equal(FakeSocket.calls.filter(x=>x.method==='atoll.presentNotchExperience').length,1);assert.equal(FakeSocket.calls.filter(x=>x.method==='atoll.updateNotchExperience').length,0);assert.equal(FakeSocket.calls.filter(x=>x.method==='atoll.presentLiveActivity').length,1);
 c.setSnapshot({sessions:Array.from({length:5},(_,id)=>({id:String(id),phase:'running'}))});await wait();
 assert.equal(FakeSocket.calls.filter(x=>x.method==='atoll.updateNotchExperience').length,0);await c.stop();assert.ok(FakeSocket.calls.some(x=>x.method==='atoll.dismissNotchExperience'));
});
test('host dismissal is respected until explicit resume',async()=>{
 FakeSocket.calls=[];const c=new AtollClient({baseURL:'http://127.0.0.1:1234',token:'a',WebSocketImpl:FakeSocket,updateDelay:1});c.start();await wait();FakeSocket.instances.at(-1).notify('atoll.notchExperienceDidDismiss',{experienceID:'workisland-agents'});c.setSnapshot({sessions:[{phase:'running'}]});await wait();assert.equal(c.getStatus().state,'dismissed');assert.equal(FakeSocket.calls.filter(x=>x.method==='atoll.presentNotchExperience').length,1);await c.stop();
});
test('authorization revocation never auto requests authorization again',async()=>{
 FakeSocket.calls=[];const c=new AtollClient({baseURL:'http://127.0.0.1:1234',token:'a',WebSocketImpl:FakeSocket,updateDelay:1});c.start();await wait();FakeSocket.instances.at(-1).notify('atoll.authorizationDidChange',{isAuthorized:false});c.setSnapshot({sessions:[{phase:'running'}]});await wait();assert.equal(c.getStatus().state,'revoked');assert.equal(FakeSocket.calls.filter(x=>x.method==='atoll.requestAuthorization').length,0);await c.stop();
});
test('action-required events request a fresh peek once per request without reloading the tab',async()=>{
 FakeSocket.calls=[];const c=new AtollClient({baseURL:'http://127.0.0.1:1234',token:'a',WebSocketImpl:FakeSocket,updateDelay:1});
 c.setSnapshot({settings:{locale:'en'},sessions:[{id:'1',tool:'claude',phase:'running'}]});c.start();await wait();
 c.setSnapshot({settings:{locale:'en'},sessions:[{id:'1',tool:'claude',phase:'waitingForApproval',permissionRequest:{id:'req-1'}}]});
 const event={sessionId:'1',type:'permissionRequested'};const request={priority:'action-required'};
 c.notifyEvent(event,request);await wait();
 let peeks=FakeSocket.calls.filter(x=>x.method==='atoll.presentLiveActivity');assert.equal(peeks.length,2);
 assert.equal(peeks.at(-1).params.descriptor.sneakPeekConfig.showOnUpdate,true);assert.match(peeks.at(-1).params.descriptor.sneakPeekSubtitle,/approval/i);
 assert.equal(c.getStatus().lastReminder.priority,'action-required');
 c.notifyEvent(event,request);c.setSnapshot({...c.snapshot});await wait();assert.equal(FakeSocket.calls.filter(x=>x.method==='atoll.presentLiveActivity').length,2);
 c.setSnapshot({settings:{locale:'en'},sessions:[{id:'1',tool:'claude',phase:'waitingForApproval',permissionRequest:{id:'req-2'}}]});c.notifyEvent(event,request);await wait();
 peeks=FakeSocket.calls.filter(x=>x.method==='atoll.presentLiveActivity');assert.equal(peeks.length,3);
 assert.equal(FakeSocket.calls.filter(x=>x.method==='atoll.presentNotchExperience').length,1);
 FakeSocket.instances.at(-1).notify('atoll.activityDidDismiss',{activityID:'workisland-agents-status'});
 c.notifyEvent({sessionId:'1',type:'questionAsked'},{priority:'action-required'});await wait();assert.equal(FakeSocket.calls.filter(x=>x.method==='atoll.presentLiveActivity').length,3);
 await c.stop();
});
test('the host peek carries the actual outcome and task separately in both locales',()=>{
 const {buildNotification}=require('../src/main/atoll-presentation.cjs');
 for(const locale of ['en','zh-CN']){
 const session={id:'a',tool:'codex',title:'repo',latestUserPrompt:'Count 18 × 7',lastAssistantMessage:'126 items'};
 const snap={sessions:[session],settings:{locale}};
 const done=buildNotification({type:'sessionCompleted',sessionId:'a'},{priority:'completion'},snap);
 assert.match(done.title,/126 items/);assert.equal(done.subtitle,'Count 18 × 7');
 session.errorDetail='File was not found';
 assert.match(buildNotification({type:'sessionCompleted',sessionId:'a'},{priority:'error'},snap).title,/File was not found/);
 }
});
