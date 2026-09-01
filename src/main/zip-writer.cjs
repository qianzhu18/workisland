"use strict";

// Minimal store-only (uncompressed) ZIP writer for template export.
//
// Template packages ship SVG/PNG/WebP assets that are already compressed or
// tiny, so stored entries keep the format dependency-free while remaining
// valid zips for every standard tool (unzip, Archive Utility, Python,
// jszip…). CRC-32 + local headers + central directory per APPNOTE.TXT.

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { time, day };
}

/**
 * Write a store-only zip. `files` is [{ name, data: Buffer }]; names use "/"
 * separators and must not be absolute or traverse upwards.
 * Returns the sha256 hex of the written archive.
 */
function writeStoreOnlyZip(zipPath, files) {
  const entries = [];
  for (const file of files) {
    const name = String(file.name);
    if (!name || name.startsWith("/") || name.split("/").includes("..")) {
      throw new Error(`非法的 zip 条目名: ${name}`);
    }
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const { time, day } = dosDateTime();
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    entries.push({ nameBuf, data, crc: crc32(data), time, day, local, offset: 0 });
  }

  const parts = [];
  let offset = 0;
  for (const entry of entries) {
    entry.offset = offset;
    parts.push(entry.local, entry.nameBuf, entry.data);
    offset += entry.local.length + entry.nameBuf.length + entry.data.length;
  }

  const centralStart = offset;
  for (const entry of entries) {
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10); // store
    central.writeUInt16LE(entry.time, 12);
    central.writeUInt16LE(entry.day, 14);
    central.writeUInt32LE(entry.crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(entry.nameBuf.length, 28);
    // extra / comment / disk / attrs all zero
    central.writeUInt32LE(entry.offset, 42);
    parts.push(central, entry.nameBuf);
    offset += central.length + entry.nameBuf.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(offset - centralStart, 12);
  end.writeUInt32LE(centralStart, 16);
  parts.push(end);

  const zip = Buffer.concat(parts);
  fs.mkdirSync(path.dirname(path.resolve(zipPath)), { recursive: true });
  fs.writeFileSync(zipPath, zip);
  return createHash("sha256").update(zip).digest("hex");
}

/**
 * Read entries of a store-only zip. Throws on deflate entries with a clear
// message (downloads validate before install; authors exporting via this
// module always produce stored zips).
 */
function readStoreOnlyZip(zipPath) {
  const buf = fs.readFileSync(zipPath);
  // Locate the end-of-central-directory record (scan back for the signature).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65536; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("不是有效的 zip 文件（缺少中央目录结束记录）");
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error("zip 中央目录损坏");
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (method !== 0) throw new Error(`zip 条目使用了压缩（method=${method}）；仅支持 store（无压缩）zip`);
    // Read the data via the local header (name lengths may differ).
    const localNameLength = buf.readUInt16LE(localOffset + 26);
    const localExtraLength = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.push({ name, data: buf.subarray(dataStart, dataStart + compressedSize) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

module.exports = { writeStoreOnlyZip, readStoreOnlyZip, crc32 };
