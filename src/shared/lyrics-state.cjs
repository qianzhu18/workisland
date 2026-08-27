"use strict";

const MAX_LYRICS_LENGTH = 200_000;
const MAX_LINE_LENGTH = 500;
const MAX_LINES = 600;

const EMPTY_LYRICS_STATE = Object.freeze({
  status: "idle",
  signature: "",
  lines: [],
  plainText: "",
  updatedAt: 0
});

function normalizeText(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase()
    : "";
}

function createTrackSignature(value = {}) {
  return {
    title: normalizeText(value.title ?? value.trackName),
    artist: normalizeText(value.artist ?? value.artistName),
    album: normalizeText(value.album ?? value.albumName),
    duration: Math.max(0, Math.round(Number(value.durationSec ?? value.duration) || 0))
  };
}

function signatureKey(value = {}) {
  const signature = createTrackSignature(value);
  return [signature.title, signature.artist, signature.album, signature.duration].join("\u241f");
}

function parseSyncedLyrics(value) {
  if (typeof value !== "string" || value.length > MAX_LYRICS_LENGTH) return [];
  const result = [];
  for (const rawLine of value.split(/\r?\n/)) {
    if (result.length >= MAX_LINES) break;
    const timestamps = [...rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!timestamps.length) continue;
    const lyric = rawLine.replace(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g, "").trim();
    if (!lyric || lyric.length > MAX_LINE_LENGTH) continue;
    for (const timestamp of timestamps) {
      if (result.length >= MAX_LINES) break;
      const fraction = timestamp[3]
        ? Number(timestamp[3]) / (10 ** timestamp[3].length)
        : 0;
      result.push({
        atSec: Number(timestamp[1]) * 60 + Number(timestamp[2]) + fraction,
        text: lyric
      });
    }
  }
  return result.sort((a, b) => a.atSec - b.atSec);
}

function selectActiveLyricIndex(lines, elapsedSec) {
  if (!Array.isArray(lines) || !lines.length) return -1;
  const elapsed = Number(elapsedSec) || 0;
  let low = 0;
  let high = lines.length - 1;
  let result = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle].atSec <= elapsed) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

function terminalState(status, wanted, now = Date.now(), extra = {}) {
  return {
    ...EMPTY_LYRICS_STATE,
    status,
    signature: signatureKey(wanted),
    updatedAt: now,
    ...extra
  };
}

function normalizePlainLyrics(value) {
  if (typeof value !== "string" || value.length > MAX_LYRICS_LENGTH) return "";
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > MAX_LINES || lines.some((line) => line.length > MAX_LINE_LENGTH)) return "";
  return lines.join("\n");
}

function normalizeLyricsResponse(payload = {}, wanted = {}, now = Date.now()) {
  const expected = createTrackSignature(wanted);
  const candidate = createTrackSignature(payload);
  const metadataMatches = Boolean(expected.title && expected.artist)
    && candidate.title === expected.title
    && candidate.artist === expected.artist
    && (!expected.duration || !candidate.duration || Math.abs(candidate.duration - expected.duration) <= 3);
  if (!metadataMatches) return terminalState("not-found", expected, 0);
  if (payload.instrumental === true) return terminalState("instrumental", expected, now);

  const lines = parseSyncedLyrics(payload.syncedLyrics);
  if (lines.length) return terminalState("synced", expected, now, { lines });

  const plainText = normalizePlainLyrics(payload.plainLyrics);
  if (plainText) return terminalState("plain", expected, now, { plainText });
  return terminalState("not-found", expected, 0);
}

module.exports = {
  EMPTY_LYRICS_STATE,
  MAX_LINES,
  MAX_LINE_LENGTH,
  MAX_LYRICS_LENGTH,
  createTrackSignature,
  normalizeLyricsResponse,
  parseSyncedLyrics,
  selectActiveLyricIndex,
  signatureKey
};
