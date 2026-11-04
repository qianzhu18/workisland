import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pasteShelfClipboard } from '../src/main/shelf-paste.cjs';

test('paste chooses file URLs before screenshot pixels and text', async () => {
  const calls=[];
  const c={ addShelfPaths: p => calls.push(['paths',p]), addShelfClipboardImage: p => calls.push(['image',p]), addShelfPayload: p => calls.push(['text',p]), getShelfState: () => calls.push(['empty']) };
  const clipboard={readImage: () => ({isEmpty: () => false, toPNG: () => Buffer.from('png')}), readText: () => 'hello'};
  await pasteShelfClipboard(c, clipboard, () => ['/tmp/example']);
  assert.deepEqual(calls, [['paths',['/tmp/example']]]);
  calls.length=0;
  await pasteShelfClipboard(c, clipboard, () => []);
  assert.deepEqual(calls, [['image',Buffer.from('png')]]);
  calls.length=0;
  await pasteShelfClipboard(c, { ...clipboard, readImage: () => ({ isEmpty: () => true }) }, () => []);
  assert.deepEqual(calls, [['text',{type:'text',value:'hello'}]]);
});
