"use strict";

const path = require("node:path");

// DSH 自动接入：把「用户不点也能连上」所需的判定收敛成纯函数，便于单测。
// 真正的 IO（pnpm、profile 写入）仍在 hooks-custom.cjs 里。

const DSH_BRIDGE_PACKAGE = "@workisland/dsh-bridge";
// 自动巡检的安装重试间隔：失败后不要每轮都重跑 pnpm。
const DSH_AUTO_INSTALL_RETRY_MS = 10 * 60 * 1000;

function normalizeDependencySpec(spec, profileDir) {
  if (typeof spec !== "string" || !spec.trim()) return "";
  const value = spec.trim().replace(/^(?:file|link):/, "");
  // 一律走 path.resolve：POSIX 风格绝对路径在 Windows runner 上也要归一化，
  // 否则同一个路径会被比较成两个值。
  return path.normalize(path.resolve(profileDir || process.cwd(), value)).replace(/[\\/]+$/, "");
}

// 只有「缺依赖 / 依赖指向旧的 App 路径 / node_modules 缺失 / 安装版本
// 落后于随包版本」才需要跑 pnpm。hook 命令路径变化不需要重装：插件每次
// 触发时都从配置文件读取当前命令。依赖路径必须保持新鲜，否则用户下次在
// profile 里跑 pnpm install 时会因为 file: 指向已不存在的 App 而失败。
function needsBridgeReinstall({
  dependencySpec,
  desiredSpec,
  profileDir,
  nodeModulesPresent,
  installedVersion,
  desiredVersion
} = {}) {
  if (typeof dependencySpec !== "string" || !dependencySpec.trim()) return true;
  if (desiredSpec && normalizeDependencySpec(dependencySpec, profileDir) !== normalizeDependencySpec(desiredSpec, profileDir)) return true;
  if (!nodeModulesPresent) return true;
  if (desiredVersion && installedVersion !== desiredVersion) return true;
  return false;
}

function shouldUninstallBeforeAutoReinstall(agentId) {
  // DSH 的 uninstall 会 pnpm remove + 改 profile；先拆后装一旦安装失败，
  // 就会留下「配置在、插件没了」的半坏状态（真实事故）。install 本身幂等
  // 且会重写 command，所以自动巡检只做增量安装。
  return agentId !== "dsh";
}

// 老版本把 dsh 默认写成 false 并持久化（当时要求用户点「连接」）。只迁移
// 从未接入过的用户：配置文件不存在 = 没连过；迁移标记保证只执行一次，
// 之后用户在设置里手动关掉会被尊重。
function shouldAutoEnableDsh({ toggle, configExists, migrated } = {}) {
  if (migrated) return false;
  if (toggle !== false) return false;
  return !configExists;
}

// 后台巡检：检测到 DSH profile 且 bridge 确实缺失时才安装。已安装（等待
// 首个事件 / 等待重启）不再重跑，避免每个周期都写 profile。
function shouldAttemptDshAutoInstall({
  enabled,
  targetCount,
  installed,
  lastAttemptAt = 0,
  now = Date.now(),
  retryMs = DSH_AUTO_INSTALL_RETRY_MS
} = {}) {
  if (!enabled) return false;
  if (!(targetCount > 0)) return false;
  if (installed) return false;
  if (lastAttemptAt && now - lastAttemptAt < retryMs) return false;
  return true;
}

// 生成写入 ~/.flux/dsh-workisland-bridge.json 的内容：保留 installedAt 与
// 上一次真实验证的痕迹，但只在 profile 集合没变时保留验证；重启标记只在
// 「确实改了 profile」且「DSH 正在运行」时置位，稳态启动不会反复提醒。
function buildDshBridgeConfig({ command, existing, profiles, changed, running, now = new Date().toISOString() } = {}) {
  const profileDirs = (profiles || []).map((item) => item.profileDir).filter(Boolean).sort();
  const existingDirs = Array.isArray(existing?.profiles)
    ? existing.profiles.map((item) => item.profileDir).filter(Boolean).sort()
    : [];
  const preservesVerification = JSON.stringify(profileDirs) === JSON.stringify(existingDirs);
  return {
    command,
    installedAt: existing?.installedAt || now,
    restartRequired: (Boolean(changed) || Boolean(existing?.restartRequired)) && Boolean(running),
    profiles: profiles || [],
    ...(preservesVerification && existing?.lastVerifiedAt ? {
      lastVerifiedAt: existing.lastVerifiedAt,
      lastVerifiedEvent: existing.lastVerifiedEvent
    } : {})
  };
}

// 「已连接」必须同时满足「写入的配置还在」且「没有待重启的改动」。
// 只看 lastVerifiedAt 会把「插件早被清掉」误报成已连接。
function isDshVerificationCurrent({ lastVerifiedAt, restartRequired } = {}) {
  return Boolean(lastVerifiedAt) && restartRequired !== true;
}

module.exports = {
  DSH_BRIDGE_PACKAGE,
  DSH_AUTO_INSTALL_RETRY_MS,
  normalizeDependencySpec,
  needsBridgeReinstall,
  shouldUninstallBeforeAutoReinstall,
  shouldAutoEnableDsh,
  shouldAttemptDshAutoInstall,
  isDshVerificationCurrent,
  buildDshBridgeConfig
};