import test from 'node:test';
import assert from 'node:assert/strict';
import { toolbarCapacity, insertTool, toolbarSlots, toolbarDropTarget, visibleToolbarOrder, placeToolbarTools } from '../src/renderer/island/components/toolbar-model.mjs';
test('overflow reserves home, settings and more without consuming camera space', () => {
  assert.equal(toolbarCapacity(256, 6), 6);
  assert.equal(toolbarCapacity(224, 6), 4);
  assert.equal(toolbarCapacity(96, 6), 0);
});

test('balances real spare space around the camera without covering quota', () => {
  const layout = toolbarSlots(640, 200, 92);
  assert.deepEqual(layout.slots.filter(s => s.bank === 'left').map(s => s.x), [100,132,164]);
  assert.equal(layout.home, 420);
  for (const slot of layout.slots) {
    assert.ok(slot.x >= 100);
    assert.ok(slot.x + 32 <= layout.cameraLeft || slot.x >= layout.cameraRight + 32);
    assert.ok(slot.x + 32 <= layout.more);
  }
  assert.equal(toolbarDropTarget(layout, 300, 15, 32), null);
  assert.equal(toolbarDropTarget(layout, 110, 50, 32), null);
  assert.equal(toolbarDropTarget(layout, 110, 15, 32), 0);
  assert.equal(toolbarDropTarget(layout, layout.more + 16, 15, 32), 'more');
});

test('dragging a hidden high priority tool back into a full bank displaces the tail', () => {
  const order = ['shelf','clipboard','terminal','usage','performance','pet'];
  const base = visibleToolbarOrder(order, ['performance'], 'performance');
  const preview = insertTool(base, 'performance', 0);
  assert.deepEqual(preview.slice(0,4), ['performance','shelf','clipboard','terminal']);
  assert.deepEqual(preview.slice(4), ['usage','pet']);
  assert.deepEqual(visibleToolbarOrder(order, ['performance']), ['shelf','clipboard','terminal','usage','pet']);
});

test('external screens and dense quota never produce slots inside the camera', () => {
  for (const width of [420,600,704]) for (const notch of [0,180,240]) for (const quota of [0,100,280]) {
    const layout = toolbarSlots(width, notch, quota);
    for (const slot of layout.slots) assert.ok(slot.x+32 <= layout.cameraLeft || slot.x >= layout.cameraRight);
  }
});
test('consecutive moves retain the previously arranged order', () => {
  const first = insertTool(['shelf','clipboard','terminal','usage'], 'usage', 0);
  assert.deepEqual(insertTool(first, 'terminal', 1), ['usage','terminal','shelf','clipboard']);
  assert.deepEqual(insertTool(first, 'usage', 3), ['shelf','clipboard','terminal','usage']);
});

test('a selected right bank remains right even when the left bank has empty slots', () => {
  const layout = toolbarSlots(704, 194, 0);
  const result = placeToolbarTools(['shelf','performance'], layout, { performance: 'right' });
  assert.equal(result.get('shelf').bank, 'left');
  assert.equal(result.get('performance').bank, 'right');
  assert.equal(result.get('performance').x, layout.cameraRight + 32);
});

test('full capacity gives the promoted utility a slot and preserves other tools as overflow', () => {
  const layout = toolbarSlots(420, 194, 0);
  const ids = ['performance', 'shelf', 'terminal', 'usage', 'clipboard', 'pet'];
  const result = placeToolbarTools(ids, layout, {performance:'right'});
  assert.ok(result.has('performance'));
  assert.equal(result.size, layout.slots.length);
  assert.equal(result.has('pet'), false);
});
