'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const EVENTS = Object.freeze(['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','PostToolUseFailure','Notification','PermissionDenied','Stop','StopFailure','StopCancelled','SessionEnd']);
async function read(file){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function write(file,doc){
  await fs.mkdir(path.dirname(file),{recursive:true});const temporary=`${file}.workisland-${process.pid}.tmp`;
  try{await fs.copyFile(file,file+'.workisland.backup');}catch(e){if(e.code!=='ENOENT')throw e;}
  try{await fs.writeFile(temporary,JSON.stringify(doc,null,2)+'\n',{mode:0o600});await fs.rename(temporary,file);}finally{await fs.rm(temporary,{force:true});}
}
function own(handler){return handler?.type==='command'&&typeof handler.command==='string'&&/--source\s+["']?grok-build(?:["']|\s|$)/.test(handler.command)&&/hooks-cli\/index\.cjs|flux-hooks/.test(handler.command.replaceAll('\\','/'));}
function removeOwned(hooks){
  const result={};for(const[event,groups]of Object.entries(hooks||{})){
    if(!Array.isArray(groups)){result[event]=groups;continue;}
    const kept=[];for(const group of groups){if(!Array.isArray(group?.hooks)){kept.push(group);continue;}const handlers=group.hooks.filter(h=>!own(h));if(handlers.length)kept.push({...group,hooks:handlers});}
    if(kept.length)result[event]=kept;
  }return result;
}
class GrokBuildHookStore {
  constructor({homeDir,hookCommand,grokHome=path.join(homeDir,'.grok')}){this.command=hookCommand;this.grokHome=grokHome;this.hookPath=path.join(grokHome,'hooks','workisland-status.json');this.manifestPath=path.join(homeDir,'.flux','grok-build-manifest.json');this.pending=Promise.resolve();}
  enqueue(task){const result=this.pending.then(task);this.pending=result.catch(()=>{});return result;}
  install(){return this.enqueue(async()=>{
    const manifest=await read(this.manifestPath),previous=await read(this.hookPath);
    if(previous&&(!manifest?.owned||!previous.hooks||typeof previous.hooks!=='object'||Array.isArray(previous.hooks)))throw new Error('Grok config file already exists and is not owned by WorkIsland');
    const hooks=removeOwned(previous?.hooks);for(const event of EVENTS){const existing=hooks[event]||[];if(!Array.isArray(existing))throw new Error('Invalid Grok hook config');hooks[event]=[...existing,{hooks:[{type:'command',command:this.command,timeout:5}]}];}
    try{await write(this.hookPath,{...previous,hooks});await write(this.manifestPath,{...manifest,owned:true,installedAt:new Date().toISOString()});}
    catch(error){try{if(previous)await write(this.hookPath,previous);else await fs.rm(this.hookPath,{force:true});}catch{}throw error;}
  });}
  uninstall(){return this.enqueue(async()=>{
    const manifest=await read(this.manifestPath);if(!manifest?.owned)return;
    const previous=await read(this.hookPath);if(previous?.hooks&&typeof previous.hooks==='object'&&!Array.isArray(previous.hooks)){const hooks=removeOwned(previous.hooks);if(!Object.keys(hooks).length&&Object.keys(previous).every(k=>k==='hooks'))await fs.rm(this.hookPath,{force:true});else await write(this.hookPath,{...previous,hooks});}
    await fs.rm(this.manifestPath,{force:true});
  });}
  async checkHealth(){
    const manifest=await read(this.manifestPath),doc=await read(this.hookPath),issues=[];if(!manifest?.owned)issues.push('Grok manifest missing');
    for(const event of EVENTS){const groups=doc?.hooks?.[event],handler=Array.isArray(groups)?groups.flatMap(g=>Array.isArray(g?.hooks)?g.hooks:[]).find(own):null;if(!handler)issues.push(`Hook not registered: ${event}`);else if(handler.command!==this.command||handler.timeout!==5)issues.push(`Stale command for ${event}`);}
    const installed=issues.length===0;return{agentId:'grok-build',installed,issues,manifestPath:this.manifestPath,connectionState:installed?(manifest?.lastVerifiedAt?'verified':'configured'):'disconnected',lastVerifiedAt:manifest?.lastVerifiedAt,lastEventType:manifest?.lastEventType};
  }
  recordEvent(event){return this.enqueue(async()=>{if(!event?.sessionId||!['sessionStarted','activityUpdated','toolUseStarted','sessionCompleted'].includes(event.type))return;const manifest=await read(this.manifestPath);if(manifest?.owned&&!manifest.lastVerifiedAt)await write(this.manifestPath,{...manifest,lastVerifiedAt:new Date().toISOString(),lastEventType:event.type});});}
}
module.exports={GrokBuildHookStore,GROK_BUILD_EVENTS:EVENTS};
