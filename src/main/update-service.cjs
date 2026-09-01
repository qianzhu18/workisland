"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { createHash } = require("node:crypto");

const DEFAULT_RELEASE_URL = "https://api.github.com/repos/qianzhu18/workisland/releases/latest";
const DEFAULT_DOWNLOAD_URL = "https://github.com/qianzhu18/workisland/releases/latest";
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1e3;
const UPDATE_REQUEST_TIMEOUT_MS = 8e3;
const UPDATE_STATE_FILE = "update-check.json";
const UPDATE_DOWNLOAD_DIR = "update";
const APP_BUNDLE_NAME = "WorkIsland.app";
const CHECKSUM_ASSET_NAME = "SHA256SUMS.txt";
const INSTALL_COMMAND_TIMEOUT_MS = 120e3;
const DOWNLOAD_PROGRESS_MIN_INTERVAL_MS = 200;

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

function normalizeAsset(asset) {
  if (!asset || typeof asset.name !== "string") return null;
  const url = typeof asset.browser_download_url === "string" && asset.browser_download_url.startsWith("https://")
    ? asset.browser_download_url
    : "";
  if (!url) return null;
  return { name: asset.name, url, size: Number(asset.size) || 0 };
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
    publishedAt: payload.published_at || payload.created_at || null,
    assets: Array.isArray(payload.assets) ? payload.assets.map(normalizeAsset).filter(Boolean) : []
  };
}

const ARCH_ALIASES = {
  arm64: ["arm64", "aarch64", "apple-silicon"],
  x64: ["x64", "x86_64", "intel"]
};

// 在 Release 资产里挑出当前架构的 DMG：先匹配本架构标记，再退回
// universal 包，最后才接受没有任何架构标记的包；永远不选明确属于
// 其他架构的包。
function pickDmgAsset(assets, arch = process.arch) {
  if (!Array.isArray(assets) || assets.length === 0) return null;
  const dmgs = assets.filter((asset) => asset.name.toLowerCase().endsWith(".dmg"));
  if (dmgs.length === 0) return null;
  const lower = (asset) => asset.name.toLowerCase();
  const own = ARCH_ALIASES[arch] ?? [arch];
  const other = arch === "x64" ? ARCH_ALIASES.arm64 : ARCH_ALIASES.x64;
  const matchesOwn = dmgs.filter((asset) => own.some((token) => lower(asset).includes(token)) && !other.some((token) => lower(asset).includes(token)));
  if (matchesOwn.length > 0) return matchesOwn[0];
  const universal = dmgs.find((asset) => lower(asset).includes("universal"));
  if (universal) return universal;
  const untagged = dmgs.find((asset) => ![...ARCH_ALIASES.arm64, ...ARCH_ALIASES.x64].some((token) => lower(asset).includes(token)));
  if (untagged) return untagged;
  return null;
}

function pickChecksumAsset(assets) {
  if (!Array.isArray(assets)) return null;
  return assets.find((asset) => asset.name.toLowerCase() === CHECKSUM_ASSET_NAME.toLowerCase()) ?? null;
}

// SHA256SUMS.txt 每行格式为 `<sha256>  <filename>`（sha256sum 默认输出）。
function extractChecksum(text, fileName) {
  const lines = String(text ?? "").split(/\r?\n/);
  for (const line of lines) {
    const match = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (match && match[2].trim() === fileName) return match[1].toLowerCase();
  }
  return null;
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

function responseText(response) {
  if (typeof response?.text === "function") return response.text();
  return Promise.resolve(response?.body ?? "");
}

function bodyToAsyncIterable(body) {
  if (body && typeof body[Symbol.asyncIterator] === "function") return body;
  if (body && typeof body.getReader === "function") {
    return (async function* () {
      const reader = body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally {
        reader.releaseLock?.();
      }
    })();
  }
  throw new Error("下载响应缺少可读的数据流");
}

async function downloadToFile(fetchImpl, url, destinationPath, { onProgress = () => {}, logger = console } = {}) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const response = await fetchImpl(url, {
    headers: { Accept: "application/octet-stream", "User-Agent": "WorkIsland-update-check" },
    signal: controller?.signal
  });
  if (!response?.ok) throw new Error(`下载失败（HTTP ${response?.status ?? "unknown"}）`);
  const total = Number(response.headers?.get?.("content-length")) || 0;
  const hash = createHash("sha256");
  const handle = await fs.promises.open(destinationPath, "w");
  let received = 0;
  let lastReportedAt = 0;
  try {
    for await (const chunk of bodyToAsyncIterable(response.body)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buffer);
      await handle.write(buffer, 0, buffer.length);
      received += buffer.length;
      const at = Date.now();
      if (at - lastReportedAt >= DOWNLOAD_PROGRESS_MIN_INTERVAL_MS) {
        lastReportedAt = at;
        onProgress({ received, total, pct: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0 });
      }
    }
  } catch (error) {
    controller?.abort();
    throw error;
  } finally {
    await handle.close();
  }
  onProgress({ received, total, pct: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 100 });
  logger.debug?.(`[UpdateService] downloaded ${received} bytes from ${url}`);
  return { received, sha256: hash.digest("hex") };
}

async function runInstallCommand(runner, file, args, { optional = false } = {}) {
  try {
    await runner(file, args);
    return true;
  } catch (error) {
    if (optional) return false;
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function installFromDmg({ dmgPath, installDir, runner, fsModule = fs }) {
  const mountPoint = fsModule.mkdtempSync(path.join(os.tmpdir(), "workisland-update-"));
  try {
    await runInstallCommand(runner, "hdiutil", ["attach", dmgPath, "-readonly", "-nobrowse", "-mountpoint", mountPoint]);
    const sourceApp = path.join(mountPoint, APP_BUNDLE_NAME);
    if (!fsModule.existsSync(sourceApp)) {
      throw new Error("安装镜像中没有找到 WorkIsland.app");
    }
    const targetApp = path.join(installDir, APP_BUNDLE_NAME);
    await runInstallCommand(runner, "/bin/rm", ["-rf", targetApp]);
    await runInstallCommand(runner, "/usr/bin/ditto", [sourceApp, targetApp]);
    return targetApp;
  } finally {
    await runInstallCommand(runner, "hdiutil", ["detach", mountPoint, "-force"], { optional: true });
    await fsModule.promises.rmdir(mountPoint).catch(() => {});
  }
}

function defaultRunner() {
  return (file, args) => new Promise((resolve, reject) => {
    execFile(file, args, { timeout: INSTALL_COMMAND_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stderr || error.message || "安装命令执行失败")));
        return;
      }
      resolve(String(stdout ?? ""));
    });
  });
}

function createUpdateService({
  app,
  shell,
  notificationClass,
  userDataPath,
  getSettings = () => ({}),
  onUpdateAvailable = () => {},
  onUpdateState = () => {},
  fetchImpl = globalThis.fetch,
  releaseUrl = DEFAULT_RELEASE_URL,
  now = () => Date.now(),
  minIntervalMs = UPDATE_CHECK_INTERVAL_MS,
  initialDelayMs = 10e3,
  intervalMs = UPDATE_CHECK_INTERVAL_MS,
  logger = console,
  runner = defaultRunner(),
  relaunch = () => app.relaunch?.(),
  quit = () => app.quit?.(),
  openPath = (value) => shell?.openPath?.(value),
  arch = process.arch,
  getInstallDir
} = {}) {
  if (!app || typeof app.getVersion !== "function") throw new TypeError("app.getVersion is required");
  const statePath = path.join(userDataPath || ".", UPDATE_STATE_FILE);
  let state = readState(statePath);
  let inFlight = null;
  let initialTimer = null;
  let intervalTimer = null;
  let updateState = { phase: "idle", progress: null, release: null, error: null, downloadedPath: null };

  function currentVersion() {
    return String(app.getVersion());
  }

  function isDevelopment() {
    return app.isPackaged === false;
  }

  function resolveInstallDir() {
    if (typeof getInstallDir === "function") return getInstallDir();
    const exePath = app.getPath?.("exe") ?? "";
    const bundleMarker = `${path.sep}${APP_BUNDLE_NAME}${path.sep}Contents`;
    const markerIndex = exePath.lastIndexOf(bundleMarker);
    if (markerIndex > 0) return path.dirname(exePath.slice(0, markerIndex + APP_BUNDLE_NAME.length));
    return "/Applications";
  }

  function publishState(patch) {
    updateState = { ...updateState, ...patch };
    try {
      onUpdateState(getUpdateState());
    } catch (error) {
      logger.warn?.("[UpdateService] onUpdateState listener failed:", error);
    }
  }

  function getUpdateState() {
    return {
      ...updateState,
      currentVersion: currentVersion(),
      latestVersion: updateState.release?.version ?? state.latestRelease?.version ?? null,
      releaseUrl: updateState.release?.url ?? state.latestRelease?.url ?? DEFAULT_DOWNLOAD_URL
    };
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

  function showReadyNotification() {
    if (!notificationClass) return;
    try {
      if (typeof notificationClass.isSupported === "function" && !notificationClass.isSupported()) return;
      const notification = new notificationClass({
        title: "WorkIsland 更新已就绪",
        body: `新版本 ${updateState.release?.version ?? ""} 下载完成，点击立即安装并重启。`
      });
      notification.on("click", () => {
        void install();
      });
      notification.show();
    } catch (error) {
      logger.warn?.("[UpdateService] failed to show ready notification:", error);
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
        if (updateState.phase === "idle") {
          publishState({ release });
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

  // 把更新下载到本地并做 SHA-256 校验，完成后进入 ready 阶段等待安装。
  async function download() {
    if (isDevelopment()) return { ...getUpdateState(), error: "开发模式下不执行更新下载" };
    if (updateState.phase === "downloading" || updateState.phase === "ready" || updateState.phase === "installing") {
      return getUpdateState();
    }
    let release = updateState.release ?? state.latestRelease ?? null;
    let result = null;
    if (!release || !release.assets) {
      result = await check({ force: true, notify: false });
      release = state.latestRelease;
      if (result?.status !== "update-available" || !release) {
        publishState({ phase: "idle", error: result?.message ?? "当前已是最新版本" });
        return getUpdateState();
      }
    }
    const asset = pickDmgAsset(release.assets, arch);
    if (!asset) {
      publishState({ phase: "error", error: "未找到与当前芯片匹配的安装包，请前往发布页手动下载。" });
      return getUpdateState();
    }
    const downloadDir = path.join(userDataPath || ".", UPDATE_DOWNLOAD_DIR);
    const destinationPath = path.join(downloadDir, asset.name);
    publishState({ phase: "downloading", progress: { received: 0, total: asset.size, pct: 0 }, release, error: null, downloadedPath: null });
    try {
      fs.mkdirSync(downloadDir, { recursive: true });
      const { sha256 } = await downloadToFile(fetchImpl, asset.url, destinationPath, {
        onProgress: (progress) => publishState({ progress }),
        logger
      });
      const checksumAsset = pickChecksumAsset(release.assets);
      if (checksumAsset) {
        const checksumResponse = await fetchImpl(checksumAsset.url, {
          headers: { Accept: "text/plain", "User-Agent": "WorkIsland-update-check" }
        });
        if (checksumResponse?.ok) {
          const expected = extractChecksum(await responseText(checksumResponse), asset.name);
          if (expected && expected !== sha256) {
            await fs.promises.rm(destinationPath, { force: true }).catch(() => {});
            throw new Error("安装包校验失败，已停止安装。请稍后重试或前往发布页手动下载。");
          }
        }
      }
      publishState({ phase: "ready", progress: { received: asset.size, total: asset.size, pct: 100 }, downloadedPath: destinationPath, error: null });
      showReadyNotification();
      return getUpdateState();
    } catch (error) {
      logger.warn?.("[UpdateService] download failed:", error);
      publishState({ phase: "error", error: error?.message || "更新下载失败，请稍后重试。" });
      return getUpdateState();
    }
  }

  // 安装已下载的更新：挂载 DMG、替换当前安装目录内的应用并重启。
  // 任何一步失败都会回退为打开 DMG，让用户手动拖拽安装。
  async function install() {
    if (isDevelopment()) return { ...getUpdateState(), error: "开发模式下不执行更新安装" };
    if (updateState.phase !== "ready" || !updateState.downloadedPath) {
      return getUpdateState();
    }
    const dmgPath = updateState.downloadedPath;
    publishState({ phase: "installing", error: null });
    try {
      const installDir = resolveInstallDir();
      await installFromDmg({ dmgPath, installDir, runner });
      publishState({ phase: "idle", progress: null, downloadedPath: null, error: null });
      relaunch();
      quit();
      return { ...getUpdateState(), installed: true };
    } catch (error) {
      logger.warn?.("[UpdateService] automatic install failed, falling back to manual:", error);
      const opened = await Promise.resolve()
        .then(() => openPath?.(dmgPath))
        .then(() => true)
        .catch(() => false);
      publishState({
        phase: opened ? "manual" : "error",
        error: opened
          ? "自动安装未完成，已打开安装镜像，请将 WorkIsland 拖入「应用程序」后重新打开。"
          : error?.message || "自动安装失败，请前往发布页手动下载。"
      });
      return getUpdateState();
    }
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
    download,
    install,
    getState: () => ({ ...state }),
    getUpdateState,
    getStatePath: () => statePath
  };
}

module.exports = {
  APP_BUNDLE_NAME,
  CHECKSUM_ASSET_NAME,
  DEFAULT_DOWNLOAD_URL,
  DEFAULT_RELEASE_URL,
  UPDATE_CHECK_INTERVAL_MS,
  compareVersions,
  createUpdateService,
  extractChecksum,
  installFromDmg,
  normalizeRelease,
  parseVersion,
  pickChecksumAsset,
  pickDmgAsset
};
