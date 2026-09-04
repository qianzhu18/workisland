import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  compareVersions,
  createUpdateService,
  extractChecksum,
  pickDmgAsset,
  pickChecksumAsset
} = require("../src/main/update-service.cjs");

function makeApp(version, isPackaged = true) {
  return { isPackaged, getVersion: () => version };
}

test("version comparison treats stable releases as newer than prereleases", () => {
  assert.equal(compareVersions("1.0.0", "1.0.0-beta.2"), 1);
  assert.equal(compareVersions("1.0.0-beta.10", "1.0.0-beta.2"), 1);
  assert.equal(compareVersions("1.2.0", "1.10.0"), -1);
  assert.equal(compareVersions("v1.0.0", "1.0.0"), 0);
});

test("update service reports and notifies about a newer stable release once", async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), "workisland-update-"));
  const shown = [];
  const opened = [];
  const available = [];
  class FakeNotification {
    static isSupported() { return true; }
    constructor(options) { this.options = options; }
    on(event, handler) { if (event === "click") this.click = handler; }
    show() { shown.push(this); }
  }
  const service = createUpdateService({
    platform: "darwin",
    app: makeApp("0.2.0"),
    shell: { openExternal: (url) => opened.push(url) },
    notificationClass: FakeNotification,
    userDataPath,
    onUpdateAvailable: (update) => available.push(update),
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        tag_name: "v0.3.0",
        name: "WorkIsland 0.3.0",
        html_url: "https://github.com/qianzhu18/workisland/releases/tag/v0.3.0",
        prerelease: false
      })
    }),
    logger: { warn() {} }
  });

  const first = await service.check({ force: true });
  assert.equal(first.status, "update-available");
  assert.equal(first.latestVersion, "0.3.0");
  assert.equal(available.length, 1);
  assert.equal(shown.length, 1);
  shown[0].click();
  assert.deepEqual(opened, [first.releaseUrl]);

  await service.check({ force: true });
  assert.equal(shown.length, 1);
});

test("development builds never contact the release endpoint", async () => {
  let fetchCount = 0;
  const service = createUpdateService({
    platform: "darwin",
    app: makeApp("0.2.0", false),
    userDataPath: mkdtempSync(join(tmpdir(), "workisland-update-dev-")),
    fetchImpl: async () => {
      fetchCount += 1;
      return { ok: true, json: async () => ({ tag_name: "v9.0.0" }) };
    }
  });
  const result = await service.check({ force: true });
  assert.equal(result.status, "disabled");
  assert.equal(fetchCount, 0);
});

function asset(name, size = 0) {
  return { name, size, browser_download_url: `https://github.com/qianzhu18/workisland/releases/download/v1.0.0/${name}` };
}

const RELEASE_API_URL = "https://api.github.com/repos/qianzhu18/workisland/releases/latest";

test("pickDmgAsset selects the asset matching the current architecture", () => {
  const assets = [asset("SHA256SUMS.txt"), asset("WorkIsland-1.0.0-arm64.dmg", 100), asset("WorkIsland-1.0.0-x64.dmg", 110)];
  assert.equal(pickDmgAsset(assets, "arm64").name, "WorkIsland-1.0.0-arm64.dmg");
  assert.equal(pickDmgAsset(assets, "x64").name, "WorkIsland-1.0.0-x64.dmg");
});

test("pickDmgAsset falls back to universal and untagged images, never the other arch", () => {
  const universal = [asset("WorkIsland-1.0.0-universal.dmg"), asset("WorkIsland-1.0.0-arm64.dmg")];
  assert.equal(pickDmgAsset(universal, "x64").name, "WorkIsland-1.0.0-universal.dmg");
  const untagged = [asset("WorkIsland-1.0.0.dmg"), asset("SHA256SUMS.txt")];
  assert.equal(pickDmgAsset(untagged, "arm64").name, "WorkIsland-1.0.0.dmg");
  const intelOnly = [asset("WorkIsland-1.0.0-x64.dmg")];
  assert.equal(pickDmgAsset(intelOnly, "arm64"), null);
  assert.equal(pickDmgAsset([asset("SHA256SUMS.txt")], "arm64"), null);
});

test("extractChecksum reads sha256sum formatted lines", () => {
  const text = [
    "3a5f3cbec74b26cbaa7e8ec9c1ef2c1e2b64c1a6f2e5c8d9b0a1f2e3d4c5b6a7  WorkIsland-1.0.0-arm64.dmg",
    "b6a7c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6  WorkIsland-1.0.0-x64.dmg",
    ""
  ].join("\n");
  assert.equal(extractChecksum(text, "WorkIsland-1.0.0-arm64.dmg"), "3a5f3cbec74b26cbaa7e8ec9c1ef2c1e2b64c1a6f2e5c8d9b0a1f2e3d4c5b6a7");
  assert.equal(extractChecksum(text, "missing.dmg"), null);
  assert.equal(pickChecksumAsset([asset("SHA256SUMS.txt"), asset("WorkIsland-1.0.0-arm64.dmg")]).name, "SHA256SUMS.txt");
});

test("pickChecksumAsset prefers the per-arch sums file", () => {
  const assets = [asset("SHA256SUMS.txt"), asset("SHA256SUMS-arm64.txt"), asset("SHA256SUMS-x64.txt")];
  assert.equal(pickChecksumAsset(assets, "arm64").name, "SHA256SUMS-arm64.txt");
  assert.equal(pickChecksumAsset(assets, "x64").name, "SHA256SUMS-x64.txt");
  assert.equal(pickChecksumAsset([asset("SHA256SUMS.txt")], "x64").name, "SHA256SUMS.txt");
});

function releasePayload() {
  return {
    tag_name: "v1.0.0",
    name: "WorkIsland 1.0.0",
    html_url: "https://github.com/qianzhu18/workisland/releases/tag/v1.0.0",
    prerelease: false,
    assets: [
      asset("SHA256SUMS.txt"),
      asset("WorkIsland-1.0.0-arm64.dmg", 8),
      asset("WorkIsland-1.0.0-x64.dmg", 8)
    ]
  };
}

// 构造一个假的 fetch：release API 返回 payload，DMG 资产按块流出，
// SHA256SUMS.txt 返回给定的校验文本。
function makeFetchImpl({ payload, dmgBytes, checksumText, onDmgFetch } = {}) {
  return async (url) => {
    if (url === RELEASE_API_URL) {
      return { ok: true, json: async () => payload };
    }
    if (url === payload.assets[1].browser_download_url) {
      onDmgFetch?.();
      return {
        ok: true,
        headers: { get: () => String(dmgBytes.length) },
        body: (async function* () { yield dmgBytes.subarray(0, 4); yield dmgBytes.subarray(4); })()
      };
    }
    if (url.endsWith("SHA256SUMS.txt")) {
      return { ok: true, text: async () => checksumText };
    }
    return { ok: false, status: 404 };
  };
}

async function prepareDownloadedService({ userDataPath, runner, getInstallDir, relaunch, quit, openPath }) {
  const { createHash } = await import("node:crypto");
  const dmgBytes = Buffer.from("12345678", "utf8");
  const dmgSha256 = createHash("sha256").update(dmgBytes).digest("hex");
  const service = createUpdateService({
    platform: "darwin",
    app: makeApp("0.9.0"),
    userDataPath,
    arch: "arm64",
    fetchImpl: makeFetchImpl({
      payload: releasePayload(),
      dmgBytes,
      checksumText: `${dmgSha256}  WorkIsland-1.0.0-arm64.dmg\n`
    }),
    notificationClass: null,
    runner,
    getInstallDir,
    relaunch,
    quit,
    openPath,
    logger: { warn() {}, debug() {} }
  });
  const checked = await service.check({ force: true, notify: false });
  assert.equal(checked.status, "update-available");
  return service;
}

test("download verifies checksum and reaches the ready phase", async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), "workisland-update-dl-"));
  const service = await prepareDownloadedService({ userDataPath });
  const state = await service.download();
  assert.equal(state.phase, "ready");
  assert.ok(existsSync(state.downloadedPath));
  assert.equal(state.progress.pct, 100);
  assert.equal(state.progress.received, 8);
  assert.ok(state.downloadedPath.endsWith("WorkIsland-1.0.0-arm64.dmg"));
});

test("checksum mismatch aborts the download with an error state", async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), "workisland-update-bad-"));
  const { createHash } = await import("node:crypto");
  const dmgBytes = Buffer.from("12345678", "utf8");
  const payload = releasePayload();
  const service = createUpdateService({
    platform: "darwin",
    app: makeApp("0.9.0"),
    userDataPath,
    arch: "arm64",
    fetchImpl: makeFetchImpl({
      payload,
      dmgBytes,
      checksumText: `${"0".repeat(64)}  WorkIsland-1.0.0-arm64.dmg\n`
    }),
    notificationClass: null,
    logger: { warn() {}, debug() {} }
  });
  await service.check({ force: true, notify: false });
  const state = await service.download();
  assert.equal(state.phase, "error");
  assert.match(state.error, /校验失败/);
  assert.equal(existsSync(state.downloadedPath), false);
});

test("download failure surfaces an error state with the message", async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), "workisland-update-dl-err-"));
  const payload = releasePayload();
  const service = createUpdateService({
    platform: "darwin",
    app: makeApp("0.9.0"),
    userDataPath,
    arch: "arm64",
    fetchImpl: async (url) => {
      if (url === RELEASE_API_URL) return { ok: true, json: async () => payload };
      return { ok: false, status: 502 };
    },
    notificationClass: null,
    logger: { warn() {}, debug() {} }
  });
  await service.check({ force: true, notify: false });
  const state = await service.download();
  assert.equal(state.phase, "error");
  assert.match(state.error, /下载失败/);
});

test("install mounts the dmg, copies the app and relaunches", async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), "workisland-update-install-"));
  const installDir = mkdtempSync(join(tmpdir(), "workisland-update-apps-"));
  const calls = [];
  const { mkdirSync, writeFileSync, cpSync } = await import("node:fs");
  const runner = async (file, args) => {
    calls.push([file, args]);
    if (file === "hdiutil" && args[0] === "attach") {
      const mountPoint = args[args.length - 1];
      mkdirSync(join(mountPoint, "WorkIsland.app", "Contents", "MacOS"), { recursive: true });
      writeFileSync(join(mountPoint, "WorkIsland.app", "Contents", "MacOS", "WorkIsland"), "Mach-O");
      return "";
    }
    if (file === "/usr/bin/ditto") {
      cpSync(args[0], args[1], { recursive: true });
      return "";
    }
    return "";
  };
  const service = await prepareDownloadedService({
    userDataPath,
    runner,
    getInstallDir: () => installDir,
    relaunch: () => { calls.push(["relaunch"]); },
    quit: () => { calls.push(["quit"]); }
  });
  await service.download();
  const installed = await service.install();
  assert.equal(installed.installed, true);
  assert.ok(existsSync(join(installDir, "WorkIsland.app", "Contents", "MacOS", "WorkIsland")));
  assert.ok(calls.some(([file, args]) => file === "hdiutil" && args[0] === "attach"));
  assert.ok(calls.some(([file, args]) => file === "hdiutil" && args[0] === "detach"));
  assert.deepEqual(
    calls.filter(([file]) => file === "relaunch" || file === "quit").map(([file]) => file),
    ["relaunch", "quit"]
  );
  assert.equal(service.getUpdateState().phase, "idle");
});

test("failed install falls back to opening the dmg for manual drag install", async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), "workisland-update-manual-"));
  const opened = [];
  const service = await prepareDownloadedService({
    userDataPath,
    runner: async (file) => {
      if (file === "hdiutil") throw new Error("hdiutil failed");
      return "";
    },
    openPath: (value) => { opened.push(value); }
  });
  await service.download();
  const state = await service.install();
  assert.equal(state.phase, "manual");
  assert.equal(opened.length, 1);
  assert.match(state.error, /拖入「应用程序」/);
});

test("relaunch inside the check interval restores the update arrow from cache without network", async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), "workisland-update-relaunch-"));
  const first = createUpdateService({
    platform: "darwin",
    app: makeApp("1.2.0"),
    userDataPath,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        tag_name: "v1.3.0",
        name: "WorkIsland 1.3.0",
        html_url: "https://github.com/qianzhu18/workisland/releases/tag/v1.3.0",
        prerelease: false
      })
    }),
    logger: { warn() {} }
  });
  assert.equal((await first.check({ force: true })).status, "update-available");

  // 模拟 24h 内重启：新实例读到同一份 update-check.json，命中缓存捷径。
  const statePushes = [];
  const relaunched = createUpdateService({
    platform: "darwin",
    app: makeApp("1.2.0"),
    userDataPath,
    onUpdateState: (pushed) => statePushes.push(pushed),
    fetchImpl: async () => {
      throw new Error("cache shortcut must not hit the network");
    },
    logger: { warn() {} }
  });
  const result = await relaunched.check();
  assert.equal(result.status, "update-available");
  assert.equal(result.latestVersion, "1.3.0");

  const state = relaunched.getUpdateState();
  assert.equal(state.hasUpdate, true);
  assert.equal(state.latestVersion, "1.3.0");
  assert.ok(
    statePushes.some((pushed) => pushed.hasUpdate === true && pushed.latestVersion === "1.3.0"),
    "cache shortcut should push state so the island can relight the upgrade arrow"
  );
});

test("hasUpdate stays false when the cache is empty or already up to date", async () => {
  const empty = createUpdateService({
    platform: "darwin",
    app: makeApp("1.2.0"),
    userDataPath: mkdtempSync(join(tmpdir(), "workisland-update-empty-")),
    fetchImpl: async () => { throw new Error("no network expected"); },
    logger: { warn() {} }
  });
  assert.equal(empty.getUpdateState().hasUpdate, false);

  const userDataPath = mkdtempSync(join(tmpdir(), "workisland-update-uptodate-"));
  const upToDate = createUpdateService({
    platform: "darwin",
    app: makeApp("1.3.0"),
    userDataPath,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ tag_name: "v1.3.0", name: "WorkIsland 1.3.0", prerelease: false })
    }),
    logger: { warn() {} }
  });
  assert.equal((await upToDate.check({ force: true })).status, "up-to-date");
  assert.equal(upToDate.getUpdateState().hasUpdate, false);
});
