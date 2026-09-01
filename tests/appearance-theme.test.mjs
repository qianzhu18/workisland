import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const {
  DEFAULT_ISLAND_APPEARANCE,
  AppearanceValidationError,
  parseColorString,
  relativeLuminance,
  normalizeIslandAppearance,
  islandAppearanceToBackgroundCss
} = require("../src/shared/appearance.cjs");
const { mergeSettings } = require("../src/shared/settings.cjs");
const {
  readImageDimensions,
  classifySpriteSheet,
  validateSpriteFile,
  SPRITE_SHEET_CONTRACTS
} = require("../src/main/pet-library.cjs");

// ── 颜色解析 ─────────────────────────────────────────────────────────────────

test("parseColorString accepts hex, rgb() and rgba()", () => {
  assert.deepEqual(parseColorString("#0B1E3A"), { r: 11, g: 30, b: 58, a: 1 });
  assert.deepEqual(parseColorString("#fff"), { r: 255, g: 255, b: 255, a: 1 });
  const translucent = parseColorString("#00000080");
  assert.equal(translucent.r, 0);
  assert.ok(Math.abs(translucent.a - 0x80 / 255) < 1e-9);
  assert.deepEqual(parseColorString("rgb(1, 2, 3)"), { r: 1, g: 2, b: 3, a: 1 });
  assert.deepEqual(parseColorString("rgba(10, 20, 30, 0.5)"), { r: 10, g: 20, b: 30, a: 0.5 });
  assert.equal(parseColorString("not-a-color"), null);
  assert.equal(parseColorString("rgb(300, 0, 0)"), null);
});

test("relativeLuminance of pure black and white", () => {
  assert.equal(relativeLuminance({ r: 0, g: 0, b: 0 }), 0);
  assert.ok(relativeLuminance({ r: 255, g: 255, b: 255 }) > 0.99);
});

// ── 主题归一化 ────────────────────────────────────────────────────────────────

test("normalizeIslandAppearance keeps default and drops unknown kinds", () => {
  assert.deepEqual(normalizeIslandAppearance(undefined).appearance, { kind: "default" });
  assert.deepEqual(normalizeIslandAppearance({ kind: "default", extra: 1 }).appearance, { kind: "default" });
  assert.throws(() => normalizeIslandAppearance({ kind: "neon" }), AppearanceValidationError);
  assert.throws(() => normalizeIslandAppearance([1, 2]), AppearanceValidationError);
});

test("normalizeIslandAppearance normalizes solid themes", () => {
  const { appearance, warnings } = normalizeIslandAppearance({ kind: "solid", color: "#0B1E3A" });
  assert.deepEqual(appearance, { kind: "solid", color: "#0b1e3a", opacity: 1 });
  assert.deepEqual(warnings, []);
});

test("normalizeIslandAppearance darkens overly bright colors with a warning", () => {
  const { appearance, warnings } = normalizeIslandAppearance({ kind: "solid", color: "#FFFFFF" });
  assert.notEqual(appearance.color, "#ffffff");
  assert.ok(relativeLuminance(parseColorString(appearance.color)) <= 0.45 + 1e-6);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes("压暗"));
});

test("normalizeIslandAppearance clamps opacity and folds color alpha", () => {
  const clamped = normalizeIslandAppearance({ kind: "solid", color: "#101010", opacity: 0.01 });
  assert.equal(clamped.appearance.opacity, 0.15);
  const folded = normalizeIslandAppearance({ kind: "solid", color: "rgba(16,16,16,0.5)" });
  assert.equal(folded.appearance.opacity, 0.5);
});

test("normalizeIslandAppearance gradient requires both colors and clamps angle", () => {
  const { appearance } = normalizeIslandAppearance({
    kind: "gradient", color: "#1F1330", color2: "#0B0716", angle: 999
  });
  assert.equal(appearance.angle, 360);
  assert.equal(appearance.color2, "#0b0716");
  assert.throws(
    () => normalizeIslandAppearance({ kind: "gradient", color: "#111111" }),
    AppearanceValidationError
  );
});

test("normalizeIslandAppearance image mode validates ref and clamps dim", () => {
  const { appearance } = normalizeIslandAppearance({ kind: "image", imageRef: "bg-abc123.png", imageDim: 0 });
  assert.equal(appearance.imageRef, "bg-abc123.png");
  assert.equal(appearance.imageDim, 0.2);
  assert.throws(() => normalizeIslandAppearance({ kind: "image" }), AppearanceValidationError);
  assert.throws(
    () => normalizeIslandAppearance({ kind: "image", imageRef: "../escape.png" }),
    AppearanceValidationError
  );
});

// ── CSS 编译 ─────────────────────────────────────────────────────────────────

test("islandAppearanceToBackgroundCss compiles each kind", () => {
  assert.equal(islandAppearanceToBackgroundCss({ kind: "default" }), "#000");
  assert.equal(
    islandAppearanceToBackgroundCss({ kind: "solid", color: "#0b1e3a", opacity: 0.5 }),
    "rgba(11,30,58,0.5)"
  );
  assert.equal(
    islandAppearanceToBackgroundCss({ kind: "gradient", color: "#1f1330", color2: "#0b0716", angle: 135, opacity: 1 }),
    "linear-gradient(135deg, rgba(31,19,48,1), rgba(11,7,22,1))"
  );
  const image = islandAppearanceToBackgroundCss({ kind: "image", imageDim: 0.4 }, "data:image/png;base64,AAA");
  assert.ok(image.startsWith("linear-gradient(rgba(0,0,0,0.4)"));
  assert.ok(image.includes('url("data:image/png;base64,AAA")'));
  const noImage = islandAppearanceToBackgroundCss({ kind: "image", imageDim: 0.35 });
  assert.equal(noImage, "linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.35)), #000");
});

// ── settings 集成 ────────────────────────────────────────────────────────────

test("mergeSettings persists normalized appearance and falls back on corruption", () => {
  const merged = mergeSettings({ islandAppearance: { kind: "solid", color: "#0B1E3A", opacity: 9 } });
  assert.deepEqual(merged.islandAppearance, { kind: "solid", color: "#0b1e3a", opacity: 1 });
  const broken = mergeSettings({ islandAppearance: { kind: "solid", color: "nope" } });
  assert.deepEqual(broken.islandAppearance, { ...DEFAULT_ISLAND_APPEARANCE });
  const fresh = mergeSettings({});
  assert.deepEqual(fresh.islandAppearance, { kind: "default" });
});

// ── 精灵图几何 ────────────────────────────────────────────────────────────────

function pngHeaderBuffer(width, height) {
  const buf = Buffer.alloc(24);
  buf.writeUInt32BE(0x89504e47, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

test("readImageDimensions parses PNG headers and classifies sheet protocols", () => {
  assert.deepEqual(readImageDimensions(pngHeaderBuffer(1536, 2288), ".png"), { width: 1536, height: 2288 });
  assert.equal(classifySpriteSheet(1536, 2288).protocol, "codex-v2");
  assert.equal(classifySpriteSheet(1024, 896).protocol, "orca-v1");
  assert.equal(classifySpriteSheet(512, 512).protocol, null);
  assert.equal(SPRITE_SHEET_CONTRACTS["codex-v2"].cellWidth, 192);
});

test("validateSpriteFile accepts protocol-sized PNG and rejects wrong sizes", () => {
  const dir = mkdtempSync(join(tmpdir(), "wi-sprite-"));
  try {
    const good = join(dir, "good.png");
    writeFileSync(good, pngHeaderBuffer(1536, 2288));
    const accepted = validateSpriteFile(good);
    assert.equal(accepted.ok, true);
    assert.equal(accepted.protocol, "codex-v2");

    const bad = join(dir, "bad.png");
    writeFileSync(bad, pngHeaderBuffer(1024, 1024));
    const rejected = validateSpriteFile(bad);
    assert.equal(rejected.ok, false);
    assert.ok(rejected.message.includes("1536×2288"));

    assert.equal(validateSpriteFile(join(dir, "missing.png")).ok, false);
    assert.equal(validateSpriteFile(good.replace(/\.png$/, ".txt")).ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
