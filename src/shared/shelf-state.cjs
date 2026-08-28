"use strict";

const crypto = require("node:crypto");

const MAX_SHELF_TEXT = 32 * 1024;

function shelfItemId(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
}

function normalizeShelfPayload(payload) {
  if (!payload || !["text", "url"].includes(payload.type) || typeof payload.value !== "string") return null;
  const value = payload.value.trim().slice(0, MAX_SHELF_TEXT);
  if (!value) return null;
  if (payload.type === "url") {
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol)) return null;
    } catch {
      return null;
    }
  }
  return {
    id: shelfItemId(`${payload.type}:${value}`),
    type: payload.type,
    value,
    name: payload.type === "url" ? value : value.split(/\r?\n/, 1)[0].slice(0, 120),
    createdAt: Date.now(),
    available: true
  };
}

module.exports = { MAX_SHELF_TEXT, normalizeShelfPayload, shelfItemId };
