// Coordinates are CSS points in the target display, never Retina pixels.
export function systemNoticeLayout({ hasNotch = false, notchHeight = 0, notchWidth = 0, maxWidth = 740 } = {}) {
  const safeTop = hasNotch ? Math.max(0, Number(notchHeight) || 0) : 0;
  const contentTop = safeTop + 10;
  return { width: Math.min(maxWidth, Math.max(360, hasNotch ? notchWidth + 96 : 360)), contentTop,
    rowHeight: 42, bottomInset: 16, entryTravel: 4, height: contentTop + 42 + 16 };
}
export function systemPillLayout(notchWidth = 0) {
  const half = Math.max(0, Number(notchWidth) || 0) / 2;
  return { iconLeft: -half - 8 - 18, iconSize: 18, indicatorLeft: half + 8 };
}
