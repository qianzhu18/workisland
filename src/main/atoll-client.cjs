const {EventEmitter}=require('node:events');
const {BUNDLE_ID,EXPERIENCE_ID,ACTIVITY_ID,buildDescriptor,buildLiveActivity,buildNotification}=require('./atoll-presentation.cjs');

/** Official Atoll JSON-RPC transport. No host preference writes or injected code. */
class AtollClient extends EventEmitter {
 constructor({baseURL,token,endpoint='ws://127.0.0.1:9020',WebSocketImpl=globalThis.WebSocket,updateDelay=250,rpcTimeout=8000}={}){
  super();Object.assign(this,{baseURL,token,endpoint,WebSocketImpl,updateDelay,rpcTimeout});this.snapshot={sessions:[],integrations:[]};this.pending=new Map();this.sequence=0;this.status={state:'stopped',connected:false,authorized:false,message:'Not started'};this.retryDelay=1000;this.running=false;this.tabPresented=false;this.lastDescriptor='';this.activityPresented=false;this.lastActivity='';this.blocked=false;this.activityDismissed=false;this.initialAuthorizationAttempted=false;
 }
 canPresentAttention(){return this.running && this.tabPresented && !this.blocked && !this.activityDismissed && this.status.state==="ready";}
 getStatus(){return {...this.status};}
 setStatus(state,message,extra={}){const next={...this.status,state,message,...extra};if(JSON.stringify(next)!==JSON.stringify(this.status)){this.status=next;this.emit('status',this.getStatus());}}
 setBaseURL(baseURL,token=this.token){this.baseURL=baseURL;this.token=token;this.tabPresented=false;this.lastDescriptor='';this.scheduleUpdate();}
 start(){if(this.running)return;this.running=true;this.connect();}
 setSnapshot(snapshot){this.snapshot=snapshot||{sessions:[]};this.scheduleUpdate();}
 notifyEvent(event,request){
  if(!this.running||this.blocked||this.activityDismissed)return;
  const notice=buildNotification(event,request,this.snapshot);if(!notice)return;
  this.noticeKeys??=new Set();if(this.noticeKeys.has(notice.key))return;
  this.noticeKeys.add(notice.key);if(this.noticeKeys.size>256)this.noticeKeys.delete(this.noticeKeys.values().next().value);
  const rank={'action-required':3,error:2,completion:1,submission:0};
  if(!this.pendingNotice||(rank[notice.priority]??0)>=(rank[this.pendingNotice.priority]??0))this.pendingNotice=notice;
  this.scheduleUpdate();return true;
 }
 scheduleUpdate(){if(!this.running||this.blocked||this.updateTimer)return;this.updateTimer=setTimeout(()=>{this.updateTimer=null;this.flush().catch(error=>this.handleRPCError(error));},this.updateDelay);this.updateTimer.unref?.();}
 connect(){
  if(!this.running||this.blocked)return;
  this.setStatus('connecting','Connecting to Atoll on this Mac',{connected:false,authorized:false});
  let socket;try{socket=new this.WebSocketImpl(this.endpoint);}catch(e){this.disconnected(e.message);return;}this.socket=socket;
  socket.addEventListener('open',()=>{if(socket!==this.socket)return;this.retryDelay=1000;this.setStatus('authorizing','Checking Atoll extension authorization',{connected:true});this.authorize().catch(e=>this.handleRPCError(e));});
  socket.addEventListener('message',event=>{if(socket===this.socket)this.receive(event.data);});
  socket.addEventListener('close',()=>{if(socket===this.socket)this.disconnected('Atoll connection closed');});
  socket.addEventListener('error',()=>{if(socket===this.socket)this.setStatus('disconnected','Atoll is unavailable. Start Atoll and enable third-party extensions.',{connected:false,authorized:false});});
 }
 async authorize({explicit=false}={}){
  const check=await this.rpc('atoll.checkAuthorization',{bundleIdentifier:BUNDLE_ID});let authorized=check.authorized===true;
  if(!authorized&&(!this.initialAuthorizationAttempted||explicit)){this.initialAuthorizationAttempted=true;authorized=(await this.rpc('atoll.requestAuthorization',{bundleIdentifier:BUNDLE_ID})).authorized===true;}
  if(!authorized){this.blocked=true;this.setStatus('unauthorized','Allow Agents for Atoll in Settings → Extensions, then reconnect.',{authorized:false});return;}
  this.setStatus('ready','Connected to Atoll',{connected:true,authorized:true});await this.flush();
 }
 rpc(method,params={}){
  if(!this.socket||this.socket.readyState!==1)return Promise.reject(new Error('Atoll is not connected'));
  const id=String(++this.sequence);
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Atoll request timed out: '+method));},this.rpcTimeout);timer.unref?.();this.pending.set(id,{resolve,reject,timer});try{this.socket.send(JSON.stringify({jsonrpc:'2.0',id,method,params}));}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});
 }
 receive(raw){
  let message;try{message=JSON.parse(String(raw));}catch{return;}
  if(message.id!=null){const request=this.pending.get(String(message.id));if(!request)return;clearTimeout(request.timer);this.pending.delete(String(message.id));if(message.error){const e=new Error(message.error.message||'Atoll rejected the request');e.code=message.error.code;request.reject(e);}else request.resolve(message.result||{});return;}
  const p=message.params||{};if(p.bundleIdentifier&&p.bundleIdentifier!==BUNDLE_ID)return;
  if(message.method==='atoll.authorizationDidChange'&&p.isAuthorized===false){this.blocked=true;this.tabPresented=false;this.activityPresented=false;this.setStatus('revoked','Extension access was revoked in Atoll. Reconnect only when you want to enable it again.',{authorized:false});}
  if(message.method==='atoll.notchExperienceDidDismiss'&&p.experienceID===EXPERIENCE_ID){this.blocked=true;this.tabPresented=false;this.setStatus('dismissed','Agents tab dismissed. Use Reconnect to show it again.',{connected:true});}
  if(message.method==='atoll.activityDidDismiss'&&p.activityID===ACTIVITY_ID&&!this.internalActivityDismiss){this.activityPresented=false;this.activityDismissed=true;}
 }
 async flush(){
  if(this.flushing){this.dirty=true;return;}
  if(!this.running||this.blocked||!this.status.connected||!this.status.authorized||this.socket?.readyState!==1||!this.baseURL)return;
  this.flushing=true;
  try{
   const tabDescriptor=buildDescriptor(this.snapshot,this.baseURL,this.token),tabSerialized=JSON.stringify(tabDescriptor);
   if(!this.tabPresented){await this.rpc('atoll.presentNotchExperience',{descriptor:tabDescriptor});if(this.blocked)return;this.tabPresented=true;this.lastDescriptor=tabSerialized;}
   else if(tabSerialized!==this.lastDescriptor){await this.rpc('atoll.updateNotchExperience',{descriptor:tabDescriptor});if(this.blocked)return;this.lastDescriptor=tabSerialized;}
   if(this.activityDismissed)return;
   const activity=buildLiveActivity(this.snapshot),serialized=JSON.stringify(activity);
   const notice=this.pendingNotice;
   if(serialized===this.lastActivity&&!notice)return;
   if(activity){
    // Atoll's update RPC only replaces data. Presenting the same stable ID
    // with showOnUpdate requests a peek without creating a second activity.
    const descriptor=notice?{...activity,priority:notice.priority==='action-required'||notice.priority==='error'?'high':activity.priority,sneakPeekTitle:notice.title,sneakPeekSubtitle:notice.subtitle,sneakPeekConfig:{enabled:true,duration:4,style:'standard',showOnUpdate:true}}:activity;
    await this.rpc(notice?'atoll.presentLiveActivity':this.activityPresented?'atoll.updateLiveActivity':'atoll.presentLiveActivity',{descriptor});this.activityPresented=true;
    if(notice)this.setStatus('ready','Connected to Atoll',{lastReminder:{priority:notice.priority,acceptedAt:Date.now()}});
   }
   else if(this.activityPresented){this.internalActivityDismiss=true;try{await this.rpc('atoll.dismissLiveActivity',{bundleIdentifier:BUNDLE_ID,activityID:ACTIVITY_ID});this.activityPresented=false;}finally{this.internalActivityDismiss=false;}}
   this.lastActivity=serialized;
   if(this.pendingNotice===notice)this.pendingNotice=null;
  }finally{this.flushing=false;if(this.dirty){this.dirty=false;this.scheduleUpdate();}}
 }
 handleRPCError(error){
  if(!this.running)return;
  if(error.code===-32001||error.code===-32002||error.code===-32005){this.blocked=true;const state=error.code===-32001?'unauthorized':'disabled';this.setStatus(state,error.message+' Enable third-party extensions, notch tabs, interactive web content and live activities in Atoll Settings → Extensions.');}
  else this.setStatus('error',error.message);
  this.emit('diagnostic',{message:error.message,code:error.code});
 }
 disconnected(message){
  for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(new Error(message));}this.pending.clear();this.tabPresented=false;this.lastDescriptor='';this.activityPresented=false;this.lastActivity='';
  if(!this.running)return;
  this.setStatus('disconnected',message,{connected:false,authorized:false});
  if(this.running&&!this.blocked&&!this.reconnectTimer){this.reconnectTimer=setTimeout(()=>{this.reconnectTimer=null;this.connect();},this.retryDelay);this.reconnectTimer.unref?.();this.retryDelay=Math.min(this.retryDelay*2,15000);}
 }
 async resume(){this.blocked=false;this.activityDismissed=false;this.tabPresented=false;this.lastDescriptor='';this.lastActivity='';if(this.socket?.readyState===1){await this.authorize({explicit:true});}else{this.initialAuthorizationAttempted=false;this.connect();}}
 async stop(){
  if(!this.running)return;this.running=false;clearTimeout(this.updateTimer);clearTimeout(this.reconnectTimer);
  if(this.socket?.readyState===1){const requests=[];if(this.tabPresented)requests.push(this.rpc('atoll.dismissNotchExperience',{bundleIdentifier:BUNDLE_ID,experienceID:EXPERIENCE_ID}));if(this.activityPresented)requests.push(this.rpc('atoll.dismissLiveActivity',{bundleIdentifier:BUNDLE_ID,activityID:ACTIVITY_ID}));await Promise.allSettled(requests);}
  this.socket?.close();this.setStatus('stopped','Extension stopped',{connected:false,authorized:false});
 }
}

module.exports={AtollClient};
