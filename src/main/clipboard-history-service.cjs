"use strict";

const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  expireClipboardEntries,
  normalizeClipboardCapture,
  reduceClipboardHistory
} = require("../shared/clipboard-history-state.cjs");

class ClipboardHistoryService extends EventEmitter {
  constructor({ storePath, clipboardAdapter, pollIntervalMs = 750, fsApi = fs } = {}) {
    super();
    if (!storePath) throw new Error("Clipboard history store path is required");
    if (!clipboardAdapter) throw new Error("Clipboard adapter is required");
    this.storePath = storePath;
    this.clipboard = clipboardAdapter;
    this.pollIntervalMs = Math.max(250, pollIntervalMs);
    this.fs = fsApi;
    this.items = [];
    this.enabled = false;
    this.policy = { limit: 100, retentionHours: 24 };
    this.timer = null;
    this.selfWriteFingerprint = "";
  }

  async start() {
    await this.fs.mkdir(path.dirname(this.storePath), { recursive: true });
    try {
      const parsed = JSON.parse(await this.fs.readFile(this.storePath, "utf8"));
      this.items = Array.isArray(parsed?.items) ? parsed.items : [];
    } catch (error) {
      if (error?.code !== "ENOENT") await this.fs.rename(this.storePath, `${this.storePath}.corrupt-${Date.now()}`).catch(() => {});
      this.items = [];
      await this.persist();
    }
    this.items = expireClipboardEntries(this.items, Date.now(), this.policy.retentionHours).slice(0, this.policy.limit);
    return this.snapshot();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    } else if (this.enabled && !this.timer) {
      this.timer = setInterval(() => this.captureNow().catch(() => {}), this.pollIntervalMs);
      this.timer.unref?.();
    }
  }

  isMonitoring() { return this.enabled; }

  setPolicy({ limit, retentionHours } = {}) {
    if ([25, 50, 100, 250].includes(limit)) this.policy.limit = limit;
    if ([0, 1, 8, 24, 168].includes(retentionHours)) this.policy.retentionHours = retentionHours;
  }

  snapshot() {
    return { items: this.items.map((entry) => ({ ...entry })), enabled: this.enabled, ...this.policy };
  }

  async captureNow() {
    if (!this.enabled) return this.snapshot();
    const capture = await this.clipboard.readSnapshot();
    const entry = normalizeClipboardCapture(capture);
    if (!entry) return this.snapshot();
    const selfWrite = entry.fingerprint === this.selfWriteFingerprint;
    if (selfWrite) this.selfWriteFingerprint = "";
    const next = reduceClipboardHistory(this.items, { type: "capture", entry, selfWrite }, this.policy);
    if (next !== this.items) {
      this.items = expireClipboardEntries(next, Date.now(), this.policy.retentionHours);
      await this.persistAndEmit();
    }
    return this.snapshot();
  }

  async replay(id) {
    const entry = this.items.find((item) => item.id === id);
    if (!entry) return false;
    this.selfWriteFingerprint = entry.fingerprint;
    await this.clipboard.writeEntry({ ...entry });
    return true;
  }

  async favorite(id, favorite = true) {
    const entry = this.items.find((item) => item.id === id);
    if (!entry) return this.snapshot();
    entry.favorite = Boolean(favorite);
    await this.persistAndEmit();
    return this.snapshot();
  }

  async remove(ids) {
    const wanted = new Set(Array.isArray(ids) ? ids : [ids]);
    this.items = this.items.filter((entry) => !wanted.has(entry.id));
    await this.persistAndEmit();
    return this.snapshot();
  }

  async clear() {
    this.items = [];
    await this.persistAndEmit();
    return this.snapshot();
  }

  search(query = "", type = "all") {
    const needle = String(query).trim().toLocaleLowerCase();
    return this.items.filter((entry) => {
      if (type !== "all" && entry.type !== type) return false;
      if (!needle) return true;
      const value = entry.text || entry.paths?.join(" ") || "";
      return value.toLocaleLowerCase().includes(needle);
    }).map((entry) => ({ ...entry }));
  }

  async persistAndEmit() {
    await this.persist();
    this.emit("update", this.snapshot());
  }

  async persist() {
    const temporaryPath = `${this.storePath}.tmp`;
    await this.fs.writeFile(temporaryPath, JSON.stringify({ version: 1, items: this.items }), { mode: 0o600 });
    await this.fs.rename(temporaryPath, this.storePath);
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { ClipboardHistoryService };
