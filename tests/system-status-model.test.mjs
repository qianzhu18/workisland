import test from 'node:test';
import assert from 'node:assert/strict';
import { systemActivity, systemNotice, shouldPresentSystemNotice, formatWatts, formatTransferRate } from '../src/renderer/island/components/system-status-model.mjs';

test('Agent attention always takes precedence over persistent system activities', () => {
  assert.equal(systemActivity({ capture: { available: true, active: true } }, 100, true), null);
});
test('transient status popup expires and never replaces approvals or a manually opened workspace', () => {
  const state = { notice: { kind: 'capture-started', at: 1000 }, capture: { enabled: true } };
  assert.equal(systemNotice(state, 1001)?.kind, 'capture-started');
  assert.equal(systemNotice(state, 7000), null);
  assert.equal(shouldPresentSystemNotice({ state, now: 1001, isOpen: false }), true);
  assert.equal(shouldPresentSystemNotice({ state, now: 1001, hasAttention: true }), false);
  assert.equal(shouldPresentSystemNotice({ state, now: 1001, isOpen: true, surfaceType: 'sessionList' }), false);
  assert.equal(shouldPresentSystemNotice({ state, now: 1001, isOpen: true, surfaceType: 'systemStatus' }), true);
  assert.equal(shouldPresentSystemNotice({ state: { ...state, locked: true }, now: 1001 }), false);
  assert.equal(systemNotice({ ...state, capture: { enabled: false } }, 1001), null);
});
test('capture and download persist while transient notices expire', () => {
  assert.equal(systemActivity({ capture: { available: true, active: true } }, 100000).kind, 'capture');
  assert.equal(systemActivity({ downloads: { available: true, active: true, items: [{ name: 'a.zip' }] } }, 100000).kind, 'downloads');
  assert.equal(systemActivity({ notice: { kind: 'audio-changed', at: 0 } }, 7000), null);
  assert.equal(systemActivity({ notice: { kind: 'audio-changed', name: 'AirPods', at: 6000 } }, 7000).name, 'AirPods');
});
test('unavailable telemetry stays unknown while genuine zero remains visible', () => {
  assert.equal(formatWatts(null), '—'); assert.equal(formatWatts(undefined), '—');
  assert.equal(formatWatts(-12), '—'); assert.equal(formatWatts(0), '0.0 W');
  assert.equal(formatWatts(12.34), '12.3 W');
  assert.equal(formatTransferRate(null), '—'); assert.equal(formatTransferRate(1048576), '1.0 MB/s');
});
