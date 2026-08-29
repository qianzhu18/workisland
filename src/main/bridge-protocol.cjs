"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

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

function getSocketPath(env = process.env, homeDir = os.homedir(), platform = process.platform) {
  if (env.FLUX_SOCKET_PATH) return env.FLUX_SOCKET_PATH;
  if (platform === "win32") {
    const userKey = crypto.createHash("sha256").update(path.resolve(homeDir).toLowerCase()).digest("hex").slice(0, 12);
    return `\\\\.\\pipe\\workisland-${userKey}`;
  }
  return path.posix.join(homeDir, ".flux", "run", SOCKET_NAME);
}

function ensureSocketDir(homeDir = os.homedir(), platform = process.platform) {
  if (platform === "win32") return;
  fs.mkdirSync(getSocketDir(homeDir), { recursive: true });
}

function cleanupSocket(socketPath) {
  if (String(socketPath).startsWith("\\\\.\\pipe\\")) return;
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
