import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';

function harness({ rawMissing = false } = {}) {
  const displays = [
    { id: 18, bounds: { x: -1180, y: 0, width: 1180, height: 820 }, scaleFactor: 2 },
    { id: 1, bounds: { x: 0, y: 0, width: 1470, height: 956 }, scaleFactor: 2 }
  ];
  let primaryId = 1;
  const screen = Object.assign(new EventEmitter(), {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays.find(d => d.id === primaryId),
    getCursorScreenPoint: () => ({ x: -500, y: 100 }),
    getDisplayNearestPoint: () => displays[0]
  });
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../src/main/display-manager.cjs', import.meta.url), 'utf8'), {
    module, require: name => ({ electron: { screen }, 'electron-log': console, 'node:events': { EventEmitter } })[name],
    console, setTimeout, clearTimeout, queueMicrotask
  });
  const Manager = module.exports.createDisplayManagerClass({
    // Legacy native mainScreen follows the key window on Sidecar, not the system primary.
    getAllScreensInfo: () => rawMissing ? [] : displays.map(d => ({ cgDisplayId: d.id, isMain: d.id === 18, localizedName: d.id === 18 ? 'Sidecar' : 'Built-in', hasNotch: d.id === 1 })),
    getFrontmostAppDisplayId: () => 18,
    watchFrontmostApp() {}, unwatchFrontmostApp() {}, watchScreenParameters() {}, unwatchScreenParameters() {}
  });
  return { Manager, setPrimary: id => { primaryId = id; } };
}

test('auto to primary moves immediately despite the key window being on Sidecar', () => {
  const { Manager } = harness();
  const manager = new Manager('auto');
  try {
    assert.equal(manager.getCurrentTarget().display.id, 18);
    const moved = [];
    manager.on('displayChanged', target => moved.push(target.display.id));
    manager.setPreference('primary');
    assert.deepEqual(moved, [1]);
    assert.equal(manager.getCurrentTarget().display.id, 1);
    manager.refresh('metrics-changed');
    assert.equal(manager.getCurrentTarget().display.id, 1);
  } finally { manager.dispose(); }
});

test('picker and primary selection use system primary even without native metadata or primary-first ordering', () => {
  for (const rawMissing of [false, true]) {
    const { Manager } = harness({ rawMissing });
    const manager = new Manager('primary');
    try {
      assert.equal(manager.getCurrentTarget().display.id, 1);
      assert.deepEqual(Array.from(manager.getAllTargets(), t => [t.display.id, t.screenInfo.isMain]), [[18, false], [1, true]]);
    } finally { manager.dispose(); }
  }
});

test('primary tracks an intentional system primary change to an external display', () => {
  const { Manager, setPrimary } = harness();
  const manager = new Manager('primary');
  try {
    assert.equal(manager.getCurrentTarget().display.id, 1);
    setPrimary(18);
    manager.refresh('topology-changed');
    assert.equal(manager.getCurrentTarget().display.id, 18);
  } finally { manager.dispose(); }
});

test('disconnected pinned display falls back to system primary while explicit Sidecar stays pinned', () => {
  const { Manager } = harness();
  const manager = new Manager('99');
  try {
    assert.equal(manager.getCurrentTarget().display.id, 1);
    manager.setPreference('18', 'Sidecar');
    assert.equal(manager.getCurrentTarget().display.id, 18);
    manager.setPreference('auto');
    assert.equal(manager.getCurrentTarget().display.id, 18);
  } finally { manager.dispose(); }
});
