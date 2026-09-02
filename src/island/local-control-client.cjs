"use strict";

const crypto = require("node:crypto");
const net = require("node:net");
const { decodeLines, encodeLine, getSocketPath, MAX_FRAME_BYTES } = require("../main/bridge-protocol.cjs");

function clientError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function requestLocalControl(command, params = {}, options = {}) {
  const socketPath = options.socketPath || getSocketPath();
  const requestId = options.randomId?.() || crypto.randomUUID();
  const connectTimeoutMs = Math.max(10, Math.min(10_000, options.connectTimeoutMs || 1_500));
  const responseTimeoutMs = Math.max(10, Math.min(30_000, options.responseTimeoutMs || 5_000));
  const frame = encodeLine({
    type: "control",
    id: requestId,
    command,
    params,
    client: options.client || { name: "WorkIsland local client" }
  });
  if (frame.length > MAX_FRAME_BYTES) {
    return Promise.reject(clientError("FRAME_TOO_LARGE", "The local control request is too large."));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let connected = false;
    let buffer = Buffer.alloc(0);
    const socket = net.createConnection({ path: socketPath });
    const connectTimer = setTimeout(() => {
      finish(reject, clientError("WORKISLAND_UNAVAILABLE", "WorkIsland is not accepting local control connections."));
    }, connectTimeoutMs);
    let responseTimer = null;

    function finish(callback, value) {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      if (responseTimer) clearTimeout(responseTimer);
      socket.destroy();
      callback(value);
    }

    socket.on("connect", () => {
      connected = true;
      clearTimeout(connectTimer);
      socket.write(frame);
      responseTimer = setTimeout(() => {
        finish(reject, clientError("WORKISLAND_TIMEOUT", "WorkIsland did not answer the local control request in time."));
      }, responseTimeoutMs);
    });
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const decoded = decodeLines(buffer);
      buffer = decoded.remainder;
      if (decoded.errors.some((error) => error.code === "FRAME_TOO_LARGE")) {
        finish(reject, clientError("INVALID_RESPONSE", "WorkIsland returned an oversized response."));
        return;
      }
      for (const response of decoded.messages) {
        if (response?.id !== requestId) continue;
        if (response.ok === true) {
          finish(resolve, response.result);
          return;
        }
        const remote = response?.error || {};
        finish(reject, clientError(
          typeof remote.code === "string" ? remote.code : "INVALID_RESPONSE",
          typeof remote.message === "string" ? remote.message : "WorkIsland rejected the local control request.",
          remote.details
        ));
        return;
      }
    });
    socket.on("error", () => {
      const code = connected ? "WORKISLAND_CONNECTION_LOST" : "WORKISLAND_UNAVAILABLE";
      finish(reject, clientError(code, connected
        ? "The WorkIsland local control connection closed unexpectedly."
        : "Start WorkIsland and try again."));
    });
    socket.on("end", () => {
      if (!settled) finish(reject, clientError("WORKISLAND_CONNECTION_LOST", "WorkIsland closed the local control connection."));
    });
  });
}

module.exports = { clientError, requestLocalControl };
