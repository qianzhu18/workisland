import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ShelfService } from '../src/main/shelf-service.cjs';

test('clipboard image becomes a durable file item and removing it does not delete its saved image', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wi-shelf-image-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new ShelfService({ storePath: path.join(root, 'shelf.json') });
  await service.start();
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  const [item] = await service.addClipboardImage(png);
  assert.equal(item.type, 'file');
  assert.deepEqual(await readFile(item.path), png);
  const restarted = new ShelfService({ storePath: path.join(root, 'shelf.json') });
  await restarted.start();
  assert.equal(restarted.find(item.id).available, true);
  await restarted.remove([item.id]);
  assert.deepEqual(await readFile(item.path), png);
  await assert.rejects(service.addClipboardImage(Buffer.from('not png')));
});
