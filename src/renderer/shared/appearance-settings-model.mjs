const COLOR_MATERIALS = new Set(["glass", "solid", "gradient"]);

function colorState(appearance, fallbackKind = "solid") {
  const current = appearance && typeof appearance === "object" ? appearance : { kind: "default" };
  if (COLOR_MATERIALS.has(current.kind)) {
    return {
      kind: current.kind === "gradient" ? fallbackKind : current.kind,
      color: current.color || "#000000",
      opacity: current.opacity ?? 1
    };
  }
  return { kind: fallbackKind, color: "#000000", opacity: 1 };
}

export function materialForAppearance(appearance) {
  if (appearance?.kind === "image") return "image";
  if (appearance?.kind === "glass") return "glass";
  return "solid";
}

export function appearanceForMaterial(appearance, material) {
  if (material === "image") {
    if (appearance?.kind === "image") return { ...appearance };
    return { kind: "image", imageRef: "", imageDim: 0.35 };
  }
  if (material === "glass") {
    if (!appearance?.kind || appearance.kind === "default" || appearance.kind === "image") {
      return { kind: "glass", color: "#dbeafe", opacity: 0.18 };
    }
    const current = colorState(appearance, "glass");
    return { ...current, kind: "glass" };
  }
  const current = colorState(appearance, "solid");
  return { ...current, kind: "solid" };
}

export function withAppearanceColor(appearance, color) {
  const current = colorState(appearance, appearance?.kind === "glass" ? "glass" : "solid");
  return { ...current, color };
}

export function withAppearanceOpacity(appearance, opacity) {
  const current = colorState(appearance, appearance?.kind === "glass" ? "glass" : "solid");
  return { ...current, opacity };
}
