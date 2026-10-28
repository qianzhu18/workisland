import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';
const require=createRequire(import.meta.url);
const {KiroAdapter}=require('../src/main/adapters-kiro.cjs');
const {normalizeKiroPayload,detectKiroParentContext}=require('../src/main/kiro-payload.cjs');
const context=()=>{const events=[],jumps=[],responses=[];return{events,jumps,responses,emitEvent:e=>events.push(e),updateJumpTarget:(...a)=>jumps.push(a),sendResponse:(_,r)=>responses.push(r),playSoundEvent:()=>{}};};
test('Kiro IDE and CLI native lifecycle retains sessions and treats Stop as turn completion',()=>{
 const a=new KiroAdapter(),c=context();for(const id of['ide-a','cli-b']){for(const event of['UserPromptSubmit','PreToolUse','PostToolUse','Stop'])a.handleHook('client',{session_id:id,hook_event_name:event,cwd:'/project',prompt:'test',tool_name:'read',terminal_app:id.startsWith('ide')?'Kiro':'Terminal'},c);}
 assert.equal(c.events.filter(e=>e.type==='sessionStarted').length,2);assert.deepEqual(c.events.filter(e=>e.type==='sessionCompleted').map(e=>[e.sessionId,e.isSessionEnd]),[['ide-a',false],['cli-b',false]]);assert.ok(c.responses.every(r=>r.type==='acknowledged'));assert.equal(c.events.some(e=>e.type==='permissionRequested'),false);
});
test('SessionStart alone does not claim that the agent is working; unknown or anonymous IDE events are ignored',()=>{const a=new KiroAdapter(),c=context();for(const p of[{session_id:'a',hook_event_name:'SessionStart'},{hook_event_name:'Stop',cwd:'/same'},{session_id:'a',hook_event_name:'unrecognized'}])a.handleHook('c',p,c);assert.equal(c.events.length,0);assert.equal(c.responses.length,3);});
test('classic aliases normalize and CLI fallback uses positive agent identity, never cwd or hook-shell PID',()=>{
 assert.equal(normalizeKiroPayload({hook_event_name:'userPromptSubmit',kiro_surface:'cli',kiro_agent_pid:321}).session_id,'kiro-cli-pid-321');assert.equal(normalizeKiroPayload({hook_event_name:'stop',cwd:'/same',pid:44}).session_id,undefined);assert.equal(normalizeKiroPayload({session_id:'native',kiro_agent_pid:321}).session_id,'native');assert.equal(normalizeKiroPayload({hook_event_name:'agentSpawn'}).hook_event_name,'SessionStart');
 const raw='44 33 /bin/sh\n33 22 /Users/a/.local/bin/kiro-cli\n22 1 /Applications/Terminal.app/Contents/MacOS/Terminal';assert.deepEqual(detectKiroParentContext(raw,44),{surface:'cli',pid:33});assert.deepEqual(detectKiroParentContext('44 1 /bin/sh -c echo kiro-cli',44),{});
 assert.deepEqual(detectKiroParentContext('44 33 /bin/sh\n33 1 /Applications/Kiro.app/Contents/MacOS/Electron',44),{surface:'ide',pid:33});
});
test('CLI and IDE routing preserve host and a fresh prompt restarts a completed turn',()=>{const a=new KiroAdapter(),c=context();for(const event of['UserPromptSubmit','Stop','UserPromptSubmit'])a.handleHook('c',{session_id:'x',hook_event_name:event,prompt:'go',terminal_app:'Kiro',pid:123},c);assert.equal(c.events.filter(e=>e.type==='sessionStarted').length,2);assert.equal(c.jumps.at(-1)[2].terminal_app,'Kiro');});
