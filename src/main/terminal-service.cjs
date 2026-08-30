"use strict";

const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { normalizeTerminalSize, resolveTerminalCwd } = require("../shared/terminal-state.cjs");

const MAX_TERMINAL_INPUT = 64 * 1024;
const MAX_OUTPUT_CHUNK = 128 * 1024;
const MAX_RETAINED_OUTPUT = 512 * 1024;

function defaultSpawnPty(shell, args, options) {
  return require("node-pty").spawn(shell, args, options);
}

function resolveTerminalShell({ platform = process.platform, requestedShell = "", env = process.env, pathExists = fs.existsSync } = {}) {
  if (platform === "win32") {
    const candidates = [
      requestedShell,
      env.WORKISLAND_TERMINAL_SHELL,
      env.SystemRoot ? path.win32.join(env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "",
      env.ComSpec
    ].filter(Boolean);
    const shell = candidates.find((candidate) => path.win32.isAbsolute(candidate) && pathExists(candidate)) || "powershell.exe";
    return { shell, args: /(?:power)?shell(?:\.exe)?$/i.test(shell) ? ["-NoLogo"] : [] };
  }
  const shell = requestedShell && requestedShell.startsWith("/") && pathExists(requestedShell)
    ? requestedShell
    : env.SHELL && env.SHELL.startsWith("/") && pathExists(env.SHELL)
      ? env.SHELL
      : "/bin/zsh";
  return { shell, args: ["-l"] };
}

class TerminalService extends EventEmitter {
  constructor({ spawnPty = defaultSpawnPty, homeDir = os.homedir(), pathExists = fs.existsSync, env = process.env, platform = process.platform } = {}) {
    super();
    this.spawnPty = spawnPty;
    this.homeDir = homeDir;
    this.pathExists = pathExists;
    this.env = { ...env };
    this.platform = platform;
    this.enabled = true;
    this.panelVisible = false;
    this.pty = null;
    this.status = { running: false, cwd: "", shell: "", exitCode: null };
    this.outputBuffer = "";
  }

  start({ cwd = "", projectCwd = "", customCwd = "", cwdMode = "agent-project", shell = "" } = {}) {
    if (!this.enabled) return this.snapshot();
    if (this.pty) return this.snapshot();
    const resolvedCwd = cwd && this.pathExists(cwd)
      ? cwd
      : resolveTerminalCwd({ projectCwd, customCwd, homeDir: this.homeDir, mode: cwdMode, pathExists: this.pathExists });
    const resolved = resolveTerminalShell({ platform: this.platform, requestedShell: shell, env: this.env, pathExists: this.pathExists });
    const child = this.spawnPty(resolved.shell, resolved.args, {
      name: "xterm-256color",
      cols: 100,
      rows: 28,
      cwd: resolvedCwd,
      env: { ...this.env, TERM: "xterm-256color" }
    });
    this.pty = child;
    this.outputBuffer = "";
    this.status = { running: true, cwd: resolvedCwd, shell: resolved.shell, exitCode: null };
    child.onData?.((data) => {
      const chunk = String(data).slice(0, MAX_OUTPUT_CHUNK);
      this.outputBuffer = `${this.outputBuffer}${chunk}`.slice(-MAX_RETAINED_OUTPUT);
      this.emit("data", chunk);
    });
    child.onExit?.(({ exitCode } = {}) => {
      if (this.pty !== child) return;
      this.pty = null;
      this.status = { ...this.status, running: false, exitCode: Number.isInteger(exitCode) ? exitCode : null };
      this.emit("status", this.snapshot());
    });
    this.emit("status", this.snapshot());
    return this.snapshot();
  }

  input(value) {
    if (!this.pty || typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > MAX_TERMINAL_INPUT) return false;
    this.pty.write(value);
    return true;
  }

  resize(size) {
    const normalized = normalizeTerminalSize(size);
    if (!this.pty || !normalized) return false;
    this.pty.resize(normalized.cols, normalized.rows);
    return true;
  }

  stop() {
    const child = this.pty;
    this.pty = null;
    if (child) child.kill();
    this.status = { ...this.status, running: false };
    this.emit("status", this.snapshot());
  }

  restart(options = {}) {
    this.stop();
    return this.start(options);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.stop();
  }

  setPanelVisible(visible) { this.panelVisible = Boolean(visible); }
  snapshot() { return { ...this.status, enabled: this.enabled, recentOutput: this.outputBuffer }; }
  dispose() { this.stop(); }
}

module.exports = { MAX_TERMINAL_INPUT, resolveTerminalShell, TerminalService };
