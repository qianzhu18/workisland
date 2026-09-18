const COLOR_MATERIALS = new Set(["glass", "solid", "gradient"]);

function colorState(appearance, fallbackKind = "solid") {
  const current = appearance && typeof appearance === "object" ? appearance : { kind: "default" };
  if (COLOR_MATERIALS.has(current.kind)) {
    return {
      kind: current.kind === "solid" ? "solid" : fallbackKind,
      color: current.color || "#000000",
      opacity: current.opacity ?? 1
    };
  }
  return { kind: fallbackKind, color: "#000000", opacity: 1 };
}

export function materialForAppearance(appearance) {
  if (appearance?.kind === "image") return "image";
  return "solid";
}

export function appearanceForMaterial(appearance, material) {
  if (material === "image") {
    if (appearance?.kind === "image") return { ...appearance };
    return { kind: "image", imageRef: "", imageDim: 0.35 };
  }
  const current = colorState(appearance, "solid");
  return { ...current, kind: "solid" };
}

export function rememberedImageAppearance(settings) {
  const remembered = settings?.lastIslandImageAppearance;
  if (remembered?.kind === "image" && typeof remembered.imageRef === "string" && remembered.imageRef.length > 0) {
    return { ...remembered };
  }
  const active = settings?.islandAppearance;
  if (active?.kind === "image" && typeof active.imageRef === "string" && active.imageRef.length > 0) {
    return { ...active };
  }
  return null;
}

export function withAppearanceColor(appearance, color) {
  const current = colorState(appearance, "solid");
  return { ...current, color };
}

export function withAppearanceOpacity(appearance, opacity) {
  const current = colorState(appearance, "solid");
  return { ...current, opacity };
}
