'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const PARTIAL_EXTENSION = /\.(crdownload|download|opdownload|part)$/i;
const emptySnapshot = () => ({ available: false, active: false, items: [], speedBytesPerSecond: null, lastEvent: null, error: null });

/** Browser download observation. File contents are never read or uploaded. */
class DownloadMonitor extends EventEmitter {
  constructor({ directory = path.join(os.homedir(), 'Downloads'), fsApi = fs, now = Date.now,
    debounceMs = 150, sampleIntervalMs = 1000, maxEntries = 512, maxBundleEntries = 128,
    maxBundleDepth = 4, enabled = true } = {}) {
    super();
    this.directory = directory;
    this.fs = fsApi;
    this.now = now;
    this.debounceMs = debounceMs;
    this.sampleIntervalMs = sampleIntervalMs;
    this.maxEntries = maxEntries;
    this.maxBundleEntries = maxBundleEntries;
    this.maxBundleDepth = maxBundleDepth;
    this.enabled = enabled;
    this.running = false;
    this.generation = 0;
    this.snapshot = emptySnapshot();
    this.records = new Map();
    this.scanPromise = null;
    this.scanAgain = false;
    this.initialized = false;
  }

  getSnapshot() {
    return { ...this.snapshot, items: this.snapshot.items.map(item => ({ ...item })),
      lastEvent: this.snapshot.lastEvent ? { ...this.snapshot.lastEvent } : null };
  }

  async start() {
    if (this.running || !this.enabled) return this.getSnapshot();
    this.running = true;
    this.generation++;
    const generation = this.generation;
    this.initialized = false;
    const changed = () => { if (this.running && this.generation === generation) this.scheduleScan(); };
    // macOS recursive watching catches writes inside Safari .download bundles.
    try {
      this.watcher = this.fs.watch(this.directory, { recursive: true }, changed);
    } catch (error) {
      if (error.code === 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM' || error.code === 'ERR_INVALID_ARG_VALUE') {
        try { this.watcher = this.fs.watch(this.directory, changed); }
        catch (fallbackError) { this.publish({ ...emptySnapshot(), error: String(fallbackError.message) }); }
      } else {
        this.publish({ ...emptySnapshot(), error: String(error.message) });
      }
    }
    this.watcher?.on('error', error => {
      if (this.running && this.generation === generation) this.publish({ ...this.snapshot, available: false, error: String(error.message) });
    });
    this.watcher?.unref?.();
    return this.scanNow();
  }

  stop() {
    this.running = false;
    this.generation++;
    clearTimeout(this.debounceTimer);
    clearTimeout(this.sampleTimer);
    this.debounceTimer = null;
    this.sampleTimer = null;
    this.watcher?.close();
    this.watcher = null;
    this.records.clear();
    this.initialized = false;
    this.scanAgain = false;
    this.publish(emptySnapshot());
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.stop();
    else return this.start();
    return Promise.resolve(this.getSnapshot());
  }

  publish(snapshot) {
    const changed = JSON.stringify(snapshot) !== JSON.stringify(this.snapshot);
    this.snapshot = snapshot;
    if (changed) this.emit('update', this.getSnapshot());
  }

  scheduleScan() {
    if (!this.running || this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.scanNow();
    }, this.debounceMs);
    this.debounceTimer.unref?.();
  }

  // Also useful to refresh immediately after a filesystem notification.
  async scanNow() {
    if (!this.running) return this.getSnapshot();
    if (this.scanPromise) {
      this.scanAgain = true;
      await this.scanPromise;
      if (this.running && this.scanAgain) return this.scanNow();
      return this.getSnapshot();
    }
    const generation = this.generation;
    this.scanAgain = false;
    const promise = this.scan(generation);
    this.scanPromise = promise;
    try { await promise; }
    finally {
      if (this.scanPromise === promise) this.scanPromise = null;
    }
    if (this.running && this.scanAgain) return this.scanNow();
    return this.getSnapshot();
  }

  async stamp(filename) {
    try {
      const stat = await this.fs.promises.lstat(filename);
      if (!stat.isFile()) return null;
      return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
      throw error;
    }
  }

  async bundleBytes(directory) {
    let bytes = 0;
    let remaining = this.maxBundleEntries;
    const walk = async (current, depth) => {
      if (depth > this.maxBundleDepth || remaining <= 0) return;
      const entries = await this.fs.promises.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        if (--remaining < 0) break;
        if (entry.isSymbolicLink() || entry.name === 'Info.plist' || entry.name.startsWith('.')) continue;
        const filename = path.join(current, entry.name);
        const stat = await this.fs.promises.lstat(filename);
        if (stat.isSymbolicLink()) continue;
        if (stat.isFile()) bytes += stat.size;
        else if (stat.isDirectory()) await walk(filename, depth + 1);
      }
    };
    await walk(directory, 0);
    return bytes;
  }

  async scan(generation) {
    const current = () => this.running && this.generation === generation;
    try {
      const entries = (await this.fs.promises.readdir(this.directory, { withFileTypes: true }))
        .filter(entry => PARTIAL_EXTENSION.test(entry.name) && !entry.isSymbolicLink());
      // A capped directory must not manufacture cancellation events for omitted files.
      if (entries.length > this.maxEntries) throw new Error(`Download directory exceeds ${this.maxEntries} entries`);
      const next = new Map();
      const now = this.now();
      for (const entry of entries) {
        if (!PARTIAL_EXTENSION.test(entry.name) || entry.isSymbolicLink()) continue;
        const filename = path.join(this.directory, entry.name);
        const name = entry.name.replace(PARTIAL_EXTENSION, '');
        if (!name) continue;
        let bytes;
        try {
          const stat = await this.fs.promises.lstat(filename);
          if (stat.isFile()) bytes = stat.size;
          else if (stat.isDirectory() && /\.download$/i.test(entry.name)) bytes = await this.bundleBytes(filename);
          else continue;
        } catch (error) {
          if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue;
          throw error;
        }
        const previous = this.records.get(entry.name);
        const active = previous ? previous.active || bytes > previous.bytes : this.initialized;
        const elapsed = previous ? (now - previous.at) / 1000 : 0;
        next.set(entry.name, {
          id: entry.name, name, bytes, at: now, active,
          baseline: previous ? previous.baseline : await this.stamp(path.join(this.directory, name)),
          speedBytesPerSecond: previous && elapsed > 0 && active ? Math.max(0, bytes - previous.bytes) / elapsed : null
        });
      }
      let lastEvent = this.snapshot.lastEvent;
      for (const [id, previous] of this.records) {
        if (next.has(id) || !previous.active) continue;
        const destination = await this.stamp(path.join(this.directory, previous.name));
        lastEvent = { id: `${generation}:${id}:${now}`, kind: destination && destination !== previous.baseline ? 'completed' : 'cancelled', name: previous.name, at: now };
      }
      if (!current()) return;
      this.records = next;
      this.initialized = true;
      const items = [...next.values()].filter(item => item.active).map(({ id, name, bytes, speedBytesPerSecond }) => ({ id, name, bytes, speedBytesPerSecond }));
      const speeds = items.map(item => item.speedBytesPerSecond).filter(speed => speed !== null);
      this.publish({ available: true, active: items.length > 0, items, speedBytesPerSecond: speeds.length ? speeds.reduce((sum, speed) => sum + speed, 0) : null, lastEvent, error: null });
    } catch (error) {
      if (current()) this.publish({ ...emptySnapshot(), lastEvent: this.snapshot.lastEvent, error: String(error.message) });
    } finally {
      if (current()) {
        clearTimeout(this.sampleTimer);
        this.sampleTimer = null;
        if (this.snapshot.active) {
          this.sampleTimer = setTimeout(() => { this.sampleTimer = null; void this.scanNow(); }, this.sampleIntervalMs);
          this.sampleTimer.unref?.();
        }
      }
    }
  }
}

module.exports = { DownloadMonitor };
