import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const {
  EMPTY_MEDIA_STATE,
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

test("unknown media events leave state unchanged", () => {
  const state = normalizeMediaSnapshot({ active: true, title: "Keep me" });
  assert.equal(reduceMediaEvent(state, { kind: "mystery" }), state);
});
