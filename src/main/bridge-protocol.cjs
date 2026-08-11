"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SOCKET_NAME = "bridge.sock";

function encodeLine(envelope) {
  return Buffer.from(`${JSON.stringify(envelope)}\n`, "utf8");
}

function decodeLines(buffer) {
  const messages = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 10) continue;
    const line = buffer.subarray(start, index);
    start = index + 1;
    if (line.length === 0) continue;
    try {
      messages.push(JSON.parse(line.toString("utf8")));
    } catch {
      // A malformed frame is ignored; the next newline starts a fresh frame.
    }
  }
  return { messages, remainder: buffer.subarray(start) };
}

function getSocketDir(homeDir = os.homedir()) {
  return path.join(homeDir, ".flux", "run");
}

function getSocketPath(env = process.env, homeDir = os.homedir()) {
  return env.FLUX_SOCKET_PATH || path.join(getSocketDir(homeDir), SOCKET_NAME);
}

function ensureSocketDir(homeDir = os.homedir()) {
  fs.mkdirSync(getSocketDir(homeDir), { recursive: true });
}

function cleanupSocket(socketPath) {
  try {
    if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
  } catch {
    // Socket cleanup is best-effort; BridgeServer handles EADDRINUSE as well.
  }
}

module.exports = {
  SOCKET_NAME,
  encodeLine,
  decodeLines,
  getSocketDir,
  getSocketPath,
  ensureSocketDir,
  cleanupSocket
};
