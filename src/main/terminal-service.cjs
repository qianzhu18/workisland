"use strict";

const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const { normalizeTerminalSize, resolveTerminalCwd } = require("../shared/terminal-state.cjs");

const MAX_TERMINAL_INPUT = 64 * 1024;
const MAX_OUTPUT_CHUNK = 128 * 1024;

function defaultSpawnPty(shell, args, options) {
  return require("node-pty").spawn(shell, args, options);
}

class TerminalService extends EventEmitter {
  constructor({ spawnPty = defaultSpawnPty, homeDir = os.homedir(), pathExists = fs.existsSync, env = process.env } = {}) {
    super();
    this.spawnPty = spawnPty;
    this.homeDir = homeDir;
    this.pathExists = pathExists;
    this.env = { ...env };
    this.enabled = true;
    this.panelVisible = false;
    this.pty = null;
    this.status = { running: false, cwd: "", shell: "", exitCode: null };
  }

  start({ cwd = "", projectCwd = "", customCwd = "", cwdMode = "agent-project", shell = "" } = {}) {
    if (!this.enabled) return this.snapshot();
    if (this.pty) return this.snapshot();
    const resolvedCwd = cwd && this.pathExists(cwd)
      ? cwd
      : resolveTerminalCwd({ projectCwd, customCwd, homeDir: this.homeDir, mode: cwdMode, pathExists: this.pathExists });
    const resolvedShell = shell && shell.startsWith("/") && this.pathExists(shell)
      ? shell
      : this.env.SHELL && this.env.SHELL.startsWith("/") && this.pathExists(this.env.SHELL)
        ? this.env.SHELL
        : "/bin/zsh";
    const child = this.spawnPty(resolvedShell, ["-l"], {
      name: "xterm-256color",
      cols: 100,
      rows: 28,
      cwd: resolvedCwd,
      env: { ...this.env, TERM: "xterm-256color" }
    });
    this.pty = child;
    this.status = { running: true, cwd: resolvedCwd, shell: resolvedShell, exitCode: null };
    child.onData?.((data) => this.emit("data", String(data).slice(0, MAX_OUTPUT_CHUNK)));
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
  snapshot() { return { ...this.status, enabled: this.enabled }; }
  dispose() { this.stop(); }
}

module.exports = { MAX_TERMINAL_INPUT, TerminalService };
