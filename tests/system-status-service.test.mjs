import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SystemStatusService } = require('../src/main/system-status-service.cjs');

function harness(settings = {}) {
  const children = [];
  const monitor = new EventEmitter();
  monitor.start = () => {};
  monitor.stop = () => {};
  monitor.setEnabled = value => { monitor.enabled = value; };
  monitor.getSnapshot = () => ({ available: true, active: false, items: [], lastEvent: null });
  const service = new SystemStatusService({ platform: 'darwin', helperPath: '/helper', settings, downloadMonitor: monitor,
    spawnFn: () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
      child.kill = () => { child.killed = true; };
      children.push(child); return child;
    } });
  return { service, monitor, children };
}
function emit(child, state) { child.stdout.write(JSON.stringify({ type: 'snapshot', state }) + '\n'); }

test('preserves unknown watts and does not fabricate charging from a negative reading', () => {
  const { service, children } = harness(); service.start();
  emit(children[0], { battery: { available: true, present: true, percent: 75, charging: false, externalConnected: true, chargingWatts: -8, inputWatts: null, adapterWatts: 96 } });
  const battery = service.getSnapshot().battery;
  assert.equal(battery.chargingWatts, null); assert.equal(battery.inputWatts, null); assert.equal(battery.adapterWatts, 96);
  service.stop();
});
test('handles fragmented helper messages and masks independently disabled capabilities', () => {
  const { service, children } = harness({ systemAudioEnabled: false }); service.start();
  const message = JSON.stringify({ type: 'snapshot', state: { network: { available: true, connected: true, type: 'wifi', name: '中文网络' }, audio: { available: true, devices: [{ id: '1', name: 'Headphones' }] } } }) + '\n';
  const bytes = Buffer.from(message); const split = bytes.indexOf(Buffer.from('中')) + 1;
  children[0].stdout.write(bytes.subarray(0, split)); children[0].stdout.write(bytes.subarray(split));
  assert.equal(service.getSnapshot().network.name, '中文网络');
  assert.equal(service.getSnapshot().audio.available, false);
  assert.equal(service.getSnapshot().audio.enabled, false);
  service.stop();
});
test('stopping invalidates old helper data and download callbacks', () => {
  const { service, children, monitor } = harness(); service.start(); service.stop();
  emit(children[0], { capture: { available: true, active: true } });
  monitor.emit('update', { active: true, items: [{ name: 'stale' }] });
  assert.equal(service.getSnapshot().capture.active, false);
  assert.equal(service.getSnapshot().downloads.active, false);
  assert.equal(children[0].killed, true);
});
test('rejects oversized helper messages and clears stale known native status on failure', () => {
  const { service, children } = harness(); service.start();
  emit(children[0], { capture: { available: true, active: true } });
  children[0].stdout.write('x'.repeat(70000));
  assert.equal(children[0].killed, true);
  assert.equal(service.getSnapshot().capture.available, false);
  assert.equal(service.getSnapshot().capture.active, false);
  service.stop();
});
test('disabling download detection clears active state immediately', () => {
  const { service, monitor } = harness(); service.start();
  monitor.emit('update', { available: true, active: true, items: [{ name: 'archive.zip' }], speedBytesPerSecond: 500 });
  assert.equal(service.getSnapshot().downloads.active, true);
  service.configure({ systemDownloadsEnabled: false });
  assert.equal(service.getSnapshot().downloads.active, false);
  assert.equal(monitor.enabled, false);
  service.stop();
});
test('non-macOS explicitly reports native capabilities unavailable', () => {
  const { service } = harness(); service.platform = 'win32'; service.start();
  assert.equal(service.getSnapshot().network.available, false);
  assert.equal(service.previewLockScreen(), false);
  service.stop();
});
test('reenabling unavailable capability immediately restores its enabled flag', () => {
  const { service } = harness();
  service.configure({ systemNetworkEnabled: false });
  service.configure({ systemNetworkEnabled: true });
  assert.equal(service.getSnapshot().network.enabled, true);
  assert.equal(service.getSnapshot().network.available, false);
  service.stop();
});
test('capture changes announce start and stop once, while startup and telemetry refreshes stay quiet', () => {
  const { service, children } = harness(); service.start();
  emit(children[0], { capture: { available: true, active: false } });
  assert.equal(service.getSnapshot().notice, null);
  emit(children[0], { capture: { available: true, active: true } });
  assert.equal(service.getSnapshot().notice?.kind, 'capture-started');
  const notice = service.getSnapshot().notice;
  emit(children[0], { capture: { available: true, active: true } });
  assert.deepEqual(service.getSnapshot().notice, notice);
  emit(children[0], { capture: { available: true, active: false } });
  assert.equal(service.getSnapshot().notice?.kind, 'capture-stopped');
  service.stop();
});
test('Bluetooth connect and disconnect announce even when the active output does not change', () => {
  const { service, children } = harness(); service.start();
  const output = { id: 'speaker', name: 'Speakers', transport: 'builtIn' };
  emit(children[0], { audio: { available: true, activeDeviceId: 'speaker', devices: [output] } });
  emit(children[0], { audio: { available: true, activeDeviceId: 'speaker', devices: [output, { id: 'bt', name: 'AirPods', transport: 'bluetooth' }] } });
  assert.equal(service.getSnapshot().notice?.kind, 'audio-connected');
  emit(children[0], { audio: { available: true, activeDeviceId: 'speaker', devices: [output] } });
  assert.equal(service.getSnapshot().notice?.kind, 'audio-disconnected');
  service.stop();
});
