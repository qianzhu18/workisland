"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const toml = require("@iarna/toml");

function configError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function defaultDetectClient(fsModule = fs, homeDir = os.homedir()) {
  const candidates = process.platform === "win32"
    ? [path.join(homeDir, "AppData", "Local", "Programs", "Codex", "Codex.exe")]
    : ["/Applications/Codex.app", "/Applications/ChatGPT.app", path.join(homeDir, ".local", "bin", "codex")];
  return {
    installed: candidates.some((candidate) => fsModule.existsSync(candidate)),
    label: "Codex"
  };
}

class CodexMcpConfigManager {
  constructor(options = {}) {
    this.fs = options.fsModule || fs;
    this.homeDir = options.homeDir || os.homedir();
    this.configPath = options.configPath || path.join(this.homeDir, ".codex", "config.toml");
    this.command = options.command;
    this.serverPath = options.serverPath;
    this.now = options.now || Date.now;
    this.detectClient = options.detectClient || (() => defaultDetectClient(this.fs, this.homeDir));
    if (typeof this.command !== "string" || !this.command || typeof this.serverPath !== "string" || !this.serverPath) {
      throw new TypeError("CodexMcpConfigManager requires command and serverPath");
    }
  }

  get entry() {
    return {
      command: this.command,
      args: [this.serverPath],
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        WORKISLAND_MCP_CLIENT: "Codex"
      }
    };
  }

  #read() {
    let text = "";
    try {
      text = this.fs.readFileSync(this.configPath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    try {
      return { text, parsed: text.trim() ? toml.parse(text) : {} };
    } catch (error) {
      throw configError("CLIENT_CONFIG_INVALID", "Codex config.toml could not be parsed; WorkIsland left it unchanged.", {
        configPath: this.configPath
      });
    }
  }

  #backup(text) {
    if (!text) return null;
    const stamp = String(this.now());
    const backupPath = `${this.configPath}.workisland-backup-${stamp}`;
    this.fs.writeFileSync(backupPath, text, { encoding: "utf8", mode: 0o600 });
    return backupPath;
  }

  #write(parsed) {
    const directory = path.dirname(this.configPath);
    this.fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const output = toml.stringify(parsed);
    // Parse the generated document before replacing the user's live config.
    toml.parse(output);
    const temporary = `${this.configPath}.workisland-tmp-${process.pid}`;
    this.fs.writeFileSync(temporary, output, { encoding: "utf8", mode: 0o600 });
    this.fs.renameSync(temporary, this.configPath);
  }

  connect() {
    const { text, parsed } = this.#read();
    const backupPath = this.#backup(text);
    parsed.features = parsed.features && typeof parsed.features === "object"
      ? parsed.features
      : {};
    // Current Codex builds gate user-configured local MCP tools behind this
    // compatibility flag. Without it, `codex mcp list` shows the server while
    // fresh agent sessions receive no tools.
    parsed.features.mcp_2026_07_28 = true;
    parsed.mcp_servers = parsed.mcp_servers && typeof parsed.mcp_servers === "object"
      ? parsed.mcp_servers
      : {};
    parsed.mcp_servers.workisland = this.entry;
    this.#write(parsed);
    return { configured: true, configPath: this.configPath, backupPath, entry: this.entry };
  }

  disconnect() {
    const { text, parsed } = this.#read();
    const configured = Boolean(parsed.mcp_servers?.workisland);
    const backupPath = configured ? this.#backup(text) : null;
    if (configured) {
      delete parsed.mcp_servers.workisland;
      if (Object.keys(parsed.mcp_servers).length === 0) delete parsed.mcp_servers;
      this.#write(parsed);
    }
    return { configured: false, configPath: this.configPath, backupPath };
  }

  status(activity = []) {
    const detected = this.detectClient();
    let configured = false;
    let error = null;
    try {
      configured = Boolean(this.#read().parsed.mcp_servers?.workisland);
    } catch (caught) {
      error = { code: caught.code || "CLIENT_CONFIG_INVALID", message: caught.message };
    }
    const connectedActivity = configured
      ? activity.filter((entry) => typeof entry?.client === "string" && /^codex\b/i.test(entry.client) && entry.result === "success").at(-1)
      : null;
    return {
      id: "codex",
      label: detected?.label || "Codex",
      installed: detected?.installed === true,
      configured,
      connectionState: connectedActivity ? "connected" : configured ? "configured" : "disconnected",
      lastConnectedAt: connectedActivity?.timestamp || null,
      configPath: this.configPath,
      error
    };
  }

  manualConfiguration() {
    const document = {
      features: { mcp_2026_07_28: true },
      mcp_servers: { workisland: this.entry }
    };
    return {
      client: "Codex",
      configPath: this.configPath,
      entry: this.entry,
      toml: toml.stringify(document)
    };
  }
}

module.exports = { CodexMcpConfigManager, configError, defaultDetectClient };
