import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  EMPTY_LYRICS_STATE,
  createTrackSignature,
  normalizeLyricsResponse,
  parseSyncedLyrics,
  selectActiveLyricIndex,
  signatureKey
} = require("../src/shared/lyrics-state.cjs");

test("track signatures normalize metadata without discarding CJK", () => {
  const signature = createTrackSignature({
    title: " 七里香 (Live) ",
    artist: " 周杰伦 ",
    album: "七里香",
    durationSec: 297.4
  });
  assert.deepEqual(signature, {
    title: "七里香 (live)",
    artist: "周杰伦",
    album: "七里香",
    duration: 297
  });
  assert.match(signatureKey(signature), /七里香/);
});

test("LRC parser accepts multiple timestamps and sorts bounded timed lines", () => {
  assert.deepEqual(parseSyncedLyrics("[00:02.50]第二句\n[00:01.00][00:03.00]第一句\n[offset:0]\n"), [
    { atSec: 1, text: "第一句" },
    { atSec: 2.5, text: "第二句" },
    { atSec: 3, text: "第一句" }
  ]);
});

test("active lyric follows projected playback", () => {
  const lines = [{ atSec: 1, text: "A" }, { atSec: 4, text: "B" }];
  assert.equal(selectActiveLyricIndex(lines, 0), -1);
  assert.equal(selectActiveLyricIndex(lines, 3.9), 0);
  assert.equal(selectActiveLyricIndex(lines, 4), 1);
});

test("candidate must match title artist and duration conservatively", () => {
  const wanted = createTrackSignature({ title: "七里香", artist: "周杰伦", album: "七里香", durationSec: 299 });
  const matched = normalizeLyricsResponse({
    trackName: "七里香",
    artistName: "周杰伦",
    albumName: "七里香",
    duration: 297,
    syncedLyrics: "[00:01.00]窗外的麻雀"
  }, wanted, 42);
  assert.equal(matched.status, "synced");
  assert.equal(matched.lines[0].text, "窗外的麻雀");
  assert.equal(matched.updatedAt, 42);

  const wrongVersion = normalizeLyricsResponse({
    trackName: "七里香 (Live)",
    artistName: "周杰伦",
    duration: 330,
    plainLyrics: "wrong"
  }, wanted);
  assert.deepEqual(wrongVersion, { ...EMPTY_LYRICS_STATE, status: "not-found", signature: signatureKey(wanted) });
});

test("plain and instrumental responses use explicit fallback states", () => {
  const wanted = createTrackSignature({ title: "Track", artist: "Artist", album: "Album", durationSec: 120 });
  assert.equal(normalizeLyricsResponse({ trackName: "Track", artistName: "Artist", duration: 120, plainLyrics: "Line one\nLine two" }, wanted).status, "plain");
  assert.equal(normalizeLyricsResponse({ trackName: "Track", artistName: "Artist", duration: 120, instrumental: true }, wanted).status, "instrumental");
});

test("oversized synchronized lyrics fail closed", () => {
  assert.deepEqual(parseSyncedLyrics(`[00:01]${"x".repeat(200_001)}`), []);
});
