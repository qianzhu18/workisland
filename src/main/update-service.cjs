"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_RELEASE_URL = "https://api.github.com/repos/qianzhu18/workisland/releases/latest";
const DEFAULT_DOWNLOAD_URL = "https://github.com/qianzhu18/workisland/releases/latest";
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1e3;
const UPDATE_REQUEST_TIMEOUT_MS = 8e3;
const UPDATE_STATE_FILE = "update-check.json";

function parseVersion(value) {
  const raw = String(value ?? "").trim();
  const match = raw.replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    raw,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : []
  };
}

function compareIdentifiers(left, right) {
  const leftNumber = /^\d+$/.test(left);
  const rightNumber = /^\d+$/.test(right);
  if (leftNumber && rightNumber) return Number(left) - Number(right);
  if (leftNumber !== rightNumber) return leftNumber ? -1 : 1;
  return left.localeCompare(right);
}

function compareVersions(left, right) {
  const a = typeof left === "string" ? parseVersion(left) : left;
  const b = typeof right === "string" ? parseVersion(right) : right;
  if (!a || !b) return null;
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (a.prerelease[index] === undefined) return -1;
    if (b.prerelease[index] === undefined) return 1;
    const result = compareIdentifiers(a.prerelease[index], b.prerelease[index]);
    if (result !== 0) return result > 0 ? 1 : -1;
  }
  return 0;
}

function normalizeRelease(payload) {
  if (!payload || payload.draft || payload.prerelease) return null;
  const version = parseVersion(payload.tag_name || payload.name);
  if (!version) return null;
  return {
    version: version.raw.replace(/^v/i, ""),
    name: String(payload.name || `WorkIsland ${version.raw}`),
    url: typeof payload.html_url === "string" && payload.html_url.startsWith("https://")
      ? payload.html_url
      : DEFAULT_DOWNLOAD_URL,
    publishedAt: payload.published_at || payload.created_at || null
  };
}

function readState(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      lastCheckedAt: Number.isFinite(value.lastCheckedAt) ? value.lastCheckedAt : 0,
      lastNotifiedVersion: typeof value.lastNotifiedVersion === "string" ? value.lastNotifiedVersion : "",
      latestRelease: value.latestRelease && typeof value.latestRelease === "object" ? value.latestRelease : null
    };
  } catch {
    return { lastCheckedAt: 0, lastNotifiedVersion: "", latestRelease: null };
  }
}

function writeState(filePath, state) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2));
    fs.renameSync(temporaryPath, filePath);
  } catch {
    // Update state is only a cache. A write failure must not affect the app.
  }
}

async function fetchLatestRelease(fetchImpl, releaseUrl) {
  if (typeof fetchImpl !== "function") throw new Error("更新检测需要可用的网络请求实现");
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), UPDATE_REQUEST_TIMEOUT_MS) : null;
  try {
    const response = await fetchImpl(releaseUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "WorkIsland-update-check"
      },
      signal: controller?.signal
    });
    if (!response?.ok) throw new Error(`版本信息请求失败（HTTP ${response?.status ?? "unknown"}）`);
    const release = normalizeRelease(await response.json());
    if (!release) throw new Error("官方版本信息格式无效");
    return release;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function createUpdateService({
  app,
  shell,
  notificationClass,
  userDataPath,
  getSettings = () => ({}),
  onUpdateAvailable = () => {},
  fetchImpl = globalThis.fetch,
  releaseUrl = DEFAULT_RELEASE_URL,
  now = () => Date.now(),
  minIntervalMs = UPDATE_CHECK_INTERVAL_MS,
  initialDelayMs = 10e3,
  intervalMs = UPDATE_CHECK_INTERVAL_MS,
  logger = console
} = {}) {
  if (!app || typeof app.getVersion !== "function") throw new TypeError("app.getVersion is required");
  const statePath = path.join(userDataPath || ".", UPDATE_STATE_FILE);
  let state = readState(statePath);
  let inFlight = null;
  let initialTimer = null;
  let intervalTimer = null;

  function currentVersion() {
    return String(app.getVersion());
  }

  function isDevelopment() {
    return app.isPackaged === false;
  }

  function resultForRelease(release) {
    const current = currentVersion();
    const comparison = compareVersions(release.version, current);
    if (comparison === null) {
      return { status: "error", currentVersion: current, message: "当前版本号无法比较" };
    }
    return {
      status: comparison > 0 ? "update-available" : "up-to-date",
      currentVersion: current,
      latestVersion: release.version,
      releaseName: release.name,
      releaseUrl: release.url,
      publishedAt: release.publishedAt
    };
  }

  function showUpdateNotification(result) {
    if (!notificationClass) return false;
    try {
      if (typeof notificationClass.isSupported === "function" && !notificationClass.isSupported()) return false;
      const notification = new notificationClass({
        title: "WorkIsland 有新版本",
        body: `${result.latestVersion} 已发布，点击查看下载。`
      });
      notification.on("click", () => {
        void shell?.openExternal?.(result.releaseUrl || DEFAULT_DOWNLOAD_URL);
      });
      notification.show();
      return true;
    } catch (error) {
      logger.warn?.("[UpdateService] failed to show notification:", error);
      return false;
    }
  }

  async function runCheck({ notify = true } = {}) {
    state.lastCheckedAt = now();
    writeState(statePath, state);
    try {
      const release = await fetchLatestRelease(fetchImpl, releaseUrl);
      state.latestRelease = release;
      writeState(statePath, state);
      const result = resultForRelease(release);
      if (result.status === "update-available") {
        onUpdateAvailable(result);
        if (notify && state.lastNotifiedVersion !== result.latestVersion) {
          if (showUpdateNotification(result)) {
            state.lastNotifiedVersion = result.latestVersion;
            writeState(statePath, state);
          }
        }
      }
      return result;
    } catch (error) {
      logger.warn?.("[UpdateService] check failed:", error);
      return {
        status: "error",
        currentVersion: currentVersion(),
        message: "暂时无法获取更新信息，请稍后重试。"
      };
    }
  }

  function check({ force = false, notify = true } = {}) {
    if (isDevelopment()) {
      return Promise.resolve({ status: "disabled", reason: "development", currentVersion: currentVersion() });
    }
    if (!force && getSettings()?.updateChecksEnabled === false) {
      return Promise.resolve({ status: "disabled", reason: "user-disabled", currentVersion: currentVersion() });
    }
    if (!force && state.lastCheckedAt && now() - state.lastCheckedAt < minIntervalMs) {
      if (state.latestRelease) return Promise.resolve(resultForRelease(state.latestRelease));
      return Promise.resolve({ status: "skipped", reason: "recently-checked", currentVersion: currentVersion() });
    }
    if (!inFlight) {
      inFlight = runCheck({ notify }).finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  function start() {
    if (isDevelopment() || initialTimer || intervalTimer) return;
    initialTimer = setTimeout(() => {
      initialTimer = null;
      void check().catch(() => {});
      intervalTimer = setInterval(() => void check().catch(() => {}), intervalMs);
    }, initialDelayMs);
  }

  function stop() {
    if (initialTimer) clearTimeout(initialTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    initialTimer = null;
    intervalTimer = null;
  }

  return {
    check,
    start,
    stop,
    getState: () => ({ ...state }),
    getStatePath: () => statePath
  };
}

module.exports = {
  DEFAULT_DOWNLOAD_URL,
  DEFAULT_RELEASE_URL,
  UPDATE_CHECK_INTERVAL_MS,
  compareVersions,
  createUpdateService,
  normalizeRelease,
  parseVersion
};
