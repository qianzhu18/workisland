import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { LyricsService } = require("../src/main/lyrics-service.cjs");

const track = { active: true, title: "七里香", artist: "周杰伦", album: "七里香", durationSec: 297 };
const hit = { trackName: "七里香", artistName: "周杰伦", albumName: "七里香", duration: 297, syncedLyrics: "[00:01]窗外的麻雀" };

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body)
  };
}

test("lyrics service queries exact metadata once and reuses its disk cache", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workisland-lyrics-"));
  const storePath = path.join(directory, "cache.json");
  const calls = [];
  const service = new LyricsService({
    storePath,
    minRequestIntervalMs: 0,
    fetchImpl: async (url, options) => { calls.push({ url: String(url), options }); return response(200, hit); }
  });
  service.setEnabled(true);
  await service.setTrack(track);
  assert.equal(service.snapshot().status, "synced");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/get\?/);
  assert.match(calls[0].options.headers["User-Agent"], /WorkIsland/);

  await service.setTrack({ ...track, elapsedSec: 20 });
  assert.equal(calls.length, 1);
  assert.doesNotMatch(await readFile(storePath, "utf8"), /undefined/);
  service.dispose();
  await rm(directory, { recursive: true, force: true });
});

test("lyrics service falls back to search but rejects a wrong recording", async () => {
  const calls = [];
  const service = new LyricsService({
    minRequestIntervalMs: 0,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return calls.length === 1
        ? response(404, {})
        : response(200, [{ ...hit, trackName: "七里香 (Live)", duration: 330 }]);
    }
  });
  service.setEnabled(true);
  await service.setTrack(track);
  assert.equal(service.snapshot().status, "not-found");
  assert.equal(calls.length, 2);
});

test("stale responses cannot replace lyrics for a newer track", async () => {
  const pending = [];
  const service = new LyricsService({
    minRequestIntervalMs: 0,
    fetchImpl: (_url, { signal }) => new Promise((resolve) => pending.push({ resolve, signal }))
  });
  service.setEnabled(true);
  const first = service.setTrack(track);
  await new Promise((resolve) => setImmediate(resolve));
  const secondTrack = { active: true, title: "海阔天空", artist: "Beyond", durationSec: 326 };
  const second = service.setTrack(secondTrack);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve(response(200, { trackName: "海阔天空", artistName: "Beyond", duration: 326, plainLyrics: "今天我" }));
  await second;
  pending[0].resolve(response(200, hit));
  await first;
  assert.equal(service.snapshot().status, "plain");
  assert.match(service.snapshot().signature, /海阔天空/);
  service.dispose();
});

test("disabled lyrics service never sends track metadata", async () => {
  let calls = 0;
  const service = new LyricsService({ fetchImpl: async () => { calls += 1; return response(200, hit); } });
  await service.setTrack(track);
  assert.equal(calls, 0);
  assert.equal(service.snapshot().status, "idle");
});
