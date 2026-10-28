"use strict";
function normalizeViewBounds(value, size) {
  if (!value || ![value.x, value.y, value.width, value.height].every(Number.isFinite)) return null;
  const x = Math.max(0, Math.round(value.x)), y = Math.max(0, Math.round(value.y));
  const width = Math.min(Math.round(value.width), size.width - x), height = Math.min(Math.round(value.height), size.height - y);
  return width >= 1 && height >= 1 ? { x, y, width, height } : null;
}
function containsPoint(rect, point) { return Boolean(rect && point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height); }
function desktopBounds(point, workArea, size = {}) {
  const width = Math.min(workArea.width, Math.max(420, Math.round(size.width || 740)));
  const height = Math.min(workArea.height, Math.max(260, Math.round(size.height || 460)));
  return { x: Math.round(Math.max(workArea.x, Math.min(point.x, workArea.x + workArea.width - width))),
    y: Math.round(Math.max(workArea.y, Math.min(point.y, workArea.y + workArea.height - height))), width, height };
}
module.exports = { normalizeViewBounds, containsPoint, desktopBounds };
