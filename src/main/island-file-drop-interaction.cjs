"use strict";

function normalizeIslandInteractionBounds(bounds, {
  maxWidth = 740,
  maxHeight = 750
} = {}) {
  if (!bounds || typeof bounds !== "object") return null;
  const values = [bounds.x, bounds.y, bounds.width, bounds.height].map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [x, y, width, height] = values;
  if (x < 0 || y < 0 || width <= 0 || height <= 0) return null;
  if (x + width > maxWidth || y + height > maxHeight) return null;
  return { x, y, width, height };
}

function resolveDropProximityMouseMode({
  fileDragActive,
  concealed,
  pointerInside
}) {
  // 正在拖出文件：保持交互，拖放结束后再由临近监控据真实光标位置决定。
  if (fileDragActive) return "interactive";
  // 隐身态：不要改动当前鼠标模式，交给 conceal 逻辑处理。
  if (concealed) return "preserve";
  // 展开面板只在光标位于实际可见区域时接收鼠标；透明窗口区域必须穿透。
  // 主进程的临近监控会在光标重新进入可见区域时恢复交互，避免 mouseenter 死锁。
  return pointerInside ? "interactive" : "forward";
}

function createFileDropInteraction({
  scheduleTimeout = setTimeout,
  cancelTimeout = clearTimeout,
  timeoutMs = 30_000,
  onExpire = () => {}
} = {}) {
  let active = false;
  let expiryTimer = null;
  const clearExpiry = () => {
    if (expiryTimer === null) return;
    cancelTimeout(expiryTimer);
    expiryTimer = null;
  };
  return {
    setActive(value) {
      active = value === true;
      clearExpiry();
      if (!active) return;
      expiryTimer = scheduleTimeout(() => {
        expiryTimer = null;
        active = false;
        onExpire();
      }, timeoutMs);
      expiryTimer?.unref?.();
    },
    // 只要没有正在拖文件，鼠标离开可见区域就应切换为点击穿透。
    // 即使面板展开，主进程临近监控也能在光标返回时恢复交互。
    shouldForwardMouseEventsOnLeave() {
      return !active;
    },
    isActive() {
      return active;
    }
  };
}

module.exports = {
  createFileDropInteraction,
  normalizeIslandInteractionBounds,
  resolveDropProximityMouseMode
};
