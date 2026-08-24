"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");

const DEFAULT_MAX_DATA_URL_LENGTH = 512 * 1024;
const BUNDLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,199}$/;

function locateApplicationWithSpotlight(bundleId) {
  return new Promise((resolve) => {
    const query = `kMDItemCFBundleIdentifier == '${bundleId}'c`;
    childProcess.execFile(
      "/usr/bin/mdfind",
      [query],
      { timeout: 2_000, maxBuffer: 256 * 1024 },
      (error, stdout) => {
        if (error) return resolve("");
        const appPath = String(stdout || "")
          .split(/\r?\n/)
          .map((value) => value.trim())
          .find((value) => value.toLowerCase().endsWith(".app"));
        resolve(appPath || "");
      }
    );
  });
}

function createAppIconResolver({
  locateApplication = locateApplicationWithSpotlight,
  pathExists = fs.existsSync,
  getFileIcon,
  maxDataUrlLength = DEFAULT_MAX_DATA_URL_LENGTH
} = {}) {
  if (typeof getFileIcon !== "function") throw new TypeError("getFileIcon is required");
  const cache = new Map();

  return async function resolveAppIcon(bundleId) {
    if (typeof bundleId !== "string" || !BUNDLE_ID_PATTERN.test(bundleId)) return "";
    if (cache.has(bundleId)) return cache.get(bundleId);

    const pending = Promise.resolve()
      .then(() => locateApplication(bundleId))
      .then(async (appPath) => {
        if (typeof appPath !== "string" || !appPath.toLowerCase().endsWith(".app") || !pathExists(appPath)) return "";
        const nativeImage = await getFileIcon(appPath);
        if (!nativeImage || nativeImage.isEmpty?.()) return "";
        const png = nativeImage.resize({ width: 64, height: 64, quality: "best" }).toPNG();
        if (!Buffer.isBuffer(png) || png.length === 0) return "";
        const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
        return dataUrl.length <= maxDataUrlLength ? dataUrl : "";
      })
      .catch(() => "");
    cache.set(bundleId, pending);
    return pending;
  };
}

module.exports = {
  BUNDLE_ID_PATTERN,
  DEFAULT_MAX_DATA_URL_LENGTH,
  createAppIconResolver,
  locateApplicationWithSpotlight
};
