import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {AtollAgentPanel}=require('../src/main/atoll-agent-panel.cjs');
const {IPC}=require('../src/shared/ipc.cjs');

function fixture(){
 const calls=[], original={display:{id:1}}, clicked={display:{id:2}};
 const win={isDestroyed:()=>false,webContents:{isLoadingMainFrame:()=>false,send:(...args)=>calls.push(args)},show:()=>calls.push(['show']),focus:()=>calls.push(['focus']),setIgnoreMouseEvents:v=>calls.push(['mouse',v]),once:()=>{}};
 const native={currentTarget:original,isFullscreenHidden:false,isPanelExpanded:false,moveToDisplay:t=>{native.currentTarget=t;calls.push(['display',t.display.id])},setOutputSuppressed:v=>calls.push(['suppressed',v]),setFullscreenHidden:v=>calls.push(['fullscreen',v]),setFocusHidden:v=>calls.push(['focusHidden',v])};
 const settings={atollIntegrationEnabled:true,agentDisplayTarget:'atoll'};
 const coordinator={islandWindow:win,islandWin:native,displayMgr:{getAllTargets:()=>[original,clicked],getCurrentTarget:()=>original},getSettings:()=>settings,broadcastSessionUpdate:()=>calls.push(['sessions']),evaluateFullscreenVisibility:()=>calls.push(['evaluate'])};
 const panel=new AtollAgentPanel(coordinator,{platform:'darwin',getScreen:()=>({getCursorScreenPoint:()=>({x:-20,y:10}),getDisplayNearestPoint:()=>clicked.display})});
 return {panel,calls,win,native,settings,coordinator};
}
test('borrows the existing native island on the clicked display without changing the saved mode',()=>{
 const {panel,calls,settings,native}=fixture();panel.open();
 assert.equal(panel.isOpen,true);assert.equal(native.currentTarget.display.id,2);
 assert.deepEqual(settings,{atollIntegrationEnabled:true,agentDisplayTarget:'atoll'});
 assert.ok(calls.some(c=>c[0]===IPC.ISLAND_PRESENT_SURFACE&&c[1].surface.type==='sessionList'&&c[1].reason==='click'&&!c[1].autoDismiss));
 assert.ok(calls.some(c=>c[0]==='mouse'&&c[1]===false));
 panel.open();panel.close();
 assert.equal(panel.isOpen,false);assert.equal(native.currentTarget.display.id,1);
 assert.ok(calls.some(c=>c[0]==='suppressed'&&c[1]===true));
});
test('ignores collapse messages from other windows and cleans up exactly once',()=>{
 const {panel,win,calls}=fixture();panel.open();panel.handleCollapsed({});assert.equal(panel.isOpen,true);
 panel.handleCollapsed(win.webContents);assert.equal(panel.isOpen,false);
 const count=calls.length;panel.close();assert.equal(calls.length,count);
});
test('requires enabled Atoll mode and a loaded native window',()=>{
 const {panel,settings,win,calls}=fixture();settings.atollIntegrationEnabled=false;
 assert.throws(()=>panel.open(),/Atoll/);assert.equal(calls.length,0);
 settings.atollIntegrationEnabled=true;win.webContents.isLoadingMainFrame=()=>true;
 assert.throws(()=>panel.open(),/ready/);assert.equal(panel.isOpen,false);
});
test('switching back to native mode restores native visibility instead of suppressing it',()=>{
 const {panel,settings,calls}=fixture();panel.open();settings.agentDisplayTarget='native';panel.close();
 assert.deepEqual(calls.filter(c=>c[0]==='suppressed').at(-1),['suppressed',false]);
});
test('attention opens without stealing keyboard focus and closes when answered; manual views stay open',()=>{
 const {panel,win,calls}=fixture();win.showInactive=()=>calls.push(['inactive']);
 const pending={id:'session',phase:'waitingForAnswer',questionPrompt:{id:'call_1'}};
 panel.openForAttention(pending);
 assert.ok(panel.isOpen);assert.ok(calls.some(c=>c[0]==='inactive'));assert.ok(!calls.some(c=>c[0]==='focus'));
 panel.closeIfResolved([pending]);assert.ok(panel.isOpen);
 panel.closeIfResolved([{...pending,phase:'running'}]);assert.ok(!panel.isOpen);
 panel.openForAttention(pending);assert.ok(!panel.isOpen);
 panel.open();panel.closeIfResolved([]);assert.ok(panel.isOpen);
});
test('completion uses the native filtered card and its dismissal policy without taking focus or replacing manual review',()=>{
 const {panel,win,calls}=fixture();win.showInactive=()=>calls.push(['inactive']);
 const surface={type:'sessionList',actionableSessionId:'real',visibleSessionIds:['real']};
 const result={surface,priority:'completion',autoDismiss:true};
 panel.openForResult(result);assert.ok(panel.isOpen);
 assert.deepEqual(calls.find(c=>c[0]===IPC.ISLAND_PRESENT_SURFACE)[1],{surface,reason:'notification',autoDismiss:true});
 assert.ok(!calls.some(c=>c[0]==='focus'));
 panel.openForAttention({id:'a',questionPrompt:{id:'q'}});
 const n=calls.length;panel.openForResult(result);assert.equal(calls.length,n);
 panel.close();panel.open();const m=calls.length;panel.openForResult(result);assert.equal(calls.length,m);
});
