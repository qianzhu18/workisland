#!/usr/bin/env node
"use strict";

const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    process.stdin.on("data", (chunk) => {
      size += chunk.length;
      if (size > 10 * 1024 * 1024) {
        reject(new Error("hook payload exceeds 10 MB"));
        process.stdin.destroy();
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function enrichPayload(payload, eventName) {
  const next = payload && typeof payload === "object" && !Array.isArray(payload) ? { ...payload } : {};
  if (eventName && !next.hook_event_name && !next.event_type) next.hook_event_name = eventName;
  next._hostname ??= os.hostname();
  next._username ??= os.userInfo().username;
  next._ipAddrs ??= [];
  // 注入 agent 进程 pid（hooks-cli 的父进程），让 AppCoordinator 的 PidWatcher
  // 能在 agent 退出时作为兜底完成信号。修复原本 pid 永远 undefined 的问题。
  if (next.pid == null && typeof process.ppid === "number") {
    next.pid = process.ppid;
  }
  if (process.env.SSH_CONNECTION) next._sshClient ??= process.env.SSH_CONNECTION;
  return next;
}

function sendHook(socketPath, source, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = "";
    let commandSent = false;
    const finish = (value) => {
      socket.end();
      resolve(value);
    };
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.type === "hello" && !commandSent) {
          commandSent = true;
          socket.write(`${JSON.stringify({
            type: "command",
            command: { type: "processHook", source, payload }
          })}\n`);
          continue;
        }
        if (message.type === "response") finish(message.response);
      }
    });
    socket.on("error", reject);
    socket.on("close", () => {
      if (!commandSent) reject(new Error("bridge closed before handshake"));
    });
  });
}

async function main() {
  const source = readArg("--source");
  if (!source) throw new Error("missing --source");
  const eventName = readArg("--event");
  const raw = await readStdin();
  const payload = enrichPayload(raw.trim() ? JSON.parse(raw) : {}, eventName);
  const socketPath = process.env.FLUX_SOCKET_PATH || path.join(os.homedir(), ".flux", "run", "bridge.sock");
  const response = await sendHook(socketPath, source, payload);
  if (response?.type === "hookDirective" && response.directive) {
    process.stdout.write(`${JSON.stringify(response.directive)}\n`);
  }
}

main().catch((error) => {
  if (process.env.FLUX_HOOKS_DEBUG === "1") {
    process.stderr.write(`[flux-hooks] ${error.message}\n`);
  }
  // Hook transport failures must not block the agent's own workflow.
  process.exitCode = 0;
});
