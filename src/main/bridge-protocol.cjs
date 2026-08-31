"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const SOCKET_NAME = "bridge.sock";
const MAX_FRAME_BYTES = 64 * 1024;

function encodeLine(envelope) {
  return Buffer.from(`${JSON.stringify(envelope)}\n`, "utf8");
}

function decodeLines(buffer, maxFrameBytes = MAX_FRAME_BYTES) {
  const messages = [];
  const errors = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 10) continue;
    const line = buffer.subarray(start, index);
    start = index + 1;
    if (line.length === 0) continue;
    if (line.length > maxFrameBytes) {
      errors.push({ code: "FRAME_TOO_LARGE" });
      continue;
    }
    try {
      messages.push(JSON.parse(line.toString("utf8")));
    } catch {
      errors.push({ code: "MALFORMED_FRAME" });
    }
  }
  let remainder = buffer.subarray(start);
  if (remainder.length > maxFrameBytes) {
    errors.push({ code: "FRAME_TOO_LARGE" });
    remainder = Buffer.alloc(0);
  }
  return { messages, remainder, errors };
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
  const socketDir = getSocketDir(homeDir);
  fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(socketDir, 0o700);
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
  MAX_FRAME_BYTES,
  encodeLine,
  decodeLines,
  getSocketDir,
  getSocketPath,
  ensureSocketDir,
  cleanupSocket
};
