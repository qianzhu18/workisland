#!/usr/bin/env node
// Real generated command -> hooks CLI -> Unix bridge -> Kiro adapter. Synthetic
// lifecycle payloads only; this does not claim an authenticated Kiro model turn.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url),{KiroHookStore}=require('../src/main/kiro-hooks.cjs'),{KiroAdapter}=require('../src/main/adapters-kiro.cjs'),{createHooksCliCommand}=require('../src/main/hooks-cli-command.cjs'),{createBridgeServerClass}=require('../src/main/bridge-server.cjs');
if(process.platform==='win32')throw Error('Run this Unix-socket smoke on macOS/Linux');
const home=await mkdtemp('/tmp/wi-kiro-smoke-'),socketPath=home+'/bridge.sock',events=[];
const Bridge=createBridgeServerClass({adapterRegistry:new Map([['kiro',new KiroAdapter()]]),PluginAdapter:class{},ClaudeTranscriptWatcher:class{detachAll(){}},createHookPayloadRecorder:()=>null,isPluginAgentTool:()=>false,normalizeAgentPid:pid=>Number.isSafeInteger(pid)&&pid>1?pid:undefined,normalizeIdeWorkspace:()=>undefined,normalizeTerminalAppForHookSource:(_,host)=>host});
const bridge=new Bridge();bridge.socketPath=socketPath;bridge.on('agentEvent',event=>events.push(event));bridge.server=net.createServer(s=>bridge.handleConnection(s));await new Promise(r=>bridge.server.listen(socketPath,r));
const store=new KiroHookStore({homeDir:home,hookCommand:createHooksCliCommand({appPath:process.cwd(),source:'kiro',nodePath:process.execPath})});
async function run(command,payload,target=socketPath){const env={...process.env,HOME:home,KIRO_HOME:home+'/.kiro',FLUX_SOCKET_PATH:target};delete env.FLUX_HOOKS_DEBUG;return new Promise((resolve,reject)=>{const child=spawn('/bin/sh',['-c',command],{env,stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('exit',code=>resolve({code,out,err}));child.stdin.end(JSON.stringify(payload));});}
try{
 await store.install();const document=JSON.parse(await readFile(store.hookPath)),command=document.hooks[0].action.command;
 for(const [id,host]of[['ide-smoke','Kiro'],['cli-smoke','Terminal']])for(const event of['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','Stop']){const result=await run(command,{session_id:id,hook_event_name:event,cwd:home,prompt:'Synthetic Kiro integration smoke',tool_name:'read',terminal_app:host});assert.deepEqual(result,{code:0,out:'',err:''});}
 assert.equal(events.filter(e=>e.type==='sessionStarted').length,2);assert.equal(events.filter(e=>e.type==='sessionCompleted').length,2);assert.ok(events.filter(e=>e.type==='sessionCompleted').every(e=>e.isSessionEnd===false));assert.equal(events.some(e=>e.type==='permissionRequested'),false);
 assert.ok(events.some(e=>e.type==='jumpTargetUpdated'&&e.jumpTarget.app==='Kiro'));assert.ok(events.some(e=>e.type==='jumpTargetUpdated'&&e.jumpTarget.app==='Terminal'));assert.equal(bridge.pendingPermissions.size,0);
 const classic=JSON.parse(await readFile(store.legacyPath)),beforeClassic=events.length;await run(classic.hooks.userPromptSubmit[0].command,{session_id:'v3-duplicate',hook_event_name:'UserPromptSubmit'});assert.equal(events.length,beforeClassic,'classic profile must not duplicate V3 global hooks');
 bridge.shouldAcceptHook=()=>false;const before=events.length;await run(command,{session_id:'disabled',hook_event_name:'UserPromptSubmit'});assert.equal(events.length,before);
 const missing=await run(command,{session_id:'offline',hook_event_name:'PreToolUse'},home+'/missing.sock');assert.deepEqual(missing,{code:0,out:'',err:''});
 const hungPath=home+'/hung.sock',hungClients=new Set(),hung=net.createServer(s=>{hungClients.add(s);s.on('close',()=>hungClients.delete(s));s.write(JSON.stringify({type:'hello'})+'\n');});await new Promise(r=>hung.listen(hungPath,r));try{const started=Date.now(),result=await run(command,{session_id:'slow',hook_event_name:'PreToolUse'},hungPath);assert.equal(result.code,0);assert.equal(result.out,'');assert.ok(Date.now()-started<3500,'observer must exit before Kiro hook timeout');}finally{for(const s of hungClients)s.destroy();await new Promise(r=>hung.close(r));}
 const report={pass:true,generatedCommandBridge:true,ideAndCliRouting:true,twoIndependentSessions:true,nativeApprovalsUntouched:true,disabledAgentIgnored:true,offlineAndHungBridgeFailOpen:true,realKiroModelTurn:false};await mkdir('.local-data/kiro',{recursive:true});await writeFile(resolve('.local-data/kiro/hook-smoke.json'),JSON.stringify(report,null,2));console.log(report);
}finally{bridge.stop();await rm(home,{recursive:true,force:true});}
