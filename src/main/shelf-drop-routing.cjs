"use strict";

function finiteRect(rect) {
  return rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && rect.width > 0 && rect.height > 0;
}

function isShelfShareDrop(point, bounds) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !finiteRect(bounds)) return false;
  return point.x >= bounds.x && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y && point.y <= bounds.y + bounds.height;
}

function normalizeShelfShareBounds(bounds) {
  if (!finiteRect(bounds)) return null;
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.min(740, Math.round(bounds.width)),
    height: Math.min(750, Math.round(bounds.height))
  };
}

module.exports = { isShelfShareDrop, normalizeShelfShareBounds };
