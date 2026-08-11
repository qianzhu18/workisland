export const BASE_PET_SIZE = 130;
export const BASE_DISPLAY_SIZE = 120;
export const SLEEP_TIMEOUT_MS = 2 * 60 * 1000;
export const COMPLETE_IDLE_TIMEOUT_MS = 15 * 1000;

export const STATUS_ROWS = Object.freeze({
  idle: 0,
  play: 1,
  sleep: 2,
  running: 3,
  attention: 4,
  complete: 5,
  drag: 6
});

export const TOTAL_ROWS = Object.keys(STATUS_ROWS).length;

export function statusToRow(status) {
  return STATUS_ROWS[status];
}

export function statusToIntervalMs(status) {
  switch (status) {
    case "play":
    case "complete":
    case "attention":
    case "drag":
      return 90;
    case "running":
      return 120;
    default:
      return 150;
  }
}

export function derivePetStatus(sessions) {
  if (sessions.some((session) => session.phase === "waitingForApproval" || session.phase === "waitingForAnswer")) {
    return "attention";
  }
  if (sessions.some((session) => session.phase === "running")) return "running";
  if (sessions.some((session) => session.phase === "completed")) return "complete";
  return "idle";
}

export function derivePetBubble(status, visibleCount) {
  if (status === "drag" || status === "play") return null;
  if (status === "idle" || status === "sleep") {
    return visibleCount > 0 ? { text: String(visibleCount), size: "sm", color: "#1C1D1E" } : null;
  }
  if (status === "running") return { text: "WORKING", size: "md", color: "#1C1D1E" };
  if (status === "attention") return { text: "ATTENTION", size: "lg", color: "#E77800" };
  if (status === "complete") return { text: "DONE", size: "sm", color: "#13A913" };
  return null;
}
