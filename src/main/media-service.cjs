"use strict";

const { EventEmitter } = require("node:events");
const childProcess = require("node:child_process");
const path = require("node:path");
const util = require("node:util");
const { EMPTY_MEDIA_STATE, normalizeAdapterPayload, normalizeMediaSnapshot } = require("../shared/media-state.cjs");

const COMMANDS = new Set(["toggle", "play", "pause", "next", "previous", "seek", "openSource"]);
const REMOTE_COMMANDS = Object.freeze({ play: "0", pause: "1", toggle: "2", next: "4", previous: "5" });

function powerShellPath(env = process.env) {
  return path.win32.join(env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

class MediaService extends EventEmitter {
  constructor({
    spawnChild = (executable, args, options) => childProcess.spawn(executable, args, options),
    execute = (executable, args) => childProcess.execFile(executable, args, () => {}),
    query = util.promisify(childProcess.execFile),
    resolveAppIcon = async () => "",
    resourceDir = path.join(__dirname, "../../resources/mediaremote-adapter"),
    windowsScriptPath = path.join(__dirname, "../../resources/scripts/media-session.ps1"),
    platform = process.platform,
    env = process.env,
    pollIntervalMs = 1_000
  } = {}) {
    super();
    this.spawnChild = spawnChild;
    this.execute = execute;
    this.query = query;
    this.resolveAppIcon = resolveAppIcon;
    this.resourceDir = resourceDir;
    const resourcePath = platform === "darwin" ? path.posix : path.win32;
    this.scriptPath = resourcePath.join(resourceDir, "mediaremote-adapter.pl");
    this.frameworkPath = resourcePath.join(resourceDir, "MediaRemoteAdapter.framework");
    this.windowsScriptPath = windowsScriptPath;
    this.platform = platform;
    this.env = { ...env };
    this.pollIntervalMs = pollIntervalMs;
    this.enabled = true;
    this.child = null;
    this.timer = null;
    this.buffer = "";
    this.state = EMPTY_MEDIA_STATE;
  }

  start() {
    if (!this.enabled || this.child || this.timer) return;
    if (this.platform === "win32") {
      void this.#pollWindows();
      this.timer = setInterval(() => void this.#pollWindows(), this.pollIntervalMs);
      this.timer.unref?.();
      return;
    }
    const child = this.spawnChild("/usr/bin/perl", [
      this.scriptPath, this.frameworkPath, "stream", "--no-diff", "--debounce=100"
    ], { stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;
    child.stdout?.on("data", (chunk) => this.#receive(chunk));
    child.on?.("exit", () => {
      if (this.child === child) this.child = null;
    });
    child.on?.("error", () => {
      if (this.child === child) this.child = null;
    });
  }

  stop() {
    const child = this.child;
    this.child = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.buffer = "";
    child?.kill?.("SIGTERM");
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.enabled) {
      this.start();
    } else {
      this.stop();
      this.#setState(EMPTY_MEDIA_STATE);
    }
  }

  getSnapshot() {
    return this.state;
  }

  sendCommand(payload = {}) {
    if (!COMMANDS.has(payload.command)) return false;
    if (this.platform === "win32") {
      if (payload.command === "openSource" && !this.state.appBundleId) return false;
      if (payload.command === "seek" && (!Number.isFinite(Number(payload.positionSec)) || Number(payload.positionSec) < 0)) return false;
      this.execute(powerShellPath(this.env), [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", this.windowsScriptPath, "-Action", payload.command,
        "-PositionSec", String(Math.max(0, Number(payload.positionSec) || 0)),
        "-SourceAppId", this.state.appBundleId || ""
      ], { windowsHide: true });
      return true;
    }
    if (payload.command === "openSource") {
      if (!this.state.appBundleId) return false;
      this.execute("/usr/bin/open", ["-b", this.state.appBundleId]);
      return true;
    }
    if (payload.command === "seek") {
      const positionSec = Number(payload.positionSec);
      if (!Number.isFinite(positionSec) || positionSec < 0) return false;
      this.execute("/usr/bin/perl", [this.scriptPath, this.frameworkPath, "seek", String(Math.round(positionSec * 1_000_000))]);
      return true;
    }
    this.execute("/usr/bin/perl", [this.scriptPath, this.frameworkPath, "send", REMOTE_COMMANDS[payload.command]]);
    return true;
  }

  #receive(chunk) {
    this.buffer += chunk.toString("utf8");
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event?.type === "data" && event?.diff === false) {
          const next = normalizeAdapterPayload(event.payload);
          this.#setState(next);
          this.#enrichAppIcon(next);
        }
      } catch {}
    }
  }

  async #pollWindows() {
    try {
      const { stdout } = await this.query(powerShellPath(this.env), [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", this.windowsScriptPath, "-Action", "snapshot"
      ], { windowsHide: true, timeout: Math.max(750, this.pollIntervalMs - 50), maxBuffer: 10 * 1024 * 1024 });
      const payload = JSON.parse(String(stdout || "{}").trim() || "{}");
      const next = normalizeMediaSnapshot(payload);
      this.#setState(next);
      this.#enrichAppIcon(next);
    } catch {
      this.#setState(EMPTY_MEDIA_STATE);
    }
  }

  #enrichAppIcon(snapshot) {
    const bundleId = snapshot.appBundleId;
    if (!bundleId) return;
    Promise.resolve(this.resolveAppIcon(bundleId)).then((appIconDataUrl) => {
      if (!appIconDataUrl || this.state.appBundleId !== bundleId) return;
      this.#setState(normalizeMediaSnapshot({ ...this.state, appIconDataUrl }));
    }).catch(() => {});
  }

  #setState(next) {
    if (next === this.state) return;
    this.state = next;
    this.emit("update", next);
  }
}

module.exports = { COMMANDS, MediaService, powerShellPath };
