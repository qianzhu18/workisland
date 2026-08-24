import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const {
  EMPTY_MEDIA_STATE,
  normalizeAdapterPayload,
  normalizeMediaSnapshot,
  reduceMediaEvent
} = require("../src/shared/media-state.cjs");

test("media snapshots normalize playback metadata and clamp progress", () => {
  const state = normalizeMediaSnapshot({
    active: true,
    playing: true,
    title: "  Midnight City  ",
    artist: "M83",
    durationSec: 120,
    elapsedSec: 150,
    playbackRate: 1,
    appBundleId: "com.apple.Music",
    appName: "Music",
    capabilities: { playPause: true, next: true, previous: false },
    updatedAt: 42
  });

  assert.equal(state.title, "Midnight City");
  assert.equal(state.elapsedSec, 120);
  assert.equal(state.canPlayPause, true);
  assert.equal(state.canNext, true);
  assert.equal(state.canPrevious, false);
  assert.equal(state.updatedAt, 42);
});

test("paused media remains active until the system clears the session", () => {
  const playing = normalizeMediaSnapshot({ active: true, playing: true, title: "Track" });
  const paused = reduceMediaEvent(playing, { kind: "state", state: { ...playing, playing: false } });
  assert.equal(paused.active, true);
  assert.equal(paused.playing, false);

  const cleared = reduceMediaEvent(paused, { kind: "cleared" });
  assert.deepEqual(cleared, EMPTY_MEDIA_STATE);
});

test("invalid or oversized artwork is discarded", () => {
  const invalid = normalizeMediaSnapshot({ active: true, artworkDataUrl: "https://example.com/cover.png" });
  const oversized = normalizeMediaSnapshot({ active: true, artworkDataUrl: `data:image/png;base64,${"a".repeat(8 * 1024 * 1024 + 1)}` });
  assert.equal(invalid.artworkDataUrl, "");
  assert.equal(oversized.artworkDataUrl, "");
});

test("media application icons accept only bounded PNG data URLs", () => {
  const valid = normalizeMediaSnapshot({
    active: true,
    appIconDataUrl: "data:image/png;base64,aWNvbg=="
  });
  assert.equal(valid.appIconDataUrl, "data:image/png;base64,aWNvbg==");
  assert.equal(normalizeMediaSnapshot({ appIconDataUrl: "data:image/jpeg;base64,aWNvbg==" }).appIconDataUrl, "");
  assert.equal(normalizeMediaSnapshot({ appIconDataUrl: "https://example.com/icon.png" }).appIconDataUrl, "");
  assert.equal(normalizeMediaSnapshot({ appIconDataUrl: `data:image/png;base64,${"a".repeat(512 * 1024)}` }).appIconDataUrl, "");
});

test("unknown media events leave state unchanged", () => {
  const state = normalizeMediaSnapshot({ active: true, title: "Keep me" });
  assert.equal(reduceMediaEvent(state, { kind: "mystery" }), state);
});

test("MediaRemote Adapter payload becomes a renderable media snapshot", () => {
  const state = normalizeAdapterPayload({
    bundleIdentifier: "com.apple.Music",
    playing: true,
    title: "The Genesis",
    artist: "Nas",
    album: "Illmatic",
    duration: 105.368,
    elapsedTime: 32.617,
    playbackRate: 1,
    timestamp: "2026-08-24T10:00:00.000Z",
    artworkMimeType: "image/jpeg",
    artworkData: "YWJj"
  });

  assert.equal(state.active, true);
  assert.equal(state.title, "The Genesis");
  assert.equal(state.appName, "Apple Music");
  assert.equal(state.durationSec, 105.368);
  assert.equal(state.elapsedSec, 32.617);
  assert.equal(state.artworkDataUrl, "data:image/jpeg;base64,YWJj");
  assert.equal(state.canPlayPause, true);
});

test("NetEase media uses its recognizable product name", () => {
  const state = normalizeAdapterPayload({
    bundleIdentifier: "com.netease.163music",
    playing: true,
    title: "Going Down"
  });
  assert.equal(state.appName, "网易云音乐");
});

test("an empty MediaRemote Adapter payload clears an ended session", () => {
  assert.deepEqual(normalizeAdapterPayload({}), EMPTY_MEDIA_STATE);
});
