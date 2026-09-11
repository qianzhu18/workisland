// Island appearance theme compilation (renderer side).
//
// The main process normalizes and persists islandAppearance (see
// src/shared/appearance.cjs for the authoritative validation, including the
// readability validation). This module compiles the already-
// normalized shape into background CSS plus an adaptive foreground profile,
// and loads managed background images through IPC as data URLs (the island
// CSP only allows data:/blob: image sources).

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

function relativeLuminance(color) {
  const channel = (value) => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

export function islandAppearanceProfile(appearance) {
  const theme = appearance?.kind ? appearance : DEFAULT_ISLAND_APPEARANCE;
  const material = theme.kind === "default" ? "default" : theme.kind;
  const opacity = theme.opacity ?? 1;
  if (theme.kind === "glass") {
    return { tone: "glass", material, transparent: false, backdrop: "blur(24px) saturate(1.18)" };
  }
  if (theme.kind === "image") {
    return { tone: "glass", material, transparent: false, backdrop: "none" };
  }
  if ((theme.kind === "solid" || theme.kind === "gradient") && opacity < 0.58) {
    return { tone: "glass", material, transparent: opacity === 0, backdrop: "none" };
  }
  if (theme.kind === "solid" || theme.kind === "gradient") {
    const first = hexToRgb(theme.color);
    const second = theme.kind === "gradient" ? hexToRgb(theme.color2) : first;
    if (first && second) {
      const firstIsLight = relativeLuminance(first) > 0.45;
      const secondIsLight = relativeLuminance(second) > 0.45;
      const tone = firstIsLight === secondIsLight ? (firstIsLight ? "dark" : "light") : "glass";
      return { tone, material, transparent: false, backdrop: "none" };
    }
  }
  return { tone: "light", material: "default", transparent: false, backdrop: "none" };
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
  if (theme.kind === "glass" || theme.kind === "solid" || theme.kind === "gradient") {
    const opacity = theme.opacity ?? 1;
    const first = hexToRgb(theme.color);
    if (first) {
      const firstColor = `rgba(${first.r},${first.g},${first.b},${opacity})`;
      if (theme.kind === "glass" || theme.kind === "solid") return firstColor;
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
  const root = document.documentElement;
  const rootStyle = root.style;
  const theme = appearance?.kind && appearance.kind !== "default" ? appearance : null;
  const profile = islandAppearanceProfile(theme);
  root.dataset.islandTone = profile.tone;
  root.dataset.islandMaterial = profile.material;
  root.dataset.islandTransparent = String(profile.transparent);
  if (!theme) {
    rootStyle.removeProperty("--island-bg");
    rootStyle.removeProperty("--island-backdrop");
    return "#000";
  }
  const css = await resolveIslandBackground(theme, getImageDataUrl);
  rootStyle.setProperty("--island-bg", css);
  if (profile.backdrop === "none") rootStyle.removeProperty("--island-backdrop");
  else rootStyle.setProperty("--island-backdrop", profile.backdrop);
  return css;
}
