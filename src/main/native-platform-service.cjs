"use strict";

const DEFAULT_FULLSCREEN_STATE = Object.freeze({
  hasFullscreenApp: false,
  menuBarVisible: true
});

function createNativePlatformService({
  addonPath,
  platform = process.platform,
  load = require,
  logger = console
}) {
  let addon = null;

  if (platform === "darwin") {
    try {
      addon = load(addonPath);
    } catch (error) {
      logger.warn("[PanelFix] native addon unavailable:", error.message);
    }
  }

  function call(method, fallback, ...args) {
    if (!addon || typeof addon[method] !== "function") return fallback;
    try {
      return addon[method](...args);
    } catch (error) {
      logger.warn(`[PanelFix] ${method} failed:`, error.message);
      return fallback;
    }
  }

  return Object.freeze({
    available: Boolean(addon),
    getNotchInfo: (displayId) => call("getNotchInfo", null, displayId),
    getAllScreensInfo: () => call("getAllScreensInfo", []),
    getFrontmostAppDisplayId: () => call("getFrontmostAppDisplayId", null),
    getFrontmostAppBundleId: () => call("getFrontmostAppBundleId", null),
    watchFrontmostApp: (callback) => call("watchFrontmostApp", undefined, callback),
    unwatchFrontmostApp: () => call("unwatchFrontmostApp", undefined),
    watchScreenParameters: (callback) => call("watchScreenParameters", undefined, callback),
    unwatchScreenParameters: () => call("unwatchScreenParameters", undefined),
    fixPanel: (handle, displayId) => call("fixPanel", undefined, handle, displayId),
    fixPetWindow: (handle) => call("fixPetWindow", undefined, handle),
    performHapticFeedback: () => call("performHapticFeedback", undefined),
    hasURLSchemeHandler: (scheme) => call("hasURLSchemeHandler", false, scheme),
    getScreenFullscreenState: (displayId) => call("getScreenFullscreenState", DEFAULT_FULLSCREEN_STATE, displayId),
    watchActiveSpace: (callback) => call("watchActiveSpace", undefined, callback),
    unwatchActiveSpace: () => call("unwatchActiveSpace", undefined),
    setWindowCornerRadius: (handle, radius) => call("setWindowCornerRadius", undefined, handle, radius)
  });
}

module.exports = { DEFAULT_FULLSCREEN_STATE, createNativePlatformService };
