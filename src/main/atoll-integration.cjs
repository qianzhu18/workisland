"use strict";
const {AtollClient}=require('./atoll-client.cjs');const {createAtollServer}=require('./atoll-web-server.cjs');const {snapshot,invalidateUsage}=require('./atoll-state.cjs');
class AtollIntegration{
 constructor(coordinator,{platform=process.platform,Client=AtollClient,serverFactory=createAtollServer}={}){Object.assign(this,{coordinator,platform,Client,serverFactory});this.status={state:'disabled'};this.queue=Promise.resolve();this.listeners=new Set();this.getLocaleState=undefined}
 getStatus(){const win=this.coordinator.islandWindow;return {...(this.client?.getStatus()||this.status),enabled:!!this.server,nativeIslandVisible:!!win&&!win.isDestroyed()&&win.isVisible(),nativePanelOpen:!!this.coordinator.atollPanel?.isOpen,hostCompatibility:'full-panel-unverified'}}
 subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn)}
 notify(){for(const fn of this.listeners)fn(this.getStatus())}
 sync(settings){this.queue=this.queue.then(async()=>{
  const wanted=this.platform==='darwin'&&settings.atollIntegrationEnabled===true&&settings.agentDisplayTarget==='atoll';
  if(!wanted){await this.close();return}
  if(!this.server){this.server=await this.serverFactory({coordinator:this.coordinator,openExternal:url=>require('electron').shell.openExternal(url),getLocaleState:()=>this.getLocaleState?.()||{}});this.client=new this.Client({baseURL:this.server.url,token:this.server.token});this.client.on('status',()=>this.notify());this.client.setSnapshot(snapshot(this.coordinator));this.client.start();this.unsubscribe=this.coordinator.quotaService?.subscribe?.(()=>this.publish());this.unsubscribeStats=this.coordinator.statsService?.onChange?.(()=>{invalidateUsage(this.coordinator);this.publish()});this.timer=setInterval(()=>this.publish(),2000);this.timer.unref?.()}
  this.publish();this.notify();
 }).catch(e=>{this.status={state:'error',message:e.message};this.notify()});return this.queue}
 publish(){this.client?.setSnapshot(snapshot(this.coordinator))}
 notifyEvent(event,request){this.publish();return this.client?.notifyEvent(event,request)}
 async reconnect(){await this.client?.resume();return this.getStatus()}
 async close(){clearInterval(this.timer);this.unsubscribe?.();this.unsubscribe=null;this.unsubscribeStats?.();this.unsubscribeStats=null;const c=this.client;this.client=null;if(c)await c.stop();if(this.server)await this.server.close();this.server=null;this.status={state:'disabled'};this.notify()}
 async stop(){await this.queue;await this.close()}
}
module.exports={AtollIntegration};
