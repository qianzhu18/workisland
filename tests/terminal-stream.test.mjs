import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerminalStream } from '../src/renderer/island/components/terminal-stream.mjs';

test('a snapshot and overlapping live frames render each byte once', () => {
  const output = [];
  const stream = createTerminalStream({ id: 'one', generation: 1, write: s => output.push(s) });
  stream.accept({ id: 'one', generation: 1, sequence: 1, data: 'history' });
  stream.accept({ id: 'one', generation: 1, sequence: 2, data: 'live' });
  assert.equal(stream.restore({ id: 'one', generation: 1, sequence: 1, recentOutput: 'history' }), true);
  stream.accept({ id: 'one', generation: 1, sequence: 2, data: 'live' });
  stream.accept({ id: 'one', generation: 1, sequence: 3, data: 'next' });
  assert.equal(output.join(''), 'historylivenext');
});

test('background terminal and previous-generation output never enters the visible terminal', () => {
  const output = [];
  const stream = createTerminalStream({ id: 'one', generation: 2, write: s => output.push(s) });
  assert.equal(stream.restore({ id: 'one', generation: 1, sequence: 5, recentOutput: 'stale' }), false);
  stream.accept({ id: 'two', generation: 2, sequence: 1, data: 'background' });
  stream.accept({ id: 'one', generation: 1, sequence: 6, data: 'old process' });
  stream.restore({ id: 'one', generation: 2, sequence: 0, recentOutput: '' });
  stream.accept({ id: 'one', generation: 2, sequence: 1, data: 'fresh' });
  stream.dispose();
  stream.accept({ id: 'one', generation: 2, sequence: 2, data: 'closed' });
  assert.equal(output.join(''), 'fresh');
});

test('a delayed snapshot cannot silently skip output when the bounded pending queue overflows', () => {
  const output = [];
  const stream = createTerminalStream({ id: 'one', generation: 1, write: s => output.push(s), maxPending: 6 });
  for (let n = 1; n <= 4; n++) stream.accept({ id: 'one', generation: 1, sequence: n, data: 'abc' });
  assert.equal(stream.restore({ id: 'one', generation: 1, sequence: 0, recentOutput: '' }), false);
  assert.equal(output.length, 0);
  assert.equal(stream.restore({ id: 'one', generation: 1, sequence: 3, recentOutput: 'abcabcabc' }), true);
  assert.equal(output.join(''), 'abcabcabcabc');
});

test('an oversized pending frame still requires a current history snapshot', () => {
  const output = [];
  const stream = createTerminalStream({ id: 'one', generation: 1, write: s => output.push(s), maxPending: 2 });
  stream.accept({ id: 'one', generation: 1, sequence: 1, data: 'abc' });
  assert.equal(stream.restore({ id: 'one', generation: 1, sequence: 0, recentOutput: '' }), false);
  assert.equal(stream.restore({ id: 'one', generation: 1, sequence: 1, recentOutput: 'abc' }), true);
  assert.equal(output.join(''), 'abc');
});
