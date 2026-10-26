import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DownloadMonitor } = require('../src/main/download-monitor.cjs');

async function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workisland-download-'));
  const monitor = new DownloadMonitor({ directory, sampleIntervalMs: 60_000, debounceMs: 60_000, ...options });
  t.after(() => { monitor.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, monitor, file: name => path.join(directory, name) };
}
test('completed files do not exhaust the active-download scan budget', async t => {
  const { monitor, file } = await fixture(t, { maxEntries: 2 });
  for (let i = 0; i < 4; i++) fs.writeFileSync(file(`completed-${i}.zip`), 'old');
  await monitor.start();
  fs.writeFileSync(file('new.zip.crdownload'), 'new');
  await monitor.scanNow();
  assert.equal(monitor.getSnapshot().available, true);
  assert.equal(monitor.getSnapshot().active, true);
});

test('startup partials stay quiet but genuine growth activates and measures speed', async t => {
  let now = 1000;
  const { monitor, file } = await fixture(t, { now: () => now });
  fs.writeFileSync(file('old.zip.crdownload'), 'old');
  await monitor.start();
  assert.equal(monitor.getSnapshot().active, false);
  now += 1000;
  fs.appendFileSync(file('old.zip.crdownload'), 'growing');
  await monitor.scanNow();
  assert.equal(monitor.getSnapshot().active, true);
  assert.equal(monitor.getSnapshot().items[0].speedBytesPerSecond, 7);
  assert.equal(monitor.getSnapshot().items[0].name, 'old.zip');
});

test('new partials complete only when a destination was created or changed', async t => {
  const { monitor, file } = await fixture(t);
  fs.writeFileSync(file('existing.zip'), 'original');
  await monitor.start();
  fs.writeFileSync(file('existing.zip.part'), 'partial');
  await monitor.scanNow();
  assert.equal(monitor.getSnapshot().active, true);
  fs.unlinkSync(file('existing.zip.part'));
  await monitor.scanNow();
  assert.equal(monitor.getSnapshot().lastEvent.kind, 'cancelled');
  fs.writeFileSync(file('new.zip.opdownload'), 'payload');
  await monitor.scanNow();
  fs.renameSync(file('new.zip.opdownload'), file('new.zip'));
  await monitor.scanNow();
  assert.equal(monitor.getSnapshot().lastEvent.kind, 'completed');
  assert.equal(monitor.getSnapshot().lastEvent.name, 'new.zip');
  fs.writeFileSync(file('existing.zip.part'), 'replacement');
  await monitor.scanNow();
  fs.renameSync(file('existing.zip.part'), file('existing.zip'));
  await monitor.scanNow();
  assert.equal(monitor.getSnapshot().lastEvent.kind, 'completed');
});

test('Safari bundles measure nested payload, exclude metadata and do not follow symlinks', async t => {
  const { monitor, file } = await fixture(t);
  await monitor.start();
  fs.mkdirSync(file('movie.mp4.download/nested'), { recursive: true });
  fs.writeFileSync(file('movie.mp4.download/Info.plist'), 'metadata');
  fs.writeFileSync(file('movie.mp4.download/nested/movie.mp4'), '123456');
  fs.symlinkSync(os.tmpdir(), file('movie.mp4.download/escape'));
  await monitor.scanNow();
  assert.equal(monitor.getSnapshot().items[0].bytes, 6);
  fs.writeFileSync(file('movie.mp4'), '123456');
  fs.rmSync(file('movie.mp4.download'), { recursive: true });
  await monitor.scanNow();
  assert.equal(monitor.getSnapshot().lastEvent.kind, 'completed');
});

test('stop and disable reset active data and prevent late scan writes', async t => {
  const { monitor, file } = await fixture(t);
  await monitor.start();
  fs.writeFileSync(file('work.part'), 'data');
  await monitor.scanNow();
  let updates = 0;
  monitor.on('update', () => updates++);
  const pending = monitor.scanNow();
  monitor.stop();
  await pending;
  assert.equal(monitor.getSnapshot().active, false);
  const stoppedUpdates = updates;
  await monitor.scanNow();
  assert.equal(updates, stoppedUpdates);
  await monitor.start();
  monitor.setEnabled(false);
  assert.equal(monitor.getSnapshot().active, false);
});

test('missing or unreadable directory exposes unavailable state without throwing', async t => {
  const { monitor, directory } = await fixture(t);
  fs.rmdirSync(directory);
  await monitor.start();
  assert.equal(monitor.getSnapshot().available, false);
  assert.match(monitor.getSnapshot().error, /ENOENT/);
});

test('directory watch activates new downloads without an explicit scan', async t => {
  const { monitor, file } = await fixture(t, { debounceMs: 5 });
  await monitor.start();
  const activeUpdate = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('download filesystem event was not observed')), 2000);
    monitor.on('update', snapshot => {
      if (snapshot.active) { clearTimeout(timeout); resolve(snapshot); }
    });
  });
  fs.writeFileSync(file('watched.crdownload'), 'data');
  assert.equal((await activeUpdate).items[0].name, 'watched');
});

test('overlapping refreshes serialize and stopping a blocked scan cannot republish', async t => {
  let blocked = false;
  let release;
  let enter;
  let concurrent = 0;
  let maximumConcurrent = 0;
  const entered = new Promise(resolve => { enter = resolve; });
  const fsApi = { ...fs, promises: { ...fs.promises, readdir: async (...args) => {
    concurrent++;
    maximumConcurrent = Math.max(maximumConcurrent, concurrent);
    if (blocked) { enter(); await new Promise(resolve => { release = resolve; }); }
    try { return await fs.promises.readdir(...args); }
    finally { concurrent--; }
  } } };
  const { monitor, file } = await fixture(t, { fsApi });
  await monitor.start();
  fs.writeFileSync(file('blocked.part'), 'bytes');
  blocked = true;
  const first = monitor.scanNow();
  await entered;
  const second = monitor.scanNow();
  monitor.stop();
  blocked = false;
  release();
  await Promise.all([first, second]);
  assert.equal(maximumConcurrent, 1);
  assert.equal(monitor.getSnapshot().active, false);
  assert.equal(monitor.getSnapshot().available, false);
});

test('a disabled monitor emits no watcher error from an earlier generation after restart', async t => {
  const watchers = [];
  const { EventEmitter } = await import('node:events');
  const fsApi = { ...fs, watch: () => {
    const watcher = new EventEmitter();
    watcher.close = () => {};
    watchers.push(watcher);
    return watcher;
  } };
  const { monitor } = await fixture(t, { fsApi });
  await monitor.start();
  monitor.stop();
  await monitor.start();
  watchers[0].emit('error', new Error('stale watcher'));
  assert.equal(monitor.getSnapshot().available, true);
  assert.equal(monitor.getSnapshot().error, null);
});
