// Island appearance theme compilation (renderer side).
//
// The main process normalizes and persists islandAppearance (see
// src/shared/appearance.cjs for the authoritative validation, including the
// readability darkening guardrail). This module only compiles the already-
// normalized shape into the CSS custom property consumed by .island, and
// loads managed background images through IPC as data URLs (the island CSP
// only allows data:/blob: image sources).

const DEFAULT_IMAGE_DIM = 0.35;

export const DEFAULT_ISLAND_APPEARANCE = Object.freeze({ kind: "default" });

function hexToRgb(hex) {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((ch) => ch + ch).join("") : raw;
  if (full.length < 6) return null;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16)
  };
}

export function islandBackgroundCss(appearance, imageDataUrl) {
  const theme = appearance?.kind ? appearance : DEFAULT_ISLAND_APPEARANCE;
  if (theme.kind === "image") {
    const dim = Math.round((theme.imageDim ?? DEFAULT_IMAGE_DIM) * 100) / 100;
    const dimLayer = `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim}))`;
    return imageDataUrl
      ? `${dimLayer}, url("${imageDataUrl}") center / cover no-repeat`
      : `${dimLayer}, #000`;
  }
  if (theme.kind === "solid" || theme.kind === "gradient") {
    const opacity = theme.opacity ?? 1;
    const first = hexToRgb(theme.color);
    if (first) {
      const firstColor = `rgba(${first.r},${first.g},${first.b},${opacity})`;
      if (theme.kind === "solid") return firstColor;
      const second = hexToRgb(theme.color2);
      if (second) {
        const secondColor = `rgba(${second.r},${second.g},${second.b},${opacity})`;
        return `linear-gradient(${theme.angle ?? 135}deg, ${firstColor}, ${secondColor})`;
      }
    }
  }
  return "#000";
}

/**
 * Resolve the final --island-bg value for a normalized appearance. Image
 * mode fetches the managed file through the preload bridge; any failure
 * falls back to the dimmed black default instead of breaking the island.
 */
export async function resolveIslandBackground(appearance, getImageDataUrl) {
  if (appearance?.kind === "image" && typeof getImageDataUrl === "function") {
    try {
      const dataUrl = await getImageDataUrl(appearance.imageRef);
      return islandBackgroundCss(appearance, typeof dataUrl === "string" ? dataUrl : undefined);
    } catch {
      // fall through to the no-image rendering
    }
  }
  return islandBackgroundCss(appearance);
}

/**
 * Apply an appearance to the document root. `appearance === undefined` or
 * kind "default" restores the classic opaque black island.
 */
export async function applyIslandAppearance(appearance, getImageDataUrl) {
  const rootStyle = document.documentElement.style;
  const theme = appearance?.kind && appearance.kind !== "default" ? appearance : null;
  if (!theme) {
    rootStyle.removeProperty("--island-bg");
    return "#000";
  }
  const css = await resolveIslandBackground(theme, getImageDataUrl);
  rootStyle.setProperty("--island-bg", css);
  return css;
}
