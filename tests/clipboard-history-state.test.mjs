import assert from "node:assert/strict";
import test from "node:test";
import {
  expireClipboardEntries,
  normalizeClipboardCapture,
  reduceClipboardHistory
} from "../src/shared/clipboard-history-state.cjs";

const HOUR = 60 * 60 * 1000;

function textEntry(text, createdAt) {
  return normalizeClipboardCapture({ type: "text", text, createdAt });
}

test("clipboard history deduplicates consecutive captures and self replay", () => {
  const policy = { limit: 100 };
  const first = reduceClipboardHistory([], { type: "capture", entry: textEntry("hello", 1) }, policy);
  const duplicate = reduceClipboardHistory(first, { type: "capture", entry: textEntry("hello", 2) }, policy);
  const replay = reduceClipboardHistory(duplicate, { type: "capture", entry: textEntry("hello", 3), selfWrite: true }, policy);
  assert.equal(replay.length, 1);
});

test("retention expires ordinary entries but keeps favorites", () => {
  const ordinary = textEntry("old", 1);
  const favorite = { ...textEntry("keep", 2), favorite: true };
  assert.deepEqual(expireClipboardEntries([ordinary, favorite], 25 * HOUR, 24).map((entry) => entry.text), ["keep"]);
});

test("clipboard capture rejects empty and oversized text", () => {
  assert.equal(normalizeClipboardCapture({ type: "text", text: "" }), null);
  assert.equal(normalizeClipboardCapture({ type: "text", text: "x".repeat(200_000) }), null);
});
