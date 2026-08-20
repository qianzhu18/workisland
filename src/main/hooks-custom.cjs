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
  async uninstall() {
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
  profileDir = path.join(os.homedir(), ".dsh", "profiles", "web");
  profilePath = path.join(this.profileDir, "package.json");
  async updateProfileBundle(enabled) {
    const profile = JSON.parse(await promises.readFile(this.profilePath, "utf8"));
    const bundles = Array.isArray(profile.dsh?.profile?.bundles) ? profile.dsh.profile.bundles : [];
    const nextBundles = enabled
      ? [...new Set([...bundles, "@workisland/dsh-bridge"])]
      : bundles.filter((bundle) => bundle !== "@workisland/dsh-bridge");
    profile.dsh = { ...profile.dsh, profile: { ...profile.dsh?.profile, bundles: nextBundles } };
    await promises.writeFile(this.profilePath, JSON.stringify(profile, null, 2) + "\n", "utf8");
  }
  async install() {
    const command = buildSourceHookCommand("dsh");
    const bundlePath = utils.is.dev
      ? path.join(electron.app.getAppPath(), "resources", "dsh-workisland-bridge")
      : path.join(process.resourcesPath, "dsh-workisland-bridge");
    if (!fs.existsSync(this.profilePath)) throw new Error("未找到 DSH web profile。请先运行一次 DeepSeek Harness，再返回点击连接");
    try {
      await runProfilePnpm(this.profileDir, ["add", `file:${bundlePath}`]);
      await this.updateProfileBundle(true);
    } catch (error) { throw new Error(`DeepSeek Harness bridge 安装失败：${error?.stderr || error?.message || "未知错误"}`); }
    await promises.mkdir(path.dirname(this.configPath), { recursive: true });
    await promises.writeFile(this.configPath, JSON.stringify({ command, installedAt: new Date().toISOString() }, null, 2) + "\n", "utf8");
  }
  async uninstall() {
    if (fs.existsSync(this.profilePath)) {
      await runProfilePnpm(this.profileDir, ["remove", "@workisland/dsh-bridge"]).catch(() => {});
      await this.updateProfileBundle(false).catch(() => {});
    }
    await promises.unlink(this.configPath).catch(() => {});
  }
  async checkHealth() {
    try {
      const config = JSON.parse(await promises.readFile(this.configPath, "utf8"));
      const profile = JSON.parse(await promises.readFile(this.profilePath, "utf8"));
      const hasSource = typeof config.command === "string" && (config.command.includes("--source dsh") || config.command.includes("--source 'dsh'"));
      const installed = hasSource && Boolean(profile.dependencies?.["@workisland/dsh-bridge"]) && profile.dsh?.profile?.bundles?.includes("@workisland/dsh-bridge");
      return { agentId: this.agentId, installed, issues: installed ? [] : ["DSH web profile 尚未加载 WorkIsland bridge"], manifestPath: this.configPath };
    } catch {
      return { agentId: this.agentId, installed: false, issues: ["请先在 DeepSeek Harness 的 web profile 中安装 WorkIsland bridge bundle"], manifestPath: this.configPath };
    }
  }
}
module.exports = { PluginHookManager, DeepSeekHarnessHookManager, buildHookCommand, buildSourceHookCommand };
