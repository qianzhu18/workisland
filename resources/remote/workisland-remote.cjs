#!/usr/bin/env node
"use strict";

/**
 * WorkIsland 远程接入脚本（observe-only，PRD-016 / ADR-0005 第一阶段）。
 *
 * 在远程机器（跑 Agent 的那台）上使用，零 npm 依赖，Node ≥ 18。
 *
 *   node workisland-remote.cjs init                 生成稳定 host id（UUID）
 *   node workisland-remote.cjs pair <令牌>          用一次性令牌换取会话密钥
 *   node workisland-remote.cjs hook                 Claude Code hook 入口（stdin JSON → 状态行）
 *   node workisland-remote.cjs send <状态> <会话id> [工具]   手动发一条状态（自检用）
 *   node workisland-remote.cjs install-hooks        把 Claude Code hook 写入 ~/.claude/settings.json
 *   node workisland-remote.cjs uninstall-hooks      从 ~/.claude/settings.json 移除上述 hook
 *
 * 硬性边界（ADR-0005）：
 * - 只回传状态（running / completed / failed / approval_requested / stale），
 *   不回传 prompt、代码、路径；服务端入口也会丢弃这些字段（D3）。
 * - 配对令牌不落盘；换取的会话密钥存在 ~/.workisland-remote/session-key（0600）。
 * - 数据通道是用户自管的 SSH 隧道（远程侧 ssh -L 17878:127.0.0.1:7878 <mac>），
 *   本脚本只连 127.0.0.1:17878，从不直接访问网络。
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");

const REMOTE_DIR = path.join(os.homedir(), ".workisland-remote");
const HOST_ID_PATH = path.join(REMOTE_DIR, "host-id");
const SESSION_KEY_PATH = path.join(REMOTE_DIR, "session-key");
const CLAUDE_SETTINGS = path.join(os.homedir(), ".claude", "settings.json");
const HOOK_MARKER = "workisland-remote.cjs";

// Claude Code hook 事件 → observe-only 状态（D3 白名单内）。
const HOOK_STATE_MAP = {
  SessionStart: "running",
  UserPromptSubmit: "running",
  Notification: "approval_requested",
  Stop: "completed",
  SessionEnd: "stale"
};

const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const FORWARD_PORT_DEFAULT = 17878;

function readSessionKey() {
  try {
    const key = fs.readFileSync(SESSION_KEY_PATH, "utf8").trim();
    return key.length >= 16 ? key : null;
  } catch {
    return null;
  }
}

function ensureHostId() {
  fs.mkdirSync(REMOTE_DIR, { recursive: true, mode: 0o700 });
  try {
    const existing = fs.readFileSync(HOST_ID_PATH, "utf8").trim();
    if (/^[0-9a-f-]{36}$/i.test(existing)) return existing;
  } catch {}
  const id = crypto.randomUUID();
  fs.writeFileSync(HOST_ID_PATH, `${id}\n`, { mode: 0o600 });
  return id;
}

/**
 * 与 WorkIsland observe-only 入口的一次性短连接：连接 → 发送 → 收到期望
 * 回应后主动断开。超时或被拒时抛错（错误信息直接给人看）。
 */
function talk(port, lines, { expectType = "ack", timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    let buffer = "";
    const received = [];
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      fn(value);
    };
    const timer = setTimeout(() => {
      finish(reject, new Error(`连接 127.0.0.1:${port} 超时——SSH 隧道未建立或 WorkIsland 远程接入未开启`));
    }, timeoutMs);
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        try {
          received.push(JSON.parse(line));
        } catch {}
      }
      if (expectType && received.some((r) => r.type === expectType)) {
        finish(resolve, received);
      }
    });
    socket.on("error", (err) => {
      finish(reject, new Error(`无法连接 127.0.0.1:${port}（${err.code ?? err.message}）——SSH 隧道未建立？`));
    });
    socket.on("close", () => finish(resolve, received));
    for (const line of lines) socket.write(`${JSON.stringify(line)}\n`);
  });
}

function sessionIdFromPayload(payload) {
  const id = typeof payload?.session_id === "string" ? payload.session_id.trim() : "";
  return SESSION_ID_RE.test(id) ? id : null;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (command === "init") {
    const hostId = ensureHostId();
    console.log(`host-id: ${hostId}`);
    return;
  }

  if (command === "pair") {
    const token = rest[0];
    const port = Number(rest[1] ?? process.env.WORKISLAND_FORWARD_PORT) || FORWARD_PORT_DEFAULT;
    if (!token) {
      console.error("用法：workisland-remote.cjs pair <配对令牌> [转发端口]");
      process.exitCode = 1;
      return;
    }
    const hostId = ensureHostId();
    const replies = await talk(port, [
      { type: "pair", hostId, displayName: os.hostname(), token }
    ], { expectType: "pairResult" });
    const result = replies.find((r) => r.type === "pairResult");
    if (!result?.ok) {
      console.error(`配对失败：${result?.error ?? "无响应"}（令牌过期/已用？请让用户重新生成）`);
      process.exitCode = 1;
      return;
    }
    fs.mkdirSync(REMOTE_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(SESSION_KEY_PATH, `${result.sessionKey}\n`, { mode: 0o600 });
    console.log(`配对成功：${result.displayName}（host ${result.hostId}），会话密钥已存 ${SESSION_KEY_PATH}`);
    return;
  }

  if (command === "hook") {
    let raw = "";
    await new Promise((resolve) => {
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { raw += chunk; });
      process.stdin.on("end", resolve);
      // hook 上下文里 stdin 可能已关闭
      setTimeout(resolve, 1500).unref?.();
    });
    let payload = {};
    try {
      payload = JSON.parse(raw);
    } catch {}
    const state = HOOK_STATE_MAP[payload?.hook_event_name];
    const sessionKey = readSessionKey();
    const sessionId = sessionIdFromPayload(payload);
    if (!state || !sessionKey || !sessionId) return; // 非 Claude hook / 未配对 / 无会话 id：静默忽略
    const port = Number(process.env.WORKISLAND_FORWARD_PORT) || FORWARD_PORT_DEFAULT;
    await talk(port, [{ type: "state", sessionKey, state, sessionId, tool: "claude" }], { timeoutMs: 4000 });
    return;
  }

  if (command === "send") {
    const [state, sessionId, tool = "claude"] = rest;
    const sessionKey = readSessionKey();
    if (!sessionKey) {
      console.error("尚未配对：先运行 pair <令牌>");
      process.exitCode = 1;
      return;
    }
    if (!state || !sessionId) {
      console.error("用法：workisland-remote.cjs send <running|completed|failed|approval_requested|stale> <会话id> [工具]");
      process.exitCode = 1;
      return;
    }
    const port = Number(process.env.WORKISLAND_FORWARD_PORT) || FORWARD_PORT_DEFAULT;
    const replies = await talk(port, [{ type: "state", sessionKey, state, sessionId, tool }]);
    const ack = replies.find((r) => r.type === "ack");
    if (!ack?.ok) {
      console.error(`发送失败：${ack?.error ?? "无响应"}`);
      process.exitCode = 1;
      return;
    }
    console.log(`已发送：${tool} ${sessionId} → ${state}`);
    return;
  }

  if (command === "install-hooks" || command === "uninstall-hooks") {
    let settings = {};
    try {
      settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, "utf8"));
    } catch {}
    if (command === "install-hooks") {
      if (!fs.existsSync(CLAUDE_SETTINGS)) fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });
      try { fs.copyFileSync(CLAUDE_SETTINGS, `${CLAUDE_SETTINGS}.workisland-remote-backup`); } catch {}
      const selfPath = path.resolve(process.argv[1]);
      const entry = () => ({
        hooks: [{ type: "command", command: `node ${selfPath} hook` }]
      });
      settings.hooks = settings.hooks ?? {};
      for (const event of Object.keys(HOOK_STATE_MAP)) {
        const list = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
        if (list.some((g) => (g.hooks ?? []).some((h) => String(h.command ?? "").includes(HOOK_MARKER)))) continue;
        list.push(entry(event));
        settings.hooks[event] = list;
      }
      fs.writeFileSync(CLAUDE_SETTINGS, `${JSON.stringify(settings, null, 2)}\n`);
      console.log(`Claude Code hook 已写入 ${CLAUDE_SETTINGS}（备份：settings.json.workisland-remote-backup）`);
    } else {
      if (settings.hooks) {
        for (const event of Object.keys(settings.hooks)) {
          settings.hooks[event] = (settings.hooks[event] ?? []).filter(
            (group) => !(group.hooks ?? []).some((h) => String(h.command ?? "").includes(HOOK_MARKER))
          );
        }
      }
      fs.writeFileSync(CLAUDE_SETTINGS, `${JSON.stringify(settings, null, 2)}\n`);
      console.log("WorkIsland 远程 hook 已移除");
    }
    return;
  }

  console.log(`WorkIsland 远程接入脚本（observe-only）

用法：
  node workisland-remote.cjs init                    生成/显示 host id
  node workisland-remote.cjs pair <令牌> [端口]       用一次性令牌换取会话密钥
  node workisland-remote.cjs hook                    Claude Code hook 入口
  node workisland-remote.cjs send <状态> <会话id> [工具]  手动发送状态（自检）
  node workisland-remote.cjs install-hooks           安装 Claude Code hook
  node workisland-remote.cjs uninstall-hooks         移除 Claude Code hook

前置：SSH 隧道已建立（ssh -N -L 17878:127.0.0.1:7878 <user>@<mac>）`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
