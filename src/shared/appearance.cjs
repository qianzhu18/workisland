"use strict";

// Island appearance contract shared by the main process, the settings
// repository, and (mirrored in ESM form) the island renderer.
//
// Security/readability model:
//   - The island's text palette is permanently light, so any customization is
//     normalized to stay dark enough to read (MAX_BACKGROUND_LUMINANCE).
//     Overly bright colors are auto-darkened and reported back as a warning
//     instead of being rejected — agents and users get a working theme either
//     way. Image backgrounds always carry a dim overlay for the same reason.
//   - imageRef is a bare filename resolved inside the app's managed
//     island-backgrounds directory; path traversal never reaches disk.

const APPEARANCE_KINDS = /* @__PURE__ */ new Set(["default", "solid", "gradient", "image"]);
const COLOR_STRING_MAX_LENGTH = 64;
const IMAGE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGBA_COLOR_PATTERN = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d{1,4})\s*)?\)$/;

const MIN_OPACITY = 0.15;
const MAX_OPACITY = 1;
const MIN_IMAGE_DIM = 0.2;
const MAX_IMAGE_DIM = 0.85;
const DEFAULT_IMAGE_DIM = 0.35;
const DEFAULT_GRADIENT_ANGLE = 135;
// Relative luminance threshold (WCAG-style sRGB luminance). Backgrounds above
// this get darkened so the always-light island text keeps contrast.
const MAX_BACKGROUND_LUMINANCE = 0.45;

const DEFAULT_ISLAND_APPEARANCE = Object.freeze({ kind: "default" });

class AppearanceValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AppearanceValidationError";
  }
}

function clampNumber(value, min, max, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function parseColorString(input) {
  if (typeof input !== "string" || input.length === 0 || input.length > COLOR_STRING_MAX_LENGTH) return null;
  const raw = input.trim();
  if (HEX_COLOR_PATTERN.test(raw)) {
    let hex = raw.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.split("").map((ch) => ch + ch).join("");
    }
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  const rgbMatch = raw.match(RGBA_COLOR_PATTERN);
  if (rgbMatch) {
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    if (r > 255 || g > 255 || b > 255) return null;
    const a = rgbMatch[4] === undefined ? 1 : Number(rgbMatch[4]);
    return { r, g, b, a };
  }
  return null;
}

function relativeLuminance({ r, g, b }) {
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function darkenToLuminance(color, maxLuminance) {
  const luminance = relativeLuminance(color);
  if (luminance <= maxLuminance || luminance === 0) return color;
  // Scale every channel by the same ratio. The ratio is applied on the raw
  // (non-linear) channels, which under-shoots the target luminance — that is
  // fine: darker than the cap is always safe, and the result stays visually
  // proportional to the original hue.
  const ratio = maxLuminance / luminance;
  return {
    r: Math.round(color.r * ratio),
    g: Math.round(color.g * ratio),
    b: Math.round(color.b * ratio),
    a: color.a
  };
}

function toHex(color) {
  const hex = (v) => v.toString(16).padStart(2, "0");
  return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
}

/**
 * Readability guardrail: keep the background dark enough for the island's
 * fixed light text. Returns the (possibly darkened) color plus a warning.
 */
function enforceReadableColor(input, label) {
  const darkened = darkenToLuminance(input, MAX_BACKGROUND_LUMINANCE);
  if (darkened !== input) {
    return {
      color: darkened,
      warning: `${label} ${toHex(input)} 过亮，已自动压暗为 ${toHex(darkened)} 以保证浅色文字可读`
    };
  }
  return { color: darkened, warning: "" };
}

function normalizeColorField(input, label, warnings) {
  const parsed = parseColorString(input);
  if (!parsed) {
    throw new AppearanceValidationError(
      `${label} 不是有效的颜色值（支持 #rgb / #rrggbb / #rrggbbaa / rgb() / rgba()）: ${String(input).slice(0, 80)}`
    );
  }
  const enforced = enforceReadableColor(parsed, label);
  if (enforced.warning) warnings.push(enforced.warning);
  return enforced.color;
}

/**
 * Normalize and validate an island appearance object.
 *
 * Throws AppearanceValidationError on structurally invalid input (bad kind,
 * unparseable color, missing image ref, …). Callers that prefer a silent
 * fallback (e.g. loading a persisted settings file) should catch and use
 * DEFAULT_ISLAND_APPEARANCE instead.
 *
 * Returns { appearance, warnings }:
 *   appearance — a fresh plain object with only whitelisted fields;
 *   warnings   — human-readable strings for feedback (e.g. auto-darkening).
 */
function normalizeIslandAppearance(input) {
  if (input === undefined || input === null) {
    return { appearance: { ...DEFAULT_ISLAND_APPEARANCE }, warnings: [] };
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new AppearanceValidationError("islandAppearance 必须是对象");
  }
  const kind = input.kind ?? "default";
  if (!APPEARANCE_KINDS.has(kind)) {
    throw new AppearanceValidationError(`未知的背景类型: ${String(kind).slice(0, 40)}（可选 default | solid | gradient | image）`);
  }
  if (kind === "default") {
    return { appearance: { kind: "default" }, warnings: [] };
  }
  const warnings = [];
  const opacity = clampNumber(input.opacity, MIN_OPACITY, MAX_OPACITY, MAX_OPACITY);

  if (kind === "image") {
    const imageRef = typeof input.imageRef === "string" ? input.imageRef.trim() : "";
    if (!IMAGE_REF_PATTERN.test(imageRef)) {
      throw new AppearanceValidationError("image 模式需要合法的 imageRef（仅文件名，不允许路径）");
    }
    return {
      appearance: {
        kind,
        imageRef,
        imageDim: round2(clampNumber(input.imageDim, MIN_IMAGE_DIM, MAX_IMAGE_DIM, DEFAULT_IMAGE_DIM))
      },
      warnings
    };
  }

  const color = normalizeColorField(input.color, "color", warnings);
  const baseOpacity = Math.min(opacity, color.a);
  const appearance = {
    kind,
    color: toHex(color),
    opacity: round2(baseOpacity)
  };
  if (kind === "gradient") {
    const color2 = normalizeColorField(input.color2, "color2", warnings);
    appearance.color2 = toHex(color2);
    appearance.opacity = round2(Math.min(baseOpacity, color2.a));
    appearance.angle = Math.round(clampNumber(input.angle, 0, 360, DEFAULT_GRADIENT_ANGLE));
  }
  return { appearance, warnings };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Compile a normalized appearance into a CSS `background` value for the
 * island element. imageDataUrl is supplied by the renderer for image mode
 * (loaded through IPC); solid/gradient opacity is folded into rgba() so the
 * morphing shape keeps its text fully opaque.
 */
function islandAppearanceToBackgroundCss(appearance, imageDataUrl) {
  const normalized = appearance?.kind ? appearance : DEFAULT_ISLAND_APPEARANCE;
  if (normalized.kind === "image") {
    const dim = normalized.imageDim ?? DEFAULT_IMAGE_DIM;
    const dimLayer = `linear-gradient(rgba(0,0,0,${round2(dim)}), rgba(0,0,0,${round2(dim)}))`;
    if (imageDataUrl) {
      return `${dimLayer}, url("${imageDataUrl}") center / cover no-repeat`;
    }
    return `${dimLayer}, #000`;
  }
  if (normalized.kind === "solid" || normalized.kind === "gradient") {
    const parsed = parseColorString(normalized.color);
    if (parsed) {
      const first = `rgba(${parsed.r},${parsed.g},${parsed.b},${normalized.opacity ?? 1})`;
      if (normalized.kind === "solid") return first;
      const second = parseColorString(normalized.color2);
      if (second) {
        const secondColor = `rgba(${second.r},${second.g},${second.b},${normalized.opacity ?? 1})`;
        return `linear-gradient(${normalized.angle ?? DEFAULT_GRADIENT_ANGLE}deg, ${first}, ${secondColor})`;
      }
    }
  }
  return "#000";
}

module.exports = {
  APPEARANCE_KINDS,
  DEFAULT_ISLAND_APPEARANCE,
  MIN_OPACITY,
  MAX_OPACITY,
  MIN_IMAGE_DIM,
  MAX_IMAGE_DIM,
  DEFAULT_IMAGE_DIM,
  DEFAULT_GRADIENT_ANGLE,
  MAX_BACKGROUND_LUMINANCE,
  AppearanceValidationError,
  parseColorString,
  relativeLuminance,
  darkenToLuminance,
  normalizeIslandAppearance,
  islandAppearanceToBackgroundCss
};
