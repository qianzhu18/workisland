"use strict";

const MAX_ARTWORK_DATA_URL_LENGTH = 8 * 1024 * 1024;
const MAX_APP_ICON_DATA_URL_LENGTH = 512 * 1024;

const EMPTY_MEDIA_STATE = Object.freeze({
  active: false,
  playing: false,
  title: "",
  artist: "",
  album: "",
  appBundleId: "",
  appName: "",
  durationSec: 0,
  elapsedSec: 0,
  playbackRate: 0,
  artworkDataUrl: "",
  appIconDataUrl: "",
  canPlayPause: false,
  canNext: false,
  canPrevious: false,
  updatedAt: 0
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function number(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function artwork(value) {
  if (typeof value !== "string" || !value.startsWith("data:image/")) return "";
  return value.length <= MAX_ARTWORK_DATA_URL_LENGTH ? value : "";
}

function appIcon(value) {
  if (typeof value !== "string" || !value.startsWith("data:image/png;base64,")) return "";
  return value.length <= MAX_APP_ICON_DATA_URL_LENGTH ? value : "";
}

function normalizeMediaSnapshot(value = {}) {
  const durationSec = Math.max(0, number(value.durationSec));
  const elapsedSec = Math.max(0, Math.min(number(value.elapsedSec), durationSec || Number.MAX_SAFE_INTEGER));
  return {
    active: Boolean(value.active),
    playing: Boolean(value.playing),
    title: text(value.title),
    artist: text(value.artist),
    album: text(value.album),
    appBundleId: text(value.appBundleId),
    appName: text(value.appName),
    durationSec,
    elapsedSec,
    playbackRate: Math.max(0, number(value.playbackRate)),
    artworkDataUrl: artwork(value.artworkDataUrl),
    appIconDataUrl: appIcon(value.appIconDataUrl),
    canPlayPause: Boolean(value.canPlayPause ?? value.capabilities?.playPause),
    canNext: Boolean(value.canNext ?? value.capabilities?.next),
    canPrevious: Boolean(value.canPrevious ?? value.capabilities?.previous),
    updatedAt: Math.max(0, number(value.updatedAt, Date.now()))
  };
}

const APP_NAMES = Object.freeze({
  "com.apple.Music": "Apple Music",
  "com.netease.163music": "网易云音乐",
  "com.apple.podcasts": "播客",
  "com.spotify.client": "Spotify",
  "com.colliderli.iina": "IINA"
});

function normalizeAdapterPayload(payload = {}) {
  const title = text(payload.title);
  const bundleId = text(payload.bundleIdentifier || payload.parentApplicationBundleIdentifier);
  if (!title || !bundleId) return EMPTY_MEDIA_STATE;
  const mimeType = text(payload.artworkMimeType);
  const artworkData = text(payload.artworkData);
  const timestamp = Date.parse(payload.timestamp);
  const inferredName = bundleId.split(".").at(-1)?.replace(/[-_]/g, " ") || "macOS";
  return normalizeMediaSnapshot({
    active: true,
    playing: payload.playing,
    title,
    artist: payload.artist,
    album: payload.album,
    appBundleId: bundleId,
    appName: APP_NAMES[bundleId] || inferredName,
    durationSec: payload.duration,
    elapsedSec: payload.elapsedTimeNow ?? payload.elapsedTime,
    playbackRate: payload.playbackRate ?? (payload.playing ? 1 : 0),
    artworkDataUrl: mimeType.startsWith("image/") && artworkData
      ? `data:${mimeType};base64,${artworkData}` : "",
    canPlayPause: true,
    canNext: payload.prohibitsSkip !== true,
    canPrevious: payload.prohibitsSkip !== true,
    updatedAt: Number.isFinite(timestamp) ? timestamp : Date.now()
  });
}

function reduceMediaEvent(state = EMPTY_MEDIA_STATE, event = {}) {
  if (event.kind === "state") return normalizeMediaSnapshot(event.state);
  if (event.kind === "cleared" || event.kind === "unavailable") return EMPTY_MEDIA_STATE;
  return state;
}

module.exports = {
  EMPTY_MEDIA_STATE,
  MAX_APP_ICON_DATA_URL_LENGTH,
  MAX_ARTWORK_DATA_URL_LENGTH,
  normalizeAdapterPayload,
  normalizeMediaSnapshot,
  reduceMediaEvent
};
