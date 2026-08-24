"use strict";

const crypto = require("node:crypto");

const MAX_CLIPBOARD_TEXT = 128 * 1024;
const MAX_CLIPBOARD_IMAGE_DATA_URL = 3 * 1024 * 1024;

function entryFingerprint(type, value) {
  return crypto.createHash("sha256").update(`${type}\0${value}`).digest("hex");
}

function normalizeClipboardCapture(capture) {
  if (!capture || typeof capture !== "object") return null;
  const createdAt = Number.isFinite(capture.createdAt) ? capture.createdAt : Date.now();
  if (capture.type === "text" || capture.type === "url" || capture.type === "code") {
    if (typeof capture.text !== "string" || !capture.text || capture.text.length > MAX_CLIPBOARD_TEXT) return null;
    const text = capture.text;
    const fingerprint = entryFingerprint(capture.type, text);
    return { id: fingerprint.slice(0, 24), type: capture.type, text, createdAt, favorite: false, fingerprint };
  }
  if (capture.type === "image") {
    const dataUrl = capture.dataUrl;
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,") || dataUrl.length > MAX_CLIPBOARD_IMAGE_DATA_URL) return null;
    const fingerprint = entryFingerprint("image", dataUrl);
    return { id: fingerprint.slice(0, 24), type: "image", dataUrl, createdAt, favorite: false, fingerprint };
  }
  if (capture.type === "files" && Array.isArray(capture.paths)) {
    const paths = [...new Set(capture.paths.filter((value) => typeof value === "string" && value.length > 0 && value.length <= 4096))].slice(0, 50);
    if (!paths.length) return null;
    const fingerprint = entryFingerprint("files", paths.join("\0"));
    return { id: fingerprint.slice(0, 24), type: "files", paths, createdAt, favorite: false, fingerprint };
  }
  return null;
}

function reduceClipboardHistory(entries, event, { limit = 100 } = {}) {
  const current = Array.isArray(entries) ? entries : [];
  if (event?.type !== "capture" || !event.entry || event.selfWrite) return current;
  if (current[0]?.fingerprint === event.entry.fingerprint) return current;
  return [event.entry, ...current.filter((entry) => entry.fingerprint !== event.entry.fingerprint)].slice(0, limit);
}

function expireClipboardEntries(entries, now = Date.now(), retentionHours = 24) {
  if (retentionHours === 0) return [...entries];
  const cutoff = now - retentionHours * 60 * 60 * 1000;
  return entries.filter((entry) => entry.favorite || entry.createdAt >= cutoff);
}

module.exports = {
  MAX_CLIPBOARD_IMAGE_DATA_URL,
  MAX_CLIPBOARD_TEXT,
  expireClipboardEntries,
  normalizeClipboardCapture,
  reduceClipboardHistory
};
