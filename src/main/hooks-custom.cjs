"use strict";

const electron = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const promises = require("node:fs/promises");
const log = require("electron-log");
const utils = require("@electron-toolkit/utils");
const { getSocketPath } = require("./bridge-protocol.cjs");
const { shellQuote, buildDevHooksCliCommand, wrapWithInstallCheck } = require("./hook-shared.cjs");
const { discoverRunningDshProfiles } = require("./dsh-profile-discovery.cjs");
const { needsBridgeReinstall, isDshVerificationCurrent, buildDshBridgeConfig, DSH_BRIDGE_PACKAGE } = require("../shared/dsh-auto-connect.cjs");
const { createSerializedJsonUpdater } = require("./serialized-json-updater.cjs");
const execFileAsync = promisify(execFile);

function commandQuote(value) { return `'${String(value).replace(/'/g, `'\\''`)}'`; }
async function runProfilePnpm(profileDir, args) {
  const shell = fs.existsSync(process.env.SHELL || "") ? process.env.SHELL : "/bin/zsh";
  const command = ["pnpm", ...args].map(commandQuote).join(" ");
  return execFileAsync(shell, ["-l", "-c", command], { cwd: profileDir, encoding: "utf8", timeout: 300000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 });
}

function createPluginContext(pluginId, opts) {
  const prefix = `[Plugin:${pluginId}]`;
  const allowedPrefixes = [
    path.resolve(opts.homeDir, `.${pluginId}`),
    path.resolve(opts.homeDir, ".flux"),
    path.resolve(opts.homeDir, ".config", pluginId)
  ];
  function assertPathAllowed(path$12) {
    const resolved = path.resolve(path$12);
    const allowed = allowedPrefixes.some((root) => {
      return resolved === root || resolved.startsWith(root + "/");
    });
    if (!allowed) {
      throw new Error(`${prefix} path not allowed: ${path$12}`);
    }
  }
  return {
    homeDir: opts.homeDir,
    hookCommand: opts.hookCommand,
    socketPath: opts.socketPath,
    async readJson(path2) {
      assertPathAllowed(path2);
      try {
        const raw = await promises.readFile(path2, "utf-8");
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    async writeJson(path$12, data) {
      assertPathAllowed(path$12);
      await promises.mkdir(path.dirname(path$12), { recursive: true });
      const tmp = path.join(os.tmpdir(), `flux-plugin-${crypto.randomUUID()}.json`);
      const content = JSON.stringify(data, null, 2) + "\n";
      await promises.writeFile(tmp, content, "utf-8");
      await promises.rename(tmp, path$12);
    },
    async readText(path2) {
      assertPathAllowed(path2);
      try {
        return await promises.readFile(path2, "utf-8");
      } catch {
        return null;
      }
    },
    async writeText(path$12, content) {
      assertPathAllowed(path$12);
      await promises.mkdir(path.dirname(path$12), { recursive: true });
      await promises.writeFile(path$12, content, "utf-8");
    },
    async ensureDir(path2) {
      assertPathAllowed(path2);
      await promises.mkdir(path2, { recursive: true });
    },
    async removeFile(path2) {
      assertPathAllowed(path2);
      await promises.unlink(path2).catch(() => {
      });
    },
    log: {
      info: (...args) => log.info(prefix, ...args),
      warn: (...args) => log.warn(prefix, ...args),
      error: (...args) => log.error(prefix, ...args)
    }
  };
}
function readPackageVersion(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version || null; } catch { return null; }
}
function getHookBinaryPath() {
  const resourcesPath = process.resourcesPath ?? path.join(electron.app.getAppPath(), "resources");
  return path.resolve(resourcesPath, "bin", "flux-hooks");
}
function buildSourceHookCommand(sourceArg) {
  if (utils.is.dev) {
    return buildDevHooksCliCommand(sourceArg);
  }
  const bin = getHookBinaryPath();
  return wrapWithInstallCheck(
    process.execPath,
    `ELECTRON_RUN_AS_NODE=1 ${shellQuote(process.execPath)} ${shellQuote(bin)} --source ${shellQuote(sourceArg)}`
  );
}
function buildHookCommand(pluginId) { return buildSourceHookCommand(`plugin:${pluginId}`); }
class PluginHookManager {
  constructor(plugin) {
    this.plugin = plugin;
    this.agentId = `plugin:${plugin.id}`;
  }
  agentId;
  createCtx() {
    return createPluginContext(this.plugin.id, {
      homeDir: os.homedir(),
      hookCommand: buildHookCommand(this.plugin.id),
      socketPath: getSocketPath()
    });
  }
  async install(_options) {
    const ctx = this.createCtx();
    await this.plugin.install(ctx);
    log.info("[PluginHookManager:%s] installed", this.plugin.id);
  }
  async uninstall(options = {}) {
    const ctx = this.createCtx();
    await this.plugin.uninstall(ctx);
    log.info("[PluginHookManager:%s] uninstalled", this.plugin.id);
  }
  async checkHealth() {
    const issues = [];
    const binaryPath = getHookBinaryPath();
    if (!utils.is.dev && !fs.existsSync(binaryPath)) {
      issues.push(`Hook binary not found: ${binaryPath}`);
    }
    const ctx = this.createCtx();
    let pluginReport;
    try {
      pluginReport = await this.plugin.checkHealth(ctx);
    } catch (err) {
      issues.push(`Plugin checkHealth threw: ${err.message}`);
      return {
        agentId: this.agentId,
        installed: false,
        issues,
        // Plugin 维度没有统一 manifest 文件，留空字符串与现有契约对齐。
        manifestPath: ""
      };
    }
    issues.push(...pluginReport.issues);
    return {
      agentId: this.agentId,
      installed: pluginReport.installed && issues.length === 0,
      issues,
      manifestPath: ""
    };
  }
}
class DeepSeekHarnessHookManager {
  agentId = "dsh";
  configPath = path.join(os.homedir(), ".flux", "dsh-workisland-bridge.json");
  defaultProfileDir = path.join(os.homedir(), ".dsh", "profiles", "web");
  updateConfig = createSerializedJsonUpdater(this.configPath);
  async readConfig() {
    try { return JSON.parse(await promises.readFile(this.configPath, "utf8")); } catch { return null; }
  }
  async readProfile(profileDir) {
    try { return JSON.parse(await promises.readFile(path.join(profileDir, "package.json"), "utf8")); } catch { return null; }
  }
  async discoverActiveProfiles() {
    const { stdout } = await execFileAsync("/bin/ps", ["-axo", "pid=,command="], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    // launcher 用 `dsh web --port 3080` 启动时命令行里没有 --profile，所以不能
    // 只按 --profile 筛候选；先粗筛 DSH 进程，再用 eww 读 DSH_HOME/端口。
    const candidatePids = String(stdout).split(/\r?\n/)
      .filter((line) => /\bdsh\b/.test(line))
      .filter((line) => /(?:^|\s)--profile(?:=|\s+)/.test(line) || /(?:^|\s)(?:web|tui|headless|acp|sdk)(?:\s|$)/.test(line))
      .map((line) => line.trim().match(/^(\d+)\b/)?.[1])
      .filter(Boolean);
    const detailed = [];
    for (const pid of candidatePids) {
      try {
        const result = await execFileAsync("/bin/ps", ["eww", "-p", pid, "-o", "pid=,command="], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
        detailed.push(result.stdout);
      } catch {}
    }
    return discoverRunningDshProfiles(detailed.join("\n"), { homeDir: path.dirname(path.dirname(this.defaultProfileDir)) });
  }
  async targetProfiles() {
    const active = await this.discoverActiveProfiles();
    const initialized = active.filter((item) => fs.existsSync(path.join(item.profileDir, "package.json")));
    if (initialized.length > 0) return initialized;
    const homeDir = path.dirname(path.dirname(this.defaultProfileDir));
    const preferred = ["web", "desktop", "tui", "headless"];
    for (const name of preferred) {
      const profileDir = path.join(homeDir, "profiles", name);
      if (fs.existsSync(path.join(profileDir, "package.json"))) return [{ name, homeDir, profileDir }];
    }
    // 最后兜底：DSH 装过但 profile 名不是常见的几个时，取最近修改过的已初始化 profile。
    try {
      const profilesRoot = path.join(homeDir, "profiles");
      const candidates = fs.readdirSync(profilesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(profilesRoot, entry.name))
        .filter((profileDir) => fs.existsSync(path.join(profileDir, "package.json")))
        .map((profileDir) => ({ profileDir, mtime: fs.statSync(path.join(profileDir, "package.json")).mtimeMs }))
        .sort((left, right) => right.mtime - left.mtime);
      if (candidates.length > 0) {
        const profileDir = candidates[0].profileDir;
        return [{ name: path.basename(profileDir), homeDir, profileDir }];
      }
    } catch {}
    return [];
  }
  async isAvailable() {
    try { return (await this.targetProfiles()).length > 0; } catch { return false; }
  }
  async updateProfileBundle(profilePath, enabled) {
    const profile = JSON.parse(await promises.readFile(profilePath, "utf8"));
    const bundles = Array.isArray(profile.dsh?.profile?.bundles) ? profile.dsh.profile.bundles : [];
    const nextBundles = enabled
      ? [...new Set([...bundles, DSH_BRIDGE_PACKAGE])]
      : bundles.filter((bundle) => bundle !== DSH_BRIDGE_PACKAGE);
    profile.dsh = { ...profile.dsh, profile: { ...profile.dsh?.profile, bundles: nextBundles } };
    await promises.writeFile(profilePath, JSON.stringify(profile, null, 2) + "\n", "utf8");
  }
  async install() {
    const existing = await this.readConfig();
    const command = buildSourceHookCommand("dsh");
    const bundlePath = utils.is.dev
      ? path.join(electron.app.getAppPath(), "resources", "dsh-workisland-bridge")
      : path.join(process.resourcesPath, "dsh-workisland-bridge");
    const desiredVersion = readPackageVersion(bundlePath);
    const targets = await this.targetProfiles();
    if (targets.length === 0) {
      throw new Error("未检测到已初始化的 DeepSeek Harness profile；启动一次 DSH 后 WorkIsland 会自动连接");
    }
    let changed = false;
    for (const target of targets) {
      const profilePath = path.join(target.profileDir, "package.json");
      let profile = await this.readProfile(target.profileDir);
      if (!profile) throw new Error(`DeepSeek Harness ${target.name} profile 读取失败`);
      const dependencySpec = profile.dependencies?.[DSH_BRIDGE_PACKAGE];
      const targetNodeModules = path.join(target.profileDir, "node_modules", ...DSH_BRIDGE_PACKAGE.split("/"), "package.json");
      const nodeModulesPresent = fs.existsSync(targetNodeModules);
      const installedVersion = readPackageVersion(path.dirname(targetNodeModules));
      if (needsBridgeReinstall({
        dependencySpec,
        desiredSpec: `file:${bundlePath}`,
        profileDir: target.profileDir,
        nodeModulesPresent,
        installedVersion,
        desiredVersion
      })) {
        try {
          await runProfilePnpm(target.profileDir, ["add", `file:${bundlePath}`]);
        } catch (error) {
          throw new Error(`DeepSeek Harness ${target.name} profile 安装失败：${error?.stderr || error?.message || "未知错误"}`);
        }
        changed = true;
        profile = await this.readProfile(target.profileDir);
      }
      const bundlePresent = Array.isArray(profile?.dsh?.profile?.bundles)
        && profile.dsh.profile.bundles.includes(DSH_BRIDGE_PACKAGE);
      if (!bundlePresent) {
        await this.updateProfileBundle(profilePath, true);
        changed = true;
      }
    }
    await promises.mkdir(path.dirname(this.configPath), { recursive: true });
    const running = targets.some((target) => target.pid);
    const nextConfig = buildDshBridgeConfig({
      command,
      existing,
      profiles: targets.map(({ pid, name, homeDir, profileDir }) => ({ pid, name, homeDir, profileDir })),
      changed,
      running
    });
    await promises.writeFile(this.configPath, JSON.stringify(nextConfig, null, 2) + "\n", "utf8");
  }
  async uninstall(options = {}) {
    const config = await this.readConfig();
    const configured = Array.isArray(config?.profiles) ? config.profiles : [];
    const profileDirs = new Set([...configured.map((item) => item.profileDir), this.defaultProfileDir].filter(Boolean));
    for (const profileDir of profileDirs) {
      const profilePath = path.join(profileDir, "package.json");
      if (!fs.existsSync(profilePath)) continue;
      await runProfilePnpm(profileDir, ["remove", DSH_BRIDGE_PACKAGE]).catch(() => {});
      await this.updateProfileBundle(profilePath, false).catch(() => {});
    }
    if (!options.preserveVerification) {
      await promises.unlink(this.configPath).catch(() => {});
    }
  }
  async recordEvent(event) {
    await this.updateConfig((config) => ({
      ...config,
      restartRequired: false,
      lastVerifiedAt: new Date().toISOString(),
      lastVerifiedEvent: event?.type || "unknown"
    })).catch((error) => {
      if (error?.code === "ENOENT" || error instanceof SyntaxError) return;
      throw error;
    });
  }
  async checkHealth() {
    try {
      const config = await this.readConfig();
      const targets = await this.targetProfiles();
      const available = targets.length > 0;
      if (!available) {
        return {
          agentId: this.agentId,
          installed: false,
          available: false,
          connectionState: "disconnected",
          issues: ["未检测到 DeepSeek Harness profile；启动一次 DSH 后 WorkIsland 会自动连接"],
          manifestPath: this.configPath
        };
      }
      // Windows 版 install() 用 shellQuote 生成 `--source "dsh"`，这里不能只认
      // POSIX 的单引号/无引号形式。
      const sourceMatch = typeof config?.command === "string"
        ? config.command.match(/--source\s+(?:"([^"]+)"|'([^']+)'|(\S+))/)
        : null;
      const hasSource = Boolean(sourceMatch) && (sourceMatch[1] || sourceMatch[2] || sourceMatch[3]) === "dsh";
      const missing = [];
      for (const target of targets) {
        const profile = await this.readProfile(target.profileDir);
        if (!profile?.dependencies?.[DSH_BRIDGE_PACKAGE] || !profile.dsh?.profile?.bundles?.includes(DSH_BRIDGE_PACKAGE)) {
          missing.push(target.name);
        }
      }
      const installed = hasSource && missing.length === 0;
      const restartRequired = Boolean(config?.restartRequired);
      const verified = installed && isDshVerificationCurrent({ lastVerifiedAt: config?.lastVerifiedAt, restartRequired });
      const profileNames = targets.map((item) => item.name).join("、");
      const issues = installed
        ? restartRequired
          ? [`已写入 ${profileNames} profile；重启 DeepSeek Harness 后开始推送事件`]
          : verified ? [] : [`已写入 ${profileNames} profile；发送一条消息后自动完成验证`]
        : missing.length
          ? [`DeepSeek Harness ${missing.join("、")} profile 尚未加载 WorkIsland bridge，正在自动接入`]
          : ["WorkIsland 尚未写入 DeepSeek Harness 配置，正在自动接入"];
      return {
        agentId: this.agentId,
        installed,
        available,
        restartRequired,
        connectionState: installed ? (verified ? "verified" : "configured") : "disconnected",
        issues,
        manifestPath: this.configPath
      };
    } catch {
      return {
        agentId: this.agentId,
        installed: false,
        available: false,
        connectionState: "disconnected",
        issues: ["DeepSeek Harness 状态读取失败，WorkIsland 会在后台自动重试"],
        manifestPath: this.configPath
      };
    }
  }
}
module.exports = { PluginHookManager, DeepSeekHarnessHookManager, buildHookCommand, buildSourceHookCommand };
