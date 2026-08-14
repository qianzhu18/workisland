export const BASE_PET_SIZE = 130;
export const BASE_DISPLAY_SIZE = 120;
export const SLEEP_TIMEOUT_MS = 2 * 60 * 1000;
export const COMPLETE_IDLE_TIMEOUT_MS = 15 * 1000;

// ── 默认 sprite 协议（orca 原生格式）──────────────────────────────
// 1024×896，7 行状态，cell ~120×120
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

// ── Codex V2 Pet 协议 ─────────────────────────────────────────────
// 参考：~/.codex/skills/hatch-pet/references/codex-pet-contract.md
// 1536×2288，8 列 × 11 行，cell 192×208
// Rows 0-8: 标准动画状态；Rows 9-10: 16 个朝向（本应用暂不使用朝向行）
// spriteVersionNumber: 2 标识。Omitting it defaults to v1 and 会被拒绝。
export const CODEX_V2_ROWS = Object.freeze({
  idle: 0,            // 6 帧 calm resting
  "running-right": 1, // 8 帧 drag right（映射 drag）
  "running-left": 2,  // 8 帧 drag left（映射 drag）
  waving: 3,          // 4 帧 greeting/attention
  jumping: 4,         // 5 帧 playful jump（映射 play）
  failed: 5,          // 8 帧 blocked/failed
  waiting: 6,         // 6 帧 waiting for approval（映射 attention）
  running: 7,         // 6 帧 active task work
  review: 8           // 6 帧 completed output review（映射 complete）
});

export const CODEX_V2_TOTAL_ROWS = 11;
export const CODEX_V2_HEIGHT = 2288;
export const CODEX_V2_WIDTH = 1536;
export const CODEX_V2_CELL_WIDTH = 192;
export const CODEX_V2_CELL_HEIGHT = 208;

/**
 * Codex V2 协议下，orca 内部状态 → codex sprite 行的映射。
 * codex 没有 sleep（复用 idle）；drag 的左右方向由 statusToRow 单独选择。
 */
export const CODEX_V2_STATUS_TO_ROW = Object.freeze({
  idle: CODEX_V2_ROWS.idle,
  play: CODEX_V2_ROWS.jumping,
  sleep: CODEX_V2_ROWS.idle,      // codex 无 sleep，复用 idle
  running: CODEX_V2_ROWS.running,
  attention: CODEX_V2_ROWS.waiting,
  complete: CODEX_V2_ROWS.review,
  drag: CODEX_V2_ROWS["running-right"]
});

/**
 * 检测 sprite 是否为 Codex V2 协议格式。
 * 识别依据：naturalHeight === 2288（11 行 × 208px）。
 */
export function isCodexV2Sprite(naturalWidth, naturalHeight) {
  return naturalHeight === CODEX_V2_HEIGHT && naturalWidth === CODEX_V2_WIDTH;
}

export function statusToRow(status, spriteMeta, dragDirection = "right") {
  if (spriteMeta && spriteMeta.protocol === "codex-v2") {
    if (status === "drag") {
      return dragDirection === "left" ? CODEX_V2_ROWS["running-left"] : CODEX_V2_ROWS["running-right"];
    }
    return CODEX_V2_STATUS_TO_ROW[status] ?? CODEX_V2_ROWS.idle;
  }
  return STATUS_ROWS[status];
}

export function deriveDragDirection(deltaX, currentDirection = "right") {
  if (deltaX > 0) return "right";
  if (deltaX < 0) return "left";
  return currentDirection;
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
  // running 不再弹 WORKING 气泡：动画本身已表达工作状态，像素气泡图反而突兀
  if (status === "running") return null;
  if (status === "attention") return { text: "ATTENTION", size: "lg", color: "#E77800" };
  if (status === "complete") return { text: "DONE", size: "sm", color: "#13A913" };
  return null;
}
