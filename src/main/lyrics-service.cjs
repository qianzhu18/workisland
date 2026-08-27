"use strict";

const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const {
  EMPTY_LYRICS_STATE,
  createTrackSignature,
  normalizeLyricsResponse,
  signatureKey
} = require("../shared/lyrics-state.cjs");

const API_ROOT = "https://lrclib.net/api";
const USER_AGENT = "WorkIsland/3.0.0 (https://github.com/qianzhu18/workisland)";
const POSITIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const MAX_RESPONSE_BYTES = 256 * 1024;

class LyricsService extends EventEmitter {
  constructor({
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    storePath = "",
    requestTimeoutMs = 6_000,
    minRequestIntervalMs = 300
  } = {}) {
    super();
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.storePath = storePath;
    this.requestTimeoutMs = requestTimeoutMs;
    this.minRequestIntervalMs = minRequestIntervalMs;
    this.enabled = false;
    this.state = EMPTY_LYRICS_STATE;
    this.cache = new Map();
    this.requestId = 0;
    this.controller = null;
    this.lastRequestAt = 0;
    this.#loadCache();
  }

  snapshot() {
    return this.state;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this.requestId += 1;
      this.controller?.abort();
      this.controller = null;
      this.#publish(EMPTY_LYRICS_STATE);
    }
  }

  async setTrack(track = {}) {
    if (!this.enabled || !track.active) {
      if (!track.active) this.#publish(EMPTY_LYRICS_STATE);
      return this.state;
    }
    const signature = createTrackSignature(track);
    const key = signatureKey(signature);
    if (!signature.title || !signature.artist) {
      this.#publish({ ...EMPTY_LYRICS_STATE, status: "not-found", signature: key });
      return this.state;
    }
    if (key === this.state.signature && ["loading", "synced", "plain", "instrumental", "not-found"].includes(this.state.status)) {
      return this.state;
    }

    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) {
      cached.lastUsedAt = this.now();
      this.#publish(cached.state);
      return this.state;
    }
    if (cached) this.cache.delete(key);

    const requestId = ++this.requestId;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.#publish({ ...EMPTY_LYRICS_STATE, status: "loading", signature: key, updatedAt: this.now() });

    try {
      const exact = await this.#lookup("get", signature, controller);
      let candidates = exact.status === 404 ? null : [exact.body];
      if (candidates === null) {
        const search = await this.#lookup("search", signature, controller);
        candidates = search.status === 200 && Array.isArray(search.body) ? search.body : [];
      }
      if (requestId !== this.requestId) return this.state;
      const matched = candidates
        .map((candidate) => normalizeLyricsResponse(candidate, signature, this.now()))
        .find((candidate) => candidate.status !== "not-found")
        ?? { ...EMPTY_LYRICS_STATE, status: "not-found", signature: key };
      this.#publish(matched);
      await this.#cache(key, matched);
    } catch (error) {
      if (requestId !== this.requestId || error?.name === "AbortError") return this.state;
      this.#publish({ ...EMPTY_LYRICS_STATE, status: "unavailable", signature: key, updatedAt: this.now() });
    } finally {
      if (requestId === this.requestId) this.controller = null;
    }
    return this.state;
  }

  async clearCache() {
    this.cache.clear();
    if (this.storePath) {
      try { await fs.promises.rm(this.storePath, { force: true }); } catch {}
    }
    return true;
  }

  dispose() {
    this.requestId += 1;
    this.controller?.abort();
    this.controller = null;
  }

  async #lookup(endpoint, signature, controller) {
    const { signal } = controller;
    const elapsed = this.now() - this.lastRequestAt;
    if (elapsed < this.minRequestIntervalMs) {
      await new Promise((resolve) => setTimeout(resolve, this.minRequestIntervalMs - elapsed));
    }
    if (signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    const url = new URL(`${API_ROOT}/${endpoint}`);
    url.searchParams.set("track_name", signature.title);
    url.searchParams.set("artist_name", signature.artist);
    if (signature.album) url.searchParams.set("album_name", signature.album);
    if (signature.duration) url.searchParams.set("duration", String(signature.duration));
    this.lastRequestAt = this.now();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(url, { signal, headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
      if (response.status === 404) return { status: 404, body: null };
      if (!response.ok) throw new Error(`lyrics http ${response.status}`);
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("lyrics response too large");
      return { status: response.status, body: JSON.parse(text) };
    } finally {
      clearTimeout(timeout);
    }
  }

  #publish(next) {
    this.state = next;
    this.emit("update", next);
  }

  async #cache(key, state) {
    const now = this.now();
    const ttl = state.status === "not-found" ? MISS_TTL_MS : POSITIVE_TTL_MS;
    this.cache.set(key, { state, expiresAt: now + ttl, lastUsedAt: now });
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = [...this.cache].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)[0]?.[0];
      if (!oldest) break;
      this.cache.delete(oldest);
    }
    await this.#saveCache();
  }

  #loadCache() {
    if (!this.storePath) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.storePath, "utf8"));
      for (const [key, value] of Array.isArray(parsed?.entries) ? parsed.entries : []) {
        if (value?.expiresAt > this.now() && value?.state?.signature === key) this.cache.set(key, value);
      }
    } catch {}
  }

  async #saveCache() {
    if (!this.storePath) return;
    const temporary = `${this.storePath}.tmp`;
    try {
      await fs.promises.mkdir(path.dirname(this.storePath), { recursive: true });
      await fs.promises.writeFile(temporary, JSON.stringify({ version: 1, entries: [...this.cache] }), { mode: 0o600 });
      await fs.promises.rename(temporary, this.storePath);
    } catch {
      try { await fs.promises.rm(temporary, { force: true }); } catch {}
    }
  }
}

module.exports = { LyricsService };
