import test from 'node:test';
import assert from 'node:assert/strict';
import { toolbarCapacity, insertTool } from '../src/renderer/island/components/toolbar-model.mjs';
test('overflow reserves home, settings and more without consuming camera space', () => {
  assert.equal(toolbarCapacity(256, 6), 6);
  assert.equal(toolbarCapacity(224, 6), 4);
  assert.equal(toolbarCapacity(96, 6), 0);
});
test('consecutive moves retain the previously arranged order', () => {
  const first = insertTool(['shelf','clipboard','terminal','usage'], 'usage', 0);
  assert.deepEqual(insertTool(first, 'terminal', 1), ['usage','terminal','shelf','clipboard']);
  assert.deepEqual(insertTool(first, 'usage', 3), ['shelf','clipboard','terminal','usage']);
});
