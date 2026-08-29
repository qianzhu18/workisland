#!/usr/bin/env node
// Generate resources/icon.ico from resources/icon.png without external deps.
// ICO entries embed PNG data directly (supported since Windows Vista), sized
// 256/48/32/16. Run on macOS/Linux/Windows: node scripts/generate-icon-ico.mjs
// (uses `sips` on macOS and falls back to the source PNG for other platforms).

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const root = process.cwd();
const source = path.join(root, "resources", "icon.png");
const target = path.join(root, "resources", "icon.ico");
const sizes = [256, 48, 32, 16];

if (!existsSync(source)) {
  console.error(`missing ${source}`);
  process.exit(1);
}

const tmp = path.join(os.tmpdir(), `workisland-ico-${process.pid}`);
mkdirSync(tmp, { recursive: true });

function pngForSize(size) {
  if (process.platform !== "darwin") {
    console.warn(`no resizer on ${process.platform}; embedding source PNG for ${size}px`);
    return readFileSync(source);
  }
  const out = path.join(tmp, `icon-${size}.png`);
  execFileSync("sips", ["-z", String(size), String(size), source, "--out", out], { stdio: "pipe" });
  return readFileSync(out);
}

const images = sizes.map((size) => ({ size, data: pngForSize(size) }));

// ICONDIR + IONDIRENTRY layout per https://learn.microsoft.com/windows/win32/api/wingdi
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);

const entries = [];
const blobs = [];
let offset = 6 + images.length * 16;
for (const { size, data } of images) {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(data.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += data.length;
  entries.push(entry);
  blobs.push(data);
}

writeFileSync(target, Buffer.concat([header, ...entries, ...blobs]));
console.log(`wrote ${target} (${sizes.join("/")}px, ${images.length} entries)`);
