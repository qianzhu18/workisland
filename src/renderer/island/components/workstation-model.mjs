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
