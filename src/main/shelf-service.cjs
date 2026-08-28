"use strict";

const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const { normalizeShelfPayload, shelfItemId } = require("../shared/shelf-state.cjs");

const STORE_VERSION = 1;
const MAX_SHELF_ITEMS = 100;

class ShelfService extends EventEmitter {
  constructor({ storePath, fsApi = fs } = {}) {
    super();
    if (!storePath) throw new Error("Shelf store path is required");
    this.storePath = storePath;
    this.fs = fsApi;
    this.items = [];
  }

  async start() {
    await this.fs.mkdir(path.dirname(this.storePath), { recursive: true });
    try {
      const parsed = JSON.parse(await this.fs.readFile(this.storePath, "utf8"));
      this.items = Array.isArray(parsed?.items) ? parsed.items.slice(0, MAX_SHELF_ITEMS) : [];
    } catch (error) {
      if (error?.code !== "ENOENT") {
        const quarantine = `${this.storePath}.corrupt-${Date.now()}`;
        await this.fs.rename(this.storePath, quarantine).catch(() => {});
      }
      this.items = [];
      await this.persist();
    }
    return this.refreshAvailability();
  }

  snapshot() {
    return { version: STORE_VERSION, items: this.items.map((item) => ({ ...item })) };
  }

  async addPaths(paths) {
    const added = [];
    for (const rawPath of Array.isArray(paths) ? paths.slice(0, 50) : []) {
      if (typeof rawPath !== "string" || rawPath.length === 0 || rawPath.length > 4096) continue;
      let canonical;
      let stat;
      try {
        canonical = await this.fs.realpath(rawPath);
        stat = await this.fs.lstat(canonical);
      } catch {
        continue;
      }
      if (!stat.isFile() && !stat.isDirectory()) continue;
      const id = shelfItemId(canonical);
      const existing = this.items.find((item) => item.id === id);
      if (existing) {
        existing.available = true;
        if (!added.some((item) => item.id === id)) added.push({ ...existing });
        continue;
      }
      const item = {
        id,
        type: stat.isDirectory() ? "directory" : "file",
        path: canonical,
        name: path.basename(canonical) || canonical,
        size: stat.isFile() ? stat.size : 0,
        createdAt: Date.now(),
        available: true
      };
      this.items.unshift(item);
      added.push({ ...item });
    }
    this.items = this.items.slice(0, MAX_SHELF_ITEMS);
    if (added.length) await this.persistAndEmit();
    return added;
  }

  async addPayload(payload) {
    const item = normalizeShelfPayload(payload);
    if (!item) return null;
    const existing = this.items.find((entry) => entry.id === item.id);
    if (existing) return { ...existing };
    this.items.unshift(item);
    this.items = this.items.slice(0, MAX_SHELF_ITEMS);
    await this.persistAndEmit();
    return { ...item };
  }

  async remove(ids) {
    const wanted = new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []);
    if (!wanted.size) return this.snapshot();
    this.items = this.items.filter((item) => !wanted.has(item.id));
    await this.persistAndEmit();
    return this.snapshot();
  }

  async clear() {
    this.items = [];
    await this.persistAndEmit();
    return this.snapshot();
  }

  find(id) {
    return this.items.find((item) => item.id === id) || null;
  }

  async refreshAvailability() {
    for (const item of this.items) {
      if (!item.path) {
        item.available = true;
        continue;
      }
      try {
        await this.fs.access(item.path);
        item.available = true;
      } catch {
        item.available = false;
      }
    }
    this.emit("update", this.snapshot());
    return this.snapshot();
  }

  async persistAndEmit() {
    await this.persist();
    this.emit("update", this.snapshot());
  }

  async persist() {
    const temporaryPath = `${this.storePath}.tmp`;
    await this.fs.writeFile(temporaryPath, JSON.stringify(this.snapshot(), null, 2), { mode: 0o600 });
    await this.fs.rename(temporaryPath, this.storePath);
  }
}

module.exports = { MAX_SHELF_ITEMS, ShelfService };
