export function placeFloatingLayer(anchor, viewport, layer, margin = 12, gap = 8) {
  const width = Math.min(layer.width, Math.max(0, viewport.width - margin * 2));
  const height = Math.min(layer.height, Math.max(0, viewport.height - margin * 2));
  const left = Math.max(margin, Math.min(anchor.right - width, viewport.width - width - margin));
  const roomBelow = viewport.height - anchor.bottom - margin;
  const preferredTop = roomBelow >= height + gap ? anchor.bottom + gap : anchor.top - height - gap;
  const top = Math.max(margin, Math.min(preferredTop, viewport.height - height - margin));
  return { left, top };
}
