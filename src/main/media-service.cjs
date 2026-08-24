"use strict";

const { EventEmitter } = require("node:events");
const childProcess = require("node:child_process");
const path = require("node:path");
const { EMPTY_MEDIA_STATE, normalizeAdapterPayload } = require("../shared/media-state.cjs");

const COMMANDS = new Set(["toggle", "play", "pause", "next", "previous", "seek", "openSource"]);
const REMOTE_COMMANDS = Object.freeze({ play: "0", pause: "1", toggle: "2", next: "4", previous: "5" });

class MediaService extends EventEmitter {
  constructor({
    spawnChild = (executable, args, options) => childProcess.spawn(executable, args, options),
    execute = (executable, args) => childProcess.execFile(executable, args, () => {}),
    resourceDir = path.join(__dirname, "../../resources/mediaremote-adapter")
  } = {}) {
    super();
    this.spawnChild = spawnChild;
    this.execute = execute;
    this.resourceDir = resourceDir;
    this.scriptPath = path.join(resourceDir, "mediaremote-adapter.pl");
    this.frameworkPath = path.join(resourceDir, "MediaRemoteAdapter.framework");
    this.enabled = true;
    this.child = null;
    this.buffer = "";
    this.state = EMPTY_MEDIA_STATE;
  }

  start() {
    if (!this.enabled || this.child) return;
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
          this.#setState(normalizeAdapterPayload(event.payload));
        }
      } catch {}
    }
  }

  #setState(next) {
    if (next === this.state) return;
    this.state = next;
    this.emit("update", next);
  }
}

module.exports = { COMMANDS, MediaService };
