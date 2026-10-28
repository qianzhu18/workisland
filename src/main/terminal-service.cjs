"use strict";

const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { normalizeTerminalSize, resolveTerminalCwd } = require("../shared/terminal-state.cjs");

const MAX_TERMINAL_INPUT = 64 * 1024;
const MAX_OUTPUT_CHUNK = 128 * 1024;
const MAX_RETAINED_OUTPUT = 512 * 1024;
const MAX_TERMINALS = 24;

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
  constructor({ spawnPty = defaultSpawnPty, homeDir = os.homedir(), pathExists = fs.existsSync, env = process.env, platform = process.platform, maxSessions = MAX_TERMINALS } = {}) {
    super();
    this.spawnPty = spawnPty;
    this.homeDir = homeDir;
    this.pathExists = pathExists;
    this.env = { ...env };
    this.platform = platform;
    this.enabled = true;
    this.panelVisible = false;
    this.sessions = new Map();
    this.activeId = null;
    this.ordinal = 0;
    this.revision = 0;
    this.maxSessions = maxSessions;
  }

  start(options = {}) {
    return this.activeId ? this.snapshot() : this.create(options);
  }

  create(options = {}) {
    if (!this.enabled) return false;
    if (this.sessions.size >= this.maxSessions) throw Object.assign(new Error("Terminal limit reached"), { code: "TERMINAL_LIMIT" });
    const entry = { id: randomUUID(), ordinal: ++this.ordinal, name: this.cleanName(options.name), createdAt: Date.now(), pty: null,
      outputBuffer: "", sequence: 0, generation: 0, status: { running: false, cwd: "", shell: "", exitCode: null } };
    this.sessions.set(entry.id, entry);
    try { this.spawnEntry(entry, options); }
    catch (error) { this.sessions.delete(entry.id); throw error; }
    this.activeId = entry.id;
    this.publish();
    return this.snapshot();
  }

  spawnEntry(entry, { cwd = "", projectCwd = "", customCwd = "", cwdMode = "agent-project", shell = "" } = {}) {
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
    entry.pty = child;
    entry.outputBuffer = "";
    entry.sequence = 0;
    entry.generation++;
    entry.status = { running: true, cwd: resolvedCwd, shell: resolved.shell, exitCode: null };
    child.onData?.((data) => {
      if (this.sessions.get(entry.id) !== entry || entry.pty !== child) return;
      const text = String(data);
      // Transport all output, including large AI responses; only retained history
      // is truncated. Avoid splitting a UTF-16 surrogate pair between frames.
      for (let offset = 0; offset < text.length;) {
        let end = Math.min(text.length, offset + MAX_OUTPUT_CHUNK);
        if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
        const chunk = text.slice(offset, end);
        entry.outputBuffer = `${entry.outputBuffer}${chunk}`.slice(-MAX_RETAINED_OUTPUT);
        this.emit("data", { id: entry.id, generation: entry.generation, data: chunk, sequence: ++entry.sequence });
        offset = end;
      }
    });
    child.onExit?.(({ exitCode } = {}) => {
      if (this.sessions.get(entry.id) !== entry || entry.pty !== child) return;
      entry.pty = null;
      entry.status = { ...entry.status, running: false, exitCode: Number.isInteger(exitCode) ? exitCode : null };
      this.publish();
    });
  }

  input(value, id = this.activeId) {
    const child = this.sessions.get(id)?.pty;
    if (!child || typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > MAX_TERMINAL_INPUT) return false;
    child.write(value);
    return true;
  }

  resize(size, id = this.activeId) {
    const child = this.sessions.get(id)?.pty;
    const normalized = normalizeTerminalSize(size);
    if (!child || !normalized) return false;
    child.resize(normalized.cols, normalized.rows);
    return true;
  }

  stop(id = this.activeId) {
    const entry = this.sessions.get(id);
    if (!entry) return false;
    entry.pty?.kill();
    entry.pty = null;
    entry.status = { ...entry.status, running: false };
    this.publish();
    return this.snapshot();
  }

  restart(options = {}, id = this.activeId) {
    if (!id) return this.create(options);
    const entry = this.sessions.get(id);
    if (!entry || !this.enabled) return false;
    this.stop(id);
    this.spawnEntry(entry, { cwd: entry.status.cwd, ...options });
    this.activeId = id;
    this.publish();
    return this.snapshot();
  }

  select(id) {
    if (!this.sessions.has(id)) return false;
    this.activeId = id;
    this.publish();
    return this.snapshot();
  }

  close(id) {
    if (!this.sessions.has(id)) return false;
    this.stop(id);
    this.sessions.delete(id);
    if (this.activeId === id) this.activeId = [...this.sessions.keys()].at(-1) ?? null;
    this.publish();
    return this.snapshot();
  }

  cleanName(value) { return typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 80) : ""; }
  rename(id, name) {
    const entry = this.sessions.get(id);
    const normalized = this.cleanName(name);
    if (!entry || !normalized) return false;
    entry.name = normalized;
    this.publish();
    return this.snapshot();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) for (const id of this.sessions.keys()) this.stop(id);
  }

  setPanelVisible(visible) { this.panelVisible = Boolean(visible); }
  summary(entry) { return { id: entry.id, ordinal: entry.ordinal, name: entry.name, createdAt: entry.createdAt, generation: entry.generation, pid: entry.pty?.pid ?? null, ...entry.status }; }
  snapshot(id = this.activeId, includeOutput = true) {
    const entry = this.sessions.get(id);
    if (id && !entry) return null;
    return { ...(entry ? this.summary(entry) : { id: null, running: false, cwd: "", shell: "", exitCode: null }),
      activeId: this.activeId, revision: this.revision, enabled: this.enabled, maxSessions: this.maxSessions,
      sessions: [...this.sessions.values()].map(s => this.summary(s)), sequence: entry?.sequence ?? 0,
      ...(includeOutput ? { recentOutput: entry?.outputBuffer ?? "" } : {}) };
  }
  publish() { this.revision++; this.emit("status", this.snapshot(undefined, false)); }
  dispose() { for (const id of [...this.sessions.keys()]) this.close(id); }
}

module.exports = { MAX_TERMINAL_INPUT, resolveTerminalShell, TerminalService };
