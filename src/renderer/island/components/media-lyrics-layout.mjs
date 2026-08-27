export function getLyricsLayoutMode(railHeight) {
  const height = Math.max(0, Number(railHeight) || 0);
  if (height < 220) return "compact";
  if (height < 360) return "contextual";
  return "full";
}

export function getActiveLyricLine(lines, elapsedSec) {
  if (!Array.isArray(lines) || lines.length === 0) return "";
  const elapsed = Math.max(0, Number(elapsedSec) || 0);
  let active = lines[0];
  for (const line of lines) {
    if (Number(line?.atSec) > elapsed) break;
    active = line;
  }
  return typeof active?.text === "string" ? active.text : "";
}
