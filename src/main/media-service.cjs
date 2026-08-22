"use strict";

const { EventEmitter } = require("node:events");
const childProcess = require("node:child_process");
const path = require("node:path");
const { EMPTY_MEDIA_STATE, reduceMediaEvent } = require("../shared/media-state.cjs");

const COMMANDS = new Set(["toggle", "play", "pause", "next", "previous", "seek", "openSource"]);

class MediaService extends EventEmitter {
  constructor({
    spawnChild = (helperPath) => childProcess.spawn(helperPath, [], { stdio: ["pipe", "pipe", "ignore"] }),
    helperPath = path.join(__dirname, "../../resources/bin/media-bridge")
  } = {}) {
    super();
    this.spawnChild = spawnChild;
    this.helperPath = helperPath;
    this.enabled = true;
    this.child = null;
    this.buffer = "";
    this.state = EMPTY_MEDIA_STATE;
  }

  start() {
    if (!this.enabled || this.child) return;
    const child = this.spawnChild(this.helperPath);
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
    if (!this.child?.stdin || !COMMANDS.has(payload.command)) return false;
    const command = { command: payload.command };
    if (payload.command === "seek") {
      const positionSec = Number(payload.positionSec);
      if (!Number.isFinite(positionSec) || positionSec < 0) return false;
      command.positionSec = positionSec;
    }
    this.child.stdin.write(`${JSON.stringify(command)}\n`);
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
        this.#setState(reduceMediaEvent(this.state, event));
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
