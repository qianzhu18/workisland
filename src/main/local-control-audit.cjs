"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ALLOWED_FIELDS = Object.freeze([
  "timestamp",
  "client",
  "clientVersion",
  "tool",
  "keys",
  "result",
  "errorCode",
  "changeId"
]);

function sanitizeString(value, maxLength) {
  if (typeof value !== "string") return undefined;
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}

function sanitizeRecord(record) {
  const output = {};
  for (const field of ALLOWED_FIELDS) {
    if (!(field in (record || {}))) continue;
    const value = record[field];
    if (field === "keys") {
      if (Array.isArray(value)) output.keys = value.filter((key) => typeof key === "string").slice(0, 20).map((key) => key.slice(0, 120));
    } else if (field === "timestamp" && Number.isFinite(value)) {
      output.timestamp = value;
    } else if (typeof value === "string") {
      const sanitized = sanitizeString(value, field === "client" ? 80 : 160);
      if (sanitized) output[field] = sanitized;
    }
  }
  return output;
}

class LocalControlAudit {
  constructor({ filePath, maxEntries = 100, fsModule = fs } = {}) {
    if (!filePath) throw new TypeError("LocalControlAudit requires filePath");
    this.filePath = filePath;
    this.maxEntries = Math.max(1, Math.min(1000, Math.trunc(maxEntries) || 100));
    this.fs = fsModule;
    this.entries = this.#load();
  }

  #load() {
    try {
      const parsed = JSON.parse(this.fs.readFileSync(this.filePath, "utf8"));
      if (!Array.isArray(parsed)) return [];
      return parsed.map(sanitizeRecord).filter((entry) => Object.keys(entry).length > 0).slice(-this.maxEntries);
    } catch {
      return [];
    }
  }

  append(record) {
    this.entries.push(sanitizeRecord(record));
    this.entries = this.entries.slice(-this.maxEntries);
    this.#persist();
  }

  list() {
    return JSON.parse(JSON.stringify(this.entries));
  }

  #persist() {
    const directory = path.dirname(this.filePath);
    this.fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.tmp-${process.pid}`;
    this.fs.writeFileSync(temporary, `${JSON.stringify(this.entries, null, 2)}\n`, { mode: 0o600 });
    this.fs.renameSync(temporary, this.filePath);
  }
}

module.exports = { ALLOWED_FIELDS, LocalControlAudit, sanitizeRecord };
