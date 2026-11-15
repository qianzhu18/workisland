"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const promises = require("node:fs/promises");
const electron = require("electron");
const log = require("electron-log");
const utils = require("@electron-toolkit/utils");
const { shellQuote, buildDevHooksCliCommand, wrapWithInstallCheck } = require("./hook-shared.cjs");
const {
  installAlmaHooks,
  uninstallAlmaHooks,
  checkAlmaHooks,
  isAlmaAvailable
} = require("./alma-hooks.cjs");

function getHookBinaryPath() {
  const resourcesPath = process.resourcesPath ?? path.join(electron.app.getAppPath(), "resources");
  return path.resolve(resourcesPath, "bin", "flux-hooks");
}

function getManifestPath() {
  return path.join(os.homedir(), ".flux", "hooks", "alma-manifest.json");
}

function buildCommand() {
  if (utils.is.dev) return buildDevHooksCliCommand("alma");
  const bin = getHookBinaryPath();
  return wrapWithInstallCheck(
    process.execPath,
    `ELECTRON_RUN_AS_NODE=1 ${shellQuote(process.execPath)} ${shellQuote(bin)} --source alma`
  );
}

async function readManifest() {
  try {
    return JSON.parse(await promises.readFile(getManifestPath(), "utf8"));
  } catch {
    return null;
  }
}

async function writeManifest(manifest) {
  const manifestPath = getManifestPath();
  await promises.mkdir(path.dirname(manifestPath), { recursive: true });
  await promises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

class AlmaHookManager {
  agentId = "alma";

  async install() {
    const command = buildCommand();
    const homeDir = os.homedir();
    log.info("[AlmaHookManager] writing settings to %s", path.join(homeDir, ".config", "alma", "hooks.json"));
    const result = await installAlmaHooks({ homeDir, hookCommand: command });
    const previous = await readManifest();
    const manifest = {
      owned: true,
      configPath: result.configPath,
      events: result.installedEvents,
      installedAt: previous?.installedAt || new Date().toISOString(),
      lastVerifiedAt: previous?.lastVerifiedAt,
      lastEventType: previous?.lastEventType
    };
    await writeManifest(manifest);
    log.info("[AlmaHookManager] install completed (%d events)", result.installedEvents.length);
  }

  async uninstall({ preserveVerification = false } = {}) {
    await uninstallAlmaHooks(os.homedir());
    if (preserveVerification) return;
    try {
      await promises.unlink(getManifestPath());
    } catch {
    }
  }

  async isAvailable() {
    return isAlmaAvailable(os.homedir());
  }

  async checkHealth() {
    const issues = [];
    const manifestPath = getManifestPath();
    const available = isAlmaAvailable(os.homedir());
    if (!available) {
      issues.push("Alma 未安装");
      return {
        agentId: "alma",
        installed: false,
        available: false,
        issues,
        manifestPath,
        connectionState: "disconnected"
      };
    }
    const binaryPath = getHookBinaryPath();
    if (!utils.is.dev && !fs.existsSync(binaryPath)) {
      issues.push(`Hook binary not found: ${binaryPath}`);
    }
    const health = await checkAlmaHooks({ homeDir: os.homedir(), hookCommand: buildCommand() });
    issues.push(...health.issues);
    const manifest = await readManifest();
    const installed = issues.length === 0;
    return {
      agentId: "alma",
      installed,
      available: true,
      issues,
      manifestPath,
      connectionState: installed ? (manifest?.lastVerifiedAt ? "verified" : "configured") : "disconnected",
      lastVerifiedAt: manifest?.lastVerifiedAt,
      lastEventType: manifest?.lastEventType
    };
  }

  async recordEvent(event) {
    const manifest = await readManifest();
    if (!manifest?.owned || manifest.lastVerifiedAt) return;
    await writeManifest({
      ...manifest,
      lastVerifiedAt: new Date().toISOString(),
      lastEventType: event?.type
    });
  }
}

module.exports = { AlmaHookManager, buildCommand };
