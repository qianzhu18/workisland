"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { createHash } = require("node:crypto");
const { i18n } = require("./i18n.cjs");

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
const DOWNLOAD_MAX_ATTEMPTS = 3;
const DOWNLOAD_RETRY_DELAYS_MS = [0, 750, 1800];

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

function pickChecksumAsset(assets, arch = process.arch) {
  if (!Array.isArray(assets)) return null;
  // 发布流水线可能按架构拆分校验文件（SHA256SUMS-arm64.txt /
  // SHA256SUMS-x64.txt）；优先精确匹配，回退到单一的 SHA256SUMS.txt。
  const token = arch === "x64" ? "x64" : "arm64";
  const perArch = assets.find((asset) => asset.name.toLowerCase() === `sha256sums-${token}.txt`);
  if (perArch) return perArch;
  return assets.find((asset) => asset.name.toLowerCase() === CHECKSUM_ASSET_NAME.toLowerCase()) ?? null;
}

// SHA256SUMS.txt 每行格式为 `<sha256>  <filename>`（sha256sum 默认输出）。
function extractChecksum(text, fileName) {
  const lines = String(text ?? "").split(/\r?\n/);
  for (const line of lines) {
    const match = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (match && path.posix.basename(match[2].trim().replace(/\\/g, "/")) === fileName) return match[1].toLowerCase();
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

// Bound the whole metadata request, including body consumption. Promise.race
// also protects against a transport that does not settle promptly on abort.
async function fetchMetadata(fetchImpl, url, accept, consume, {
  timeoutMs = UPDATE_REQUEST_TIMEOUT_MS,
  retryDelaysMs = DOWNLOAD_RETRY_DELAYS_MS,
  logger = console
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error(i18n.t("update.error.fetchUnavailable"));
  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(url, {
            headers: { Accept: accept, "User-Agent": "WorkIsland-update-check" },
            cache: "no-store",
            signal: controller.signal
          });
          if (!response?.ok) {
            await response?.body?.cancel?.().catch(() => {});
            const error = new Error(i18n.t("update.error.releaseRequest", { status: response?.status ?? "unknown" }));
            error.status = Number(response?.status) || 0;
            throw error;
          }
          return consume(response);
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error("Update request timed out");
            error.code = "ETIMEDOUT";
            controller.abort();
            reject(error);
          }, timeoutMs);
        })
      ]);
    } catch (error) {
      controller.abort();
      if (attempt >= DOWNLOAD_MAX_ATTEMPTS - 1 || !isRetryableDownloadError(error)) throw error;
      logger.warn?.(`[UpdateService] metadata request attempt ${attempt + 1} failed`, error);
    } finally {
      clearTimeout(timer);
    }
    await waitForRetry(retryDelaysMs[attempt + 1] ?? retryDelaysMs.at(-1) ?? 0);
  }
}

async function fetchLatestRelease(fetchImpl, releaseUrl, options) {
  return fetchMetadata(fetchImpl, releaseUrl, "application/vnd.github+json", async (response) => {
    const release = normalizeRelease(await response.json());
    if (!release) {
      const error = new Error(i18n.t("update.error.invalidRelease"));
      error.status = 422;
      throw error;
    }
    return release;
  }, options);
}

function responseText(response) {
  if (typeof response?.text === "function") return response.text();
  return Promise.resolve(response?.body ?? "");
}

function bodyToAsyncIterable(body) {
  // Explicit readers can cancel a pending read; async-generator return() may hang.
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        try { reader.releaseLock?.(); } catch {}
      }
    };
    return {
      [Symbol.asyncIterator]() { return this; },
      async next() {
        try {
          const result = await reader.read();
          if (result.done) release();
          return result;
        } catch (error) {
          release();
          throw error;
        }
      },
      async return() {
        if (!released) {
          try { await reader.cancel(); } finally { release(); }
        }
        return { done: true };
      }
    };
  }
  if (body && typeof body[Symbol.asyncIterator] === "function") return body[Symbol.asyncIterator]();
  throw new Error(i18n.t("update.error.missingStream"));
}

function createDownloadHttpError(status) {
  const error = new Error(i18n.t("update.error.downloadHttp", { status: status ?? "unknown" }));
  error.status = Number(status) || 0;
  return error;
}

function isRetryableDownloadError(error) {
  if (error?.downloadFilesystemError || error?.downloadIntegrityError) return false;
  const status = Number(error?.status) || 0;
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
}

function waitForRetry(delayMs) {
  const delay = Math.max(0, Number(delayMs) || 0);
  if (delay === 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delay));
}

// Retain only fully written, hashed prefixes during automatic network retries.
// A server ignoring Range is safe to consume only after resetting that prefix.
async function downloadToFile(fetchImpl, url, destinationPath, {
  expectedSize = 0,
  expectedChecksum = null,
  onProgress = () => {},
  logger = console,
  maxAttempts = DOWNLOAD_MAX_ATTEMPTS,
  retryDelaysMs = DOWNLOAD_RETRY_DELAYS_MS,
  requestTimeoutMs = 30e3,
  idleTimeoutMs = 30e3
} = {}) {
  const attempts = Math.max(1, Math.floor(Number(maxAttempts) || DOWNLOAD_MAX_ATTEMPTS));
  const total = Math.max(0, Number(expectedSize) || 0);
  const timeoutMs = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 30e3;
  let hash = createHash("sha256");
  let received = 0;
  let lastReportedAt = 0;
  let lastError = null;
  const checksum = /^[a-f0-9]{64}$/i.test(String(expectedChecksum)) ? String(expectedChecksum).toLowerCase() : null;
  const metadataPath = `${destinationPath}.partial.json`;
  const identity = JSON.stringify({ url, total, checksum });
  const persistent = Boolean(checksum && total > 0);

  async function filesystem(operation) {
    try { return await operation(); } catch (error) {
      // Failed writes may change the file without changing our hash: do not resume.
      const failure = new Error(error?.message || "Download file operation failed", { cause: error });
      failure.code = error?.code;
      failure.downloadFilesystemError = true;
      throw failure;
    }
  }

  async function resetPartialDownload() {
    await filesystem(() => fs.promises.rm(destinationPath, { force: true }));
    received = 0;
    hash = createHash("sha256");
  }

  // Never await broken cancellation implementations or leave rejected cleanup promises.
  function quietly(operation) {
    try { Promise.resolve(operation()).catch(() => {}); } catch {}
  }
  function cancelBody(body) {
    if (typeof body?.destroy === "function") quietly(() => body.destroy());
    else if (typeof body?.cancel === "function") quietly(() => body.cancel());
    else if (typeof body?.return === "function") quietly(() => body.return());
  }

  async function removeMetadata() {
    await fs.promises.rm(metadataPath, { force: true }).catch(() => {});
  }
  try {
    let reusable = false;
    if (persistent) {
      const metadata = await filesystem(async () => {
        try { return await fs.promises.readFile(metadataPath, "utf8"); }
        catch (error) { if (error.code === "ENOENT") return null; throw error; }
      });
      if (metadata === identity) {
        const stat = await filesystem(async () => {
          try { return await fs.promises.lstat(destinationPath); }
          catch (error) { if (error.code === "ENOENT") return null; throw error; }
        });
        if (stat?.isFile() && stat.size > 0 && stat.size <= total) {
          await filesystem(async () => {
            for await (const chunk of fs.createReadStream(destinationPath)) hash.update(chunk);
          });
          received = stat.size;
          reusable = received < total || hash.copy().digest("hex") === checksum;
          if (reusable && received === total) {
            await removeMetadata();
            onProgress({ received, total, pct: 100 });
            return { received, sha256: checksum };
          }
        }
      }
    }
    if (!reusable) await resetPartialDownload();
    if (persistent) await filesystem(() => fs.promises.writeFile(metadataPath, identity));
    else await removeMetadata();
  } catch (error) {
    await fs.promises.rm(destinationPath, { force: true }).catch(() => {});
    await removeMetadata();
    throw error;
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const resumeAt = received;
    const headers = { Accept: "application/octet-stream", "User-Agent": "WorkIsland-update-check" };
    if (resumeAt > 0) headers.Range = `bytes=${resumeAt}-`;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let response = null;
    let iterator = null;
    let handle = null;
    let abandoned = false;
    let resetOnFailure = false;
    const abort = () => quietly(() => controller?.abort());
    async function bounded(operation, duration, label) {
      let timer;
      try {
        return await Promise.race([
          Promise.resolve().then(operation),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              const error = new Error(`Update download ${label} timed out`);
              error.code = "ETIMEDOUT";
              reject(error);
              abort();
            }, timeoutMs(duration));
          })
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    try {
      response = await bounded(async () => {
        const result = await fetchImpl(url, { headers, signal: controller?.signal });
        // Fetch mocks and nonstandard transports may ignore abort and resolve late.
        if (abandoned) cancelBody(result?.body);
        return result;
      }, requestTimeoutMs, "request");
      if (resumeAt > 0 && response?.status === 416) {
        resetOnFailure = true;
        throw new Error("Update download server rejected Range");
      }
      if (!response?.ok) throw createDownloadHttpError(response?.status);
      let responseTotal = total;
      if (response.status === 206) {
        const range = String(response.headers?.get?.("content-range") ?? "").match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
        const [start, end, size] = range ? range.slice(1).map(Number) : [];
        if (!range || ![start, end, size].every(Number.isSafeInteger) || start !== resumeAt ||
            size <= start || end !== size - 1 || (total > 0 && size !== total)) {
          resetOnFailure = true;
          throw new Error("Update download returned an invalid Content-Range");
        }
        responseTotal = size;
      } else if (resumeAt > 0) {
        logger.warn?.("[UpdateService] download server ignored Range; restarting from byte 0");
        await resetPartialDownload();
      }

      iterator = bodyToAsyncIterable(response.body);
      handle = await filesystem(() => fs.promises.open(destinationPath, received > 0 ? "a" : "w"));
      for (;;) {
        const { done, value } = await bounded(() => iterator.next(), idleTimeoutMs, "stream idle");
        if (done) break;
        const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
        if (responseTotal > 0 && buffer.length > responseTotal - received) {
          resetOnFailure = true;
          throw new Error("Update download exceeded its expected length");
        }
        // writeFile completes short writes; hash/count commit only after full success.
        await filesystem(() => handle.writeFile(buffer));
        hash.update(buffer);
        received += buffer.length;
        const at = Date.now();
        if (at - lastReportedAt >= DOWNLOAD_PROGRESS_MIN_INTERVAL_MS) {
          lastReportedAt = at;
          onProgress({ received, total, pct: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0 });
        }
      }
      if (responseTotal > 0 && received !== responseTotal) {
        throw new Error(i18n.t("update.error.downloadIncomplete"));
      }
      const completedHandle = handle;
      handle = null;
      await filesystem(() => completedHandle.close());
      const sha256 = hash.copy().digest("hex");
      if (checksum && sha256 !== checksum) {
        const error = new Error(i18n.t("update.error.checksum"));
        error.downloadIntegrityError = true;
        throw error;
      }
      await removeMetadata();
      onProgress({ received, total, pct: 100 });
      logger.debug?.(`[UpdateService] downloaded ${received} bytes from ${url} in ${attempt} attempt(s)`);
      return { received, sha256 };
    } catch (error) {
      abandoned = true;
      abort();
      if (iterator) quietly(() => iterator.return?.());
      else cancelBody(response?.body);
      if (typeof response?.body?.destroy === "function") quietly(() => response.body.destroy());
      lastError = error;
      if (handle) {
        const failedHandle = handle;
        handle = null;
        try { await filesystem(() => failedHandle.close()); } catch (closeError) { lastError = closeError; }
      }
      if (resetOnFailure || (total > 0 && received >= total)) {
        try { await resetPartialDownload(); } catch (resetError) { lastError = resetError; }
      }
      if (attempt >= attempts || !isRetryableDownloadError(lastError)) break;
      logger.warn?.(`[UpdateService] download attempt ${attempt}/${attempts} failed; resuming`, lastError);
      await waitForRetry(retryDelaysMs[attempt] ?? retryDelaysMs.at?.(-1) ?? 0);
    }
  }
  // Only a metadata-bound, fully committed prefix survives a manual retry.
  if (!(persistent && received > 0 && received < total && isRetryableDownloadError(lastError))) {
    await fs.promises.rm(destinationPath, { force: true }).catch(() => {});
    await removeMetadata();
  }
  if (isRetryableDownloadError(lastError)) {
    throw new Error(i18n.t("update.error.downloadRetriesExhausted"), { cause: lastError });
  }
  throw lastError instanceof Error ? lastError : new Error(i18n.t("update.error.downloadFailed"));
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
      throw new Error(i18n.t("update.error.appMissing"));
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
        reject(new Error(String(stderr || error.message || i18n.t("update.error.installCommand"))));
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
  platform = process.platform,
  downloadRetryDelaysMs = DOWNLOAD_RETRY_DELAYS_MS,
  requestTimeoutMs = UPDATE_REQUEST_TIMEOUT_MS,
  downloadIdleTimeoutMs = 30e3,
  getInstallDir
} = {}) {
  if (!app || typeof app.getVersion !== "function") throw new TypeError("app.getVersion is required");
  const statePath = path.join(userDataPath || ".", UPDATE_STATE_FILE);
  let state = readState(statePath);
  let inFlight = null;
  let downloadInFlight = null;
  let lastFailedCheckAt = null;
  let initialTimer = null;
  let intervalTimer = null;
  let updateState = { phase: "idle", progress: null, release: null, error: null, downloadedPath: null };

  // 更新链路只覆盖 macOS（DMG 下载 + hdiutil 安装）；其他平台必须保持
  // unavailable，否则 Windows 会把 releases/latest 的 DMG 当成可用更新（issue #96）。
  const isSupportedPlatform = platform === "darwin";

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
    const latestVersion = updateState.release?.version ?? state.latestRelease?.version ?? null;
    const current = currentVersion();
    return {
      ...updateState,
      currentVersion: current,
      latestVersion,
      // 岛端升级箭头只在 onUpdateAvailable 推送时点亮；hasUpdate 让缓存里的
      // 新版本信息在重启后也能自行恢复入口（issue #98）。
      hasUpdate: latestVersion !== null && compareVersions(latestVersion, current) === 1,
      releaseUrl: updateState.release?.url ?? state.latestRelease?.url ?? DEFAULT_DOWNLOAD_URL
    };
  }

  function resultForRelease(release) {
    const current = currentVersion();
    const comparison = compareVersions(release.version, current);
    if (comparison === null) {
      return { status: "error", currentVersion: current, message: i18n.t("update.error.invalidVersion") };
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
        title: i18n.t("update.notification.available.title"),
        body: i18n.t("update.notification.available.body", { version: result.latestVersion })
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
        title: i18n.t("update.notification.ready.title"),
        body: i18n.t("update.notification.ready.body", { version: updateState.release?.version ?? "" })
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
    try {
      const release = await fetchLatestRelease(fetchImpl, releaseUrl, {
        timeoutMs: requestTimeoutMs, retryDelaysMs: downloadRetryDelaysMs, logger
      });
      state.lastCheckedAt = now();
      lastFailedCheckAt = null;
      state.latestRelease = release;
      writeState(statePath, state);
      const result = resultForRelease(release);
      if (result.status === "update-available") {
        try {
          onUpdateAvailable(result);
        } catch (error) {
          logger.warn?.("[UpdateService] onUpdateAvailable listener failed:", error);
        }
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
      lastFailedCheckAt = now();
      logger.warn?.("[UpdateService] check failed:", error);
      return {
        status: "error",
        currentVersion: currentVersion(),
        message: i18n.t("update.error.unavailable")
      };
    }
  }

  function check({ force = false, notify = true } = {}) {
    if (!isSupportedPlatform) {
      return Promise.resolve({ status: "unavailable", reason: "unsupported-platform", currentVersion: currentVersion() });
    }
    if (isDevelopment()) {
      return Promise.resolve({ status: "disabled", reason: "development", currentVersion: currentVersion() });
    }
    if (!force && getSettings()?.updateChecksEnabled === false) {
      return Promise.resolve({ status: "disabled", reason: "user-disabled", currentVersion: currentVersion() });
    }
    // Join an active request before considering cache/cooldown shortcuts.
    if (inFlight) return inFlight;
    if (!force && lastFailedCheckAt !== null && now() - lastFailedCheckAt < Math.min(60e3, intervalMs)) {
      return Promise.resolve({ status: "skipped", reason: "retry-backoff", currentVersion: currentVersion() });
    }
    if (!force && lastFailedCheckAt === null && state.lastCheckedAt && now() >= state.lastCheckedAt && now() - state.lastCheckedAt < minIntervalMs) {
      if (state.latestRelease) {
        const cachedResult = resultForRelease(state.latestRelease);
        // 缓存捷径不经过 runCheck 的推送链路；缓存里已有新版时补一次状态推送，
        // 否则 24h 内重启的岛端收不到任何消息，升级箭头不出现（issue #98）。
        if (cachedResult.status === "update-available" && updateState.phase === "idle") {
          publishState({ release: state.latestRelease });
        }
        return Promise.resolve(cachedResult);
      }
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
  function download() {
    if (downloadInFlight) return downloadInFlight;
    downloadInFlight = Promise.resolve().then(runDownload).finally(() => { downloadInFlight = null; });
    return downloadInFlight;
  }

  async function runDownload() {
    if (!isSupportedPlatform) return { ...getUpdateState(), error: i18n.t("update.error.unsupportedPlatform") };
    if (isDevelopment()) return { ...getUpdateState(), error: i18n.t("update.error.downloadInDevelopment") };
    if (updateState.phase === "downloading" || updateState.phase === "ready" || updateState.phase === "installing") {
      return getUpdateState();
    }
    let release = updateState.release ?? state.latestRelease ?? null;
    let result = null;
    const stale = !state.lastCheckedAt || now() < state.lastCheckedAt || now() - state.lastCheckedAt >= minIntervalMs;
    if (!release || !Array.isArray(release.assets) || stale || updateState.phase === "error" ||
        !pickDmgAsset(release.assets, arch) || !pickChecksumAsset(release.assets, arch)) {
      result = await check({ force: true, notify: false });
      release = state.latestRelease;
      if (result?.status !== "update-available" || !release) {
        publishState({ phase: result?.status === "error" ? "error" : "idle", error: result?.message ?? i18n.t("update.error.upToDate") });
        return getUpdateState();
      }
    }
    if (compareVersions(release.version, currentVersion()) !== 1) {
      publishState({ phase: "idle", error: i18n.t("update.error.upToDate"), release, downloadedPath: null, progress: null });
      return getUpdateState();
    }
    const asset = pickDmgAsset(release.assets, arch);
    if (!asset) {
      publishState({ phase: "error", error: i18n.t("update.error.assetMissing") });
      return getUpdateState();
    }
    const downloadDir = path.join(userDataPath || ".", UPDATE_DOWNLOAD_DIR);
    if (path.basename(asset.name) !== asset.name || /[\\/]/.test(asset.name)) {
      publishState({ phase: "error", error: i18n.t("update.error.assetMissing") });
      return getUpdateState();
    }
    const destinationPath = path.join(downloadDir, asset.name);
    publishState({ phase: "downloading", progress: { received: 0, total: asset.size, pct: 0 }, release, error: null, downloadedPath: null });
    try {
      const checksumAsset = pickChecksumAsset(release.assets, arch);
      if (!checksumAsset) throw new Error(i18n.t("update.error.checksum"));
      const expected = await fetchMetadata(fetchImpl, checksumAsset.url, "text/plain", async (response) => {
        const value = extractChecksum(await responseText(response), asset.name);
        if (!value) {
          const error = new Error(i18n.t("update.error.checksum"));
          error.status = 422;
          throw error;
        }
        return value;
      }, { timeoutMs: requestTimeoutMs, retryDelaysMs: downloadRetryDelaysMs, logger });
      fs.mkdirSync(downloadDir, { recursive: true });
      const { sha256 } = await downloadToFile(fetchImpl, asset.url, destinationPath, {
        expectedSize: asset.size,
        expectedChecksum: expected,
        requestTimeoutMs,
        idleTimeoutMs: downloadIdleTimeoutMs,
        onProgress: (progress) => publishState({ progress }),
        logger,
        retryDelaysMs: downloadRetryDelaysMs
      });
      if (expected !== sha256) {
        await fs.promises.rm(destinationPath, { force: true }).catch(() => {});
        throw new Error(i18n.t("update.error.checksum"));
      }
      publishState({ phase: "ready", progress: { received: asset.size, total: asset.size, pct: 100 }, downloadedPath: destinationPath, error: null });
      showReadyNotification();
      return getUpdateState();
    } catch (error) {
      // The transfer helper retains only identity-bound resumable data; checksum
      // metadata failures must not discard a previous partial download.
      logger.warn?.("[UpdateService] download failed:", error);
      publishState({ phase: "error", error: error?.message || i18n.t("update.error.downloadFailed") });
      return getUpdateState();
    }
  }

  // 安装已下载的更新：挂载 DMG、替换当前安装目录内的应用并重启。
  // 任何一步失败都会回退为打开 DMG，让用户手动拖拽安装。
  async function install() {
    if (!isSupportedPlatform) return { ...getUpdateState(), error: i18n.t("update.error.unsupportedPlatform") };
    if (isDevelopment()) return { ...getUpdateState(), error: i18n.t("update.error.installInDevelopment") };
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
          ? i18n.t("update.error.manualInstall")
          : error?.message || i18n.t("update.error.installFailed")
      });
      return getUpdateState();
    }
  }

  function start() {
    if (!isSupportedPlatform || isDevelopment() || initialTimer || intervalTimer) return;
    initialTimer = setTimeout(() => {
      initialTimer = null;
      void check().catch(() => {});
      // Poll cheaply through the successful-check cache; failed checks can recover
      // after a short backoff rather than waiting another 24 hours.
      intervalTimer = setInterval(() => void check().catch(() => {}), Math.min(intervalMs, 60e3));
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
