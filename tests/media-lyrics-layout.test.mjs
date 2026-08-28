import assert from "node:assert/strict";
import test from "node:test";
import { getActiveLyricLine, getLyricsLayoutMode } from "../src/renderer/island/components/media-lyrics-layout.mjs";

test("lyrics layout grows through compact, contextual, and full modes", () => {
  assert.equal(getLyricsLayoutMode(160), "compact");
  assert.equal(getLyricsLayoutMode(240), "contextual");
  assert.equal(getLyricsLayoutMode(380), "full");
});

test("compact media keeps the current lyric visible for a single Agent", () => {
  const lines = [
    { atSec: 2, text: "first" },
    { atSec: 8, text: "current" },
    { atSec: 14, text: "next" }
  ];
  assert.equal(getActiveLyricLine(lines, 1), "first");
  assert.equal(getActiveLyricLine(lines, 10), "current");
  assert.equal(getActiveLyricLine(lines, 20), "next");
});
