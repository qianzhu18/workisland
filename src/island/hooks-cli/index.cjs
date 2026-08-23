#!/usr/bin/env node
"use strict";

const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const TERMINAL_APP_ALIASES = Object.freeze({
  apple_terminal: "Terminal",
  "iterm.app": "iTerm",
  iterm: "iTerm",
  warp: "Warp",
  warpterminal: "Warp",
  vscode: "VS Code",
  "vs code": "VS Code",
  ghostty: "Ghostty",
  wezterm: "WezTerm",
  alacritty: "Alacritty",
  kitty: "kitty",
  cmux: "cmux"
});

function canonicalTerminalApp(value) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.trim().toLowerCase();
  return TERMINAL_APP_ALIASES[normalized] || value.trim();
}

// 顺序有意义：更具体的放前面，先匹配到的先返回。
const HOST_APP_MATCHERS = Object.freeze([
  ["/codebuddy cn.app/", "CodeBuddy CN"],
  ["/workbuddy.app/", "WorkBuddy"],
  ["/trae solo.app/", "TraeWork"],
  ["/trae cn.app/", "Trae CN"],
  ["/trae.app/", "Trae"],
  ["/claude.app/", "Claude"],
  ["/cursor.app/", "Cursor"],
  ["/windsurf.app/", "Windsurf"],
  ["/visual studio code.app/", "VS Code"],
  ["/ghostty.app/", "Ghostty"],
  ["/iterm.app/", "iTerm"],
  ["/terminal.app/", "Terminal"],
  ["/warp.app/", "Warp"],
  ["/wezterm.app/", "WezTerm"],
  ["/alacritty.app/", "Alacritty"],
  ["/kitty.app/", "kitty"]
]);

/**
 * 从进程命令行认出承载会话的宿主 App。
 *
 * 除了几个 Agent 桌面端，还必须认出 Claude Desktop 与各终端：Claude Code 跑在
 * Claude Desktop 里时 TERM_PROGRAM 为空，terminal_app 便恒为 undefined，
 * bridge-server 的 updateJumpTarget 拿不到 app 会直接 return —— jumpTarget 永远
 * 不生成，表现为「点击卡片不跳转」，且存活探测以 jumpTarget 为前提，会话也不会
 * 自动结束。
 */
function desktopHostForCommand(command) {
  if (typeof command !== "string") return undefined;
  const normalized = command.toLowerCase();
  for (const [needle, app] of HOST_APP_MATCHERS) {
    if (normalized.includes(needle)) return app;
  }
  return undefined;
}

function detectDesktopHostFromProcessList(raw, startPid = process.ppid) {
  const processes = new Map();
  for (const line of String(raw || "").split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (match) processes.set(Number(match[1]), { parentPid: Number(match[2]), command: match[3] });
  }
  let pid = Number(startPid);
  const seen = new Set();
  while (pid > 1 && !seen.has(pid)) {
    seen.add(pid);
    const entry = processes.get(pid);
    if (!entry) break;
    const app = desktopHostForCommand(entry.command);
    if (app) return app;
    pid = entry.parentPid;
  }
  return undefined;
}

function detectDesktopHostApp() {
  try {
    const raw = execFileSync("/bin/ps", ["-Ao", "pid=,ppid=,command="], {
      encoding: "utf8",
      timeout: 500,
      stdio: ["ignore", "pipe", "ignore"]
    });
    return detectDesktopHostFromProcessList(raw, process.ppid);
  } catch {
    return undefined;
  }
}

/**
 * Add terminal context that Claude Code and Codex do not include in hook JSON.
 * Warp exposes TERM_PROGRAM=WarpTerminal; keeping this metadata on the hook
 * lets WorkIsland retain a reliable jump target even when no TTY is attached.
 */
function enrichTerminalContext(payload, env = process.env) {
  const next = payload;
  const terminalApp = canonicalTerminalApp(next.terminal_app)
    || canonicalTerminalApp(env.TERM_PROGRAM)
    || (env.WARP_CLI_AGENT_PROTOCOL_VERSION ? "Warp" : undefined)
    || detectDesktopHostApp();
  if (terminalApp && !next.terminal_app) next.terminal_app = terminalApp;

  const sessionId = env.WARP_SESSION_ID
    || env.WARP_TAB_ID
    || env.WARP_TERMINAL_SESSION_ID
    || env.ITERM_SESSION_ID
    || env.TERM_SESSION_ID
    || env.CMUX_SURFACE_ID
    || env.KITTY_WINDOW_ID;
  if (sessionId && !next.terminal_session_id) next.terminal_session_id = sessionId;

  const paneId = env.WARP_PANE_UUID || env.WARP_PANE_ID;
  if (paneId && !next.warp_pane_uuid) next.warp_pane_uuid = paneId;
  if (env.TMUX_PANE && !next.tmux_target) next.tmux_target = env.TMUX_PANE;
  return next;
}

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
  // The hook CLI is a short-lived child of the agent. Tracking the parent PID
  // gives AppCoordinator's PidWatcher a safe completion fallback.
  if (next.pid == null && typeof process.ppid === "number") {
    next.pid = process.ppid;
  }
  if (process.env.SSH_CONNECTION) next._sshClient ??= process.env.SSH_CONNECTION;
  return enrichTerminalContext(next);
}

function resolveHookSource(source, payload) {
  if (source === "workbuddy" && payload?.terminal_app === "CodeBuddy CN") return "codebuddy";
  if (source === "trae" && payload?.terminal_app === "TraeWork") return "traework";
  return source;
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
  const effectiveSource = resolveHookSource(source, payload);
  const socketPath = process.env.FLUX_SOCKET_PATH || path.join(os.homedir(), ".flux", "run", "bridge.sock");
  const response = await sendHook(socketPath, effectiveSource, payload);
  if (response?.type === "hookDirective" && response.directive) {
    process.stdout.write(`${JSON.stringify(response.directive)}\n`);
  }
}

async function run() {
  return main().catch((error) => {
    if (process.env.FLUX_HOOKS_DEBUG === "1") {
      process.stderr.write(`[flux-hooks] ${error.message}\n`);
    }
    // Hook transport failures must not block the agent's own workflow.
    process.exitCode = 0;
  });
}

if (require.main === module) void run();

module.exports = {
  canonicalTerminalApp,
  detectDesktopHostFromProcessList,
  enrichTerminalContext,
  enrichPayload,
  resolveHookSource,
  run
};
