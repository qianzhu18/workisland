"use strict";

function resolveDropProximityMouseMode({
  fileDragActive,
  panelExpanded,
  concealed,
  pointerInside
}) {
  // 正在拖出文件：保持交互，拖放结束后再由临近监控据真实光标位置决定。
  if (fileDragActive) return "interactive";
  // 隐身态：不要改动当前鼠标模式，交给 conceal 逻辑处理。
  if (concealed) return "preserve";
  // 工作台（文件架/剪贴板/终端）展开时，整个面板都应可交互，而不是只响应
  // 最上方那一点 proximity 热区——否则光标落在面板下半部时会被切成交点穿透，
  // 造成“选中文件后整座灵动岛卡死、再也点不动”。
  if (panelExpanded) return "interactive";
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
    // 仅在“没有正在拖文件”且“面板未展开”时才允许在鼠标离开时切成交点穿透。
    // 面板展开时必须保持交互，否则会出现点击穿透死锁。
    shouldForwardMouseEventsOnLeave({ panelExpanded = false } = {}) {
      return !active && !panelExpanded;
    },
    isActive() {
      return active;
    }
  };
}

module.exports = { createFileDropInteraction, resolveDropProximityMouseMode };
