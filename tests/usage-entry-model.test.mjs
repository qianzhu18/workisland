import test from 'node:test';
import assert from 'node:assert/strict';
import { quotaPeriods, codexQuotaSummary, usageTotals } from '../src/renderer/island/components/usage-entry-model.mjs';
test('missing or malformed Codex quotas stay unavailable instead of a fake zero balance',()=>{
 for(const value of [undefined,{}, {daily:{total:'-',usedPct:0}}, {daily:{total:'5h',usedPct:NaN}}, {daily:{total:'5h',usedPct:null}}]){
  assert.equal(codexQuotaSummary(value),null);
 }
});
test('Codex primary window shows remaining percent, preserving the weekly window in details',()=>{
 const quota={daily:{total:'5h',usedPct:21.4,remaining:'2h'},weekly:{total:'7d',usedPct:49,remaining:'3d'}};
 assert.equal(codexQuotaSummary(quota).remainingPct,78.6);
 assert.deepEqual(quotaPeriods(quota).map(p=>p.total),['5h','7d']);
 assert.equal(codexQuotaSummary({weekly:quota.weekly}).remainingPct,51);
 assert.equal(codexQuotaSummary({daily:{total:'5h',usedPct:110}}).remainingPct,0);
});
test('local usage separates unknown pricing and does not invent a provider balance',()=>{
 assert.equal(usageTotals(null),null);
 const totals=usageTotals({totals:{inputTokens:100,outputTokens:20,cacheReadTokens:30,cacheCreationTokens:5,costMicroUsd:5000,unknownCostTokens:12}});
 assert.deepEqual(totals,{tokens:155,costMicroUsd:5000,unknownCostTokens:12});
 assert.equal(Object.hasOwn(totals,'balance'),false);
});

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { mergeSettings } = require('../src/shared/settings.cjs');
test('migration preserves previously visible Codex quota when old API tool was hidden, then respects later hiding',()=>{
 const migrated=mergeSettings({toolbarHiddenModules:['usage','shelf'],toolbarModuleSlots:{usage:'overflow',shelf:'left:0'}});
 assert.deepEqual(migrated.toolbarHiddenModules,['shelf']);
 assert.equal(Object.hasOwn(migrated.toolbarModuleSlots,'usage'),false);
 assert.equal(migrated.usageEntryVersion,1);
 assert.deepEqual(mergeSettings({...migrated,toolbarHiddenModules:['usage']}).toolbarHiddenModules,['usage']);
 assert.deepEqual(mergeSettings({showUsageQuota:false,toolbarHiddenModules:['usage']}).toolbarHiddenModules,['usage']);
});
