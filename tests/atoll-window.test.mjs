import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createWindowClasses}=require('../src/main/windows.cjs');
const {IslandWindow}=createWindowClasses({});

test('the default native target does not reveal or resize a window before it is ready',()=>{
 const window=Object.create(IslandWindow.prototype);
 window._outputSuppressed=false;
 window.win={isDestroyed:()=>false,showInactive:()=>assert.fail('premature reveal')};
 window.syncWindowToCurrentState=()=>assert.fail('premature resize');
 window.setOutputSuppressed(false);
});

test('Atoll output remains hidden across native hover, display and close updates',()=>{
 let hidden=0;
 const window=Object.create(IslandWindow.prototype);
 window._outputSuppressed=false;
 window.win={isDestroyed:()=>false,hide:()=>hidden++};
 window.setOutputSuppressed(true);
 window.revealForHover();
 window.syncWindowToCurrentState();
 window.applyClosedWindowTarget('visible-pill');
 assert.equal(hidden,4);
});
