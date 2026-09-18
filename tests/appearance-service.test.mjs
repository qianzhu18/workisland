import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { createAppearanceService } = require("../src/main/appearance-service.cjs");

function pngHeader(width, height) {
  const value = Buffer.alloc(24);
  value.writeUInt32BE(0x89504e47, 0);
  value.writeUInt32BE(13, 8);
  value.write("IHDR", 12, "ascii");
  value.writeUInt32BE(width, 16);
  value.writeUInt32BE(height, 20);
  return value;
}

test("installBackgroundImageBuffer writes managed cropped image bytes", () => {
  const directory = mkdtempSync(join(tmpdir(), "wi-background-"));
  try {
    const service = createAppearanceService({ getUserDataPath: () => directory });
    const bytes = pngHeader(1480, 600);
    const installed = service.installBackgroundImageBuffer(bytes, ".png");
    assert.equal(installed.width, 1480);
    assert.deepEqual(readFileSync(join(directory, "island-backgrounds", installed.imageRef)), bytes);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("readBackgroundImagePreview validates without installing the original", () => {
  const root = mkdtempSync(join(tmpdir(), "wi-appearance-preview-"));
  try {
    const source = join(root, "source.png");
    const png = pngHeader(1480, 600);
    writeFileSync(source, png);
    const service = createAppearanceService({ getUserDataPath: () => root });
    const preview = service.readBackgroundImagePreview(source);
    assert.equal(preview.width, 1480);
    assert.equal(preview.height, 600);
    assert.match(preview.dataUrl, /^data:image\/png;base64,/);
    assert.equal(existsSync(join(root, "island-backgrounds")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("getMostRecentBackgroundImage restores the newest managed image for legacy settings", () => {
  const root = mkdtempSync(join(tmpdir(), "wi-appearance-recent-"));
  try {
    const service = createAppearanceService({ getUserDataPath: () => root });
    const older = service.installBackgroundImageBuffer(Buffer.concat([pngHeader(1480, 600), Buffer.from([1])]), ".png");
    const newer = service.installBackgroundImageBuffer(Buffer.concat([pngHeader(1480, 600), Buffer.from([2])]), ".png");
    utimesSync(join(root, "island-backgrounds", older.imageRef), new Date(1000), new Date(1000));
    utimesSync(join(root, "island-backgrounds", newer.imageRef), new Date(2000), new Date(2000));

    const recent = service.getMostRecentBackgroundImage();
    assert.equal(recent.imageRef, newer.imageRef);
    assert.match(recent.dataUrl, /^data:image\/png;base64,/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
