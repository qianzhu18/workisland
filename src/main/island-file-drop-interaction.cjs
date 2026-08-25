"use strict";

function resolveDropProximityMouseMode({
  fileDragActive,
  panelExpanded,
  concealed,
  pointerInside
}) {
  if (fileDragActive) return "interactive";
  if (panelExpanded || concealed) return "preserve";
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
    shouldForwardMouseEventsOnLeave() {
      return !active;
    },
    isActive() {
      return active;
    }
  };
}

module.exports = { createFileDropInteraction, resolveDropProximityMouseMode };
