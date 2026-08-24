"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const execFile = promisify(childProcess.execFile);

const DEFAULT_MAX_DATA_URL_LENGTH = 512 * 1024;
const BUNDLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,199}$/;
const ICON_FILE_PATTERN = /^[A-Za-z0-9_. -]{1,200}$/;

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

function readPlistValue(plistPath, key) {
  return new Promise((resolve) => {
    childProcess.execFile(
      "/usr/libexec/PlistBuddy",
      ["-c", `Print :${key}`, plistPath],
      { timeout: 2_000, maxBuffer: 32 * 1024 },
      (error, stdout) => resolve(error ? "" : String(stdout || "").trim())
    );
  });
}

async function readDeclaredIconName(appPath) {
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  return (await readPlistValue(plistPath, "CFBundleIconFile"))
    || (await readPlistValue(plistPath, "CFBundleIconName"));
}

function declaredIconPath(appPath, iconName) {
  if (typeof iconName !== "string" || !ICON_FILE_PATTERN.test(iconName)) return "";
  const fileName = path.extname(iconName) ? iconName : `${iconName}.icns`;
  return path.join(appPath, "Contents", "Resources", fileName);
}

async function readDeclaredIcon(iconPath) {
  const tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "workisland-icon-"));
  const outputPath = path.join(tempDirectory, "icon.png");
  try {
    await execFile("/usr/bin/sips", [
      "-s", "format", "png",
      "--resampleHeightWidth", "64", "64",
      iconPath,
      "--out", outputPath
    ], { timeout: 5_000, maxBuffer: 64 * 1024 });
    return await fs.promises.readFile(outputPath);
  } finally {
    await fs.promises.rm(tempDirectory, { recursive: true, force: true });
  }
}

function pngDataUrl(png, maxDataUrlLength) {
  if (!Buffer.isBuffer(png) || png.length === 0) return "";
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
  return dataUrl.length <= maxDataUrlLength ? dataUrl : "";
}

function createAppIconResolver({
  locateApplication = locateApplicationWithSpotlight,
  pathExists = fs.existsSync,
  readDeclaredIconName: getDeclaredIconName = readDeclaredIconName,
  readDeclaredIcon: getDeclaredIcon = readDeclaredIcon,
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
        const iconPath = declaredIconPath(appPath, await getDeclaredIconName(appPath));
        if (iconPath && pathExists(iconPath)) {
          const declaredDataUrl = pngDataUrl(await getDeclaredIcon(iconPath), maxDataUrlLength);
          if (declaredDataUrl) return declaredDataUrl;
        }
        const nativeImage = await getFileIcon(appPath);
        if (!nativeImage || nativeImage.isEmpty?.()) return "";
        const png = nativeImage.resize({ width: 64, height: 64, quality: "best" }).toPNG();
        return pngDataUrl(png, maxDataUrlLength);
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
  declaredIconPath,
  locateApplicationWithSpotlight,
  readDeclaredIcon
};
