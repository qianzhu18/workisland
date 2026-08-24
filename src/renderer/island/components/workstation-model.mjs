export function deriveWorkspaceLayout(media, width) {
  if (!media?.active || !media?.title) return { mode: "agents", mediaRatio: 0 };
  if (Number(width) < 560) return { mode: "stacked", mediaRatio: 1 };
  return { mode: "split", mediaRatio: 0.4 };
}

export function formatMediaTime(value) {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

export function getNotchMediaLayout(notchWidth, artworkSize = 28, gap = 6) {
  const halfNotch = Math.max(0, Number(notchWidth) || 0) / 2;
  const safeGap = Math.max(0, Number(gap) || 0);
  const size = Math.max(0, Number(artworkSize) || 0);
  const artworkRight = -(halfNotch + safeGap);
  return {
    artworkLeft: artworkRight - size,
    artworkRight,
    artworkSize: size,
    indicatorLeft: halfNotch + safeGap
  };
}
