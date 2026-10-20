import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { after, test } from "node:test";

const require = createRequire(import.meta.url);

// 集成测试：在假 HOME / 假 Electron 环境里跑真实的 DeepSeekHarnessHookManager，
// 验证「自动接入」的完整编排（pnpm 调用、profile 改写、配置写入、幂等）。
// ps 与 pnpm 由 fake execFile 模拟，真实 pnpm 行为已由手动 smoke 验证。

const sandbox = mkdtempSync(join(tmpdir(), "workisland-dsh-auto-"));
const homeDir = join(sandbox, "home");
const resourcesPath = join(sandbox, "resources");
const bridgeDir = join(resourcesPath, "dsh-workisland-bridge");
const profileDir = join(homeDir, ".dsh", "profiles", "web");
mkdirSync(profileDir, { recursive: true });
mkdirSync(bridgeDir, { recursive: true });
writeFileSync(join(bridgeDir, "package.json"), JSON.stringify({
  name: "@workisland/dsh-bridge",
  version: "1.0.1",
  type: "module"
}, null, 2));
writeFileSync(join(bridgeDir, "index.mjs"), "export function apply() {}\n");
writeFileSync(join(profileDir, "package.json"), JSON.stringify({
  name: "web",
  dsh: { profile: { bundles: [] } }
}, null, 2) + "\n");

const psOutput = "55307 ?? S 0:00 node /opt/dsh/lib/bin.js web --port 3080 --no-open HOME=/Users/u\n";
let pnpmAdds = 0;
let pnpmRemoves = 0;

function fakeExecFile(file, args, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  const done = (error, result) => process.nextTick(() => callback(error, result));
  if (file === "/bin/ps") return done(null, { stdout: psOutput, stderr: "" });
  const command = Array.isArray(args) ? args.join(" ") : "";
  if (/\bpnpm\b/.test(command) && /\badd\b/.test(command)) {
    pnpmAdds += 1;
    const packagePath = join(profileDir, "package.json");
    const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
    pkg.dependencies = { ...(pkg.dependencies || {}), "@workisland/dsh-bridge": `file:${bridgeDir}` };
    writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");
    const installedDir = join(profileDir, "node_modules", "@workisland", "dsh-bridge");
    mkdirSync(installedDir, { recursive: true });
    writeFileSync(join(installedDir, "package.json"), JSON.stringify({
      name: "@workisland/dsh-bridge",
      version: "1.0.1"
    }));
    return done(null, { stdout: "", stderr: "" });
  }
  if (/\bpnpm\b/.test(command) && /\bremove\b/.test(command)) {
    pnpmRemoves += 1;
    const packagePath = join(profileDir, "package.json");
    const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
    if (pkg.dependencies) delete pkg.dependencies["@workisland/dsh-bridge"];
    writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");
    return done(null, { stdout: "", stderr: "" });
  }
  done(null, { stdout: "", stderr: "" });
}

const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "electron") return { app: { getAppPath: () => sandbox, isPackaged: false } };
  if (request === "@electron-toolkit/utils") return { is: { dev: false } };
  if (request === "node:child_process") return { execFile: fakeExecFile };
  return originalLoad.call(this, request, parent, isMain);
};

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalShell = process.env.SHELL;
const originalResourcesPath = process.resourcesPath;
// os.homedir() 在 Windows 读 USERPROFILE，在 macOS/Linux 读 HOME。
process.env.HOME = homeDir;
process.env.USERPROFILE = homeDir;
process.env.SHELL = "/bin/zsh";
process.resourcesPath = resourcesPath;

const { DeepSeekHarnessHookManager } = require("../src/main/hooks-custom.cjs");

after(() => {
  Module._load = originalLoad;
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  process.env.SHELL = originalShell;
  process.resourcesPath = originalResourcesPath;
});

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

test("first launch auto-installs the bridge into an initialized DSH profile", async () => {
  const manager = new DeepSeekHarnessHookManager();
  assert.equal(await manager.isAvailable(), true);
  await manager.install();
  assert.equal(pnpmAdds, 1, "first install must run pnpm add once");
  const profile = readJson(join(profileDir, "package.json"));
  assert.equal(profile.dependencies["@workisland/dsh-bridge"], `file:${bridgeDir}`);
  assert.deepEqual(profile.dsh.profile.bundles, ["@workisland/dsh-bridge"]);
  const config = readJson(manager.configPath);
  assert.match(config.command, /--source ['"]?dsh['"]?/);
  assert.equal(config.restartRequired, true, "a running DSH needs a restart after the first install");
  assert.deepEqual(config.profiles.map((item) => item.name), ["web"]);
  assert.ok(config.profiles[0].pid, "launcher-started DSH is discovered without --profile");
});

test("steady-state launches are idempotent and never uninstall first", async () => {
  const manager = new DeepSeekHarnessHookManager();
  await manager.install();
  await manager.install();
  assert.equal(pnpmAdds, 1, "a healthy profile must not be reinstalled");
  assert.equal(pnpmRemoves, 0, "auto reconciliation must not remove the bridge");
  const config = readJson(manager.configPath);
  assert.equal(config.restartRequired, true);
});

test("checkHealth reports a written-but-not-yet-restarted bridge as configured, then verified after a real event", async () => {
  const manager = new DeepSeekHarnessHookManager();
  const before = await manager.checkHealth();
  assert.equal(before.installed, true);
  assert.equal(before.connectionState, "configured");
  assert.equal(before.restartRequired, true);
  assert.match(before.issues[0], /重启/);

  await manager.recordEvent({ type: "activityUpdated" });
  const afterRestart = await manager.checkHealth();
  assert.equal(afterRestart.restartRequired, false);
  assert.equal(afterRestart.connectionState, "verified");
});

test("checkHealth recognizes the Windows-quoted --source command produced by install()", async () => {
  const manager = new DeepSeekHarnessHookManager();
  const original = readJson(manager.configPath);
  writeFileSync(manager.configPath, JSON.stringify({
    ...original,
    command: 'if not exist "C:\\WorkIsland\\WorkIsland.exe" exit /b 0 & set "ELECTRON_RUN_AS_NODE=1"&& "C:\\WorkIsland\\WorkIsland.exe" "C:\\WorkIsland\\resources\\bin\\flux-hooks" --source "dsh"'
  }, null, 2) + "\n");
  const health = await manager.checkHealth();
  assert.equal(health.installed, true);
  writeFileSync(manager.configPath, JSON.stringify(original, null, 2) + "\n");
});

test("manual uninstall accepts options and removes the bundle", async () => {
  const manager = new DeepSeekHarnessHookManager();
  await manager.uninstall({ preserveVerification: true });
  assert.equal(pnpmRemoves, 1);
  const profile = readJson(join(profileDir, "package.json"));
  assert.equal(profile.dependencies?.["@workisland/dsh-bridge"], undefined);
  assert.deepEqual(profile.dsh.profile.bundles, []);
});

test("install refuses to invent a profile when DSH was never started", async () => {
  const otherHome = join(sandbox, "fresh-home");
  mkdirSync(otherHome, { recursive: true });
  process.env.HOME = otherHome;
  process.env.USERPROFILE = otherHome;
  const manager = new DeepSeekHarnessHookManager();
  assert.equal(await manager.isAvailable(), false);
  await assert.rejects(manager.install(), /未检测到已初始化的 DeepSeek Harness profile/);
  const health = await manager.checkHealth();
  assert.equal(health.available, false);
  assert.equal(health.installed, false);
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  assert.equal(existsSync(manager.configPath), false);
});