"use strict";

const electron = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const url = require("node:url");
const promises = require("node:fs/promises");
const log = require("electron-log");
const utils = require("@electron-toolkit/utils");
const toml__namespace = require("@iarna/toml");
const {
  shellQuote,
  buildDevHooksCliCommand,
  wrapWithInstallCheck,
  isKimiBitsEntry,
  OPENCODE_BITS_PLUGIN_FILENAME
} = require("./hook-shared.cjs");

const OPENCODE_PLUGIN_FILENAME = "flux-opencode-plugin.js";
const OPENCODE_PLUGIN_VERSION = "v5";
const OPENCODE_PLUGIN_VERSION_MARKER = `// flux-opencode-plugin version: ${OPENCODE_PLUGIN_VERSION}`;
function getOpenCodeConfigDir(homeDir) {
  return path.join(homeDir, ".config", "opencode");
}
function getOpenCodePluginDir(homeDir) {
  return path.join(getOpenCodeConfigDir(homeDir), "plugins");
}
function getOpenCodePluginInstallPath(homeDir) {
  return path.join(getOpenCodePluginDir(homeDir), OPENCODE_PLUGIN_FILENAME);
}
function getOpenCodeConfigPathCandidates(homeDir) {
  const dir = getOpenCodeConfigDir(homeDir);
  return [path.join(dir, "opencode.json"), path.join(dir, "config.json")];
}
function getOpenCodePluginRef(homeDir) {
  return `file://${getOpenCodePluginInstallPath(homeDir)}`;
}
function buildOpenCodePluginContent(socketPath) {
  return String.raw`// flux-opencode-plugin version: ${OPENCODE_PLUGIN_VERSION}
// Orca plugin for OpenCode.
// Bridges OpenCode events to the Orca app via Unix socket.
import { connect } from "net";

const SOCKET_PATH =
  process.env.FLUX_SOCKET_PATH ||
  ${JSON.stringify(socketPath)};

function encodeEnvelope(command) {
  return JSON.stringify({ type: "command", command }) + "\n";
}

function sendToSocket(json) {
  return new Promise((resolve) => {
    try {
      const sock = connect({ path: SOCKET_PATH });
      let buf = "";
      sock.on("data", (chunk) => {
        buf += chunk.toString();
        let start = 0;
        for (let i = 0; i < buf.length; i++) {
          if (buf[i] === "\n") {
            const line = buf.slice(start, i);
            start = i + 1;
            if (!line) continue;
            try {
              const env = JSON.parse(line);
              if (env.type === "hello") {
                sock.write(encodeEnvelope(json));
              } else if (env.type === "response") {
                sock.end();
                resolve(true);
              }
            } catch {}
          }
        }
        buf = buf.slice(start);
      });
      sock.on("end", () => resolve(true));
      sock.on("error", () => resolve(false));
      sock.setTimeout(3000, () => { sock.destroy(); resolve(false); });
    } catch { resolve(false); }
  });
}

function sendAndWaitResponse(json, timeoutMs = 300000) {
  return new Promise((resolve) => {
    try {
      const sock = connect({ path: SOCKET_PATH });
      let buf = "";
      sock.on("data", (chunk) => {
        buf += chunk.toString();
        let start = 0;
        for (let i = 0; i < buf.length; i++) {
          if (buf[i] === "\n") {
            const line = buf.slice(start, i);
            start = i + 1;
            if (!line) continue;
            try {
              const env = JSON.parse(line);
              if (env.type === "hello") {
                sock.write(encodeEnvelope(json));
              } else if (env.type === "response") {
                sock.end();
                resolve(env.response);
              }
            } catch {}
          }
        }
        buf = buf.slice(start);
      });
      sock.on("end", () => resolve(null));
      sock.on("error", () => resolve(null));
      sock.setTimeout(timeoutMs, () => { sock.destroy(); resolve(null); });
    } catch { resolve(null); }
  });
}

// ── 异步 token 采集：不阻塞事件链路，采集完成后补发独立 payload ──
function collectTokensAsync(sessionId, realSid) {
  const { execFile } = require("child_process");
  const { join } = require("path");
  const { homedir } = require("os");
  const dbPath = join(homedir(), ".local", "share", "opencode", "opencode.db");
  const sql = "SELECT json_extract(data, '$.tokens'), json_extract(data, '$.modelID') FROM message WHERE session_id = '" + realSid + "' AND json_extract(data, '$.role') = 'assistant' AND time_created > COALESCE((SELECT time_created FROM message WHERE session_id = '" + realSid + "' AND json_extract(data, '$.role') = 'user' ORDER BY time_created DESC LIMIT 1), 0) ORDER BY time_created ASC";

  function parseResult(result) {
    if (!result) return null;
    let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0, model;
    for (const line of result.split("\\n")) {
      try {
        const sepIdx = line.lastIndexOf("|");
        const tokensStr = sepIdx >= 0 ? line.slice(0, sepIdx) : line;
        const modelStr = sepIdx >= 0 ? line.slice(sepIdx + 1) : "";
        const tokens = JSON.parse(tokensStr);
        inputTokens += typeof tokens.input === "number" ? tokens.input : 0;
        outputTokens += typeof tokens.output === "number" ? tokens.output : 0;
        const cache = tokens.cache;
        if (cache && typeof cache === "object") {
          cacheReadTokens += typeof cache.read === "number" ? cache.read : 0;
          cacheWriteTokens += typeof cache.write === "number" ? cache.write : 0;
        }
        if (!model && modelStr) model = modelStr;
      } catch { continue; }
    }
    if (inputTokens > 0 || outputTokens > 0) {
      return { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens, cache_read_tokens: cacheReadTokens, cache_creation_tokens: cacheWriteTokens, model, is_estimated: false };
    }
    return null;
  }

  function reportTokens(tokenUsage) {
    const remoteContext = _sshClient || _hostname
      ? { hostname: _hostname, username: _username, ipAddrs: _ipAddrs, sshClient: _sshClient }
      : undefined;
    return sendToSocket({ type: "reportTokenUsage", source: "opencode", sessionId, tokenUsage, remoteContext });
  }

  return new Promise((resolve) => {
    execFile("sqlite3", [dbPath, "-separator", "|", sql], { encoding: "utf-8", timeout: 1500 }, (err, stdout) => {
      if (!err) {
        const result = (stdout || "").trim();
        const usage = result ? parseResult(result) : null;
        if (usage) reportTokens(usage).then(resolve); else resolve();
        return;
      }
      const pyScript = "import sqlite3,json,sys\\nconn=sqlite3.connect(sys.argv[1])\\nfor row in conn.execute(sys.argv[2]):\\n t,m=row\\n print(str(t or'')+'|'+str(m or''))\\nconn.close()";
      execFile("python3", ["-c", pyScript, dbPath, sql], { encoding: "utf-8", timeout: 3000 }, (err2, stdout2) => {
        const result2 = err2 ? "" : (stdout2 || "").trim();
        const usage = result2 ? parseResult(result2) : null;
        if (usage) reportTokens(usage).then(resolve); else resolve();
      });
    });
  });
}

let detectedTty = null;
try {
  const { execSync } = require("child_process");
  let walkPid = process.pid;
  for (let i = 0; i < 8; i++) {
    const info = execSync("ps -o tty=,ppid= -p " + walkPid, { timeout: 1000 }).toString().trim();
    const parts = info.split(/\s+/);
    const tty = parts[0], ppid = parseInt(parts[1]);
    if (tty && tty !== "??" && tty !== "?") { detectedTty = "/dev/" + tty; break; }
    if (!ppid || ppid <= 1) break;
    walkPid = ppid;
  }
} catch {}

// ── 远程开发：注入主机标识，用于 BridgeServer 远程会话识别 ──
const _hostname = (() => { try { return require("os").hostname(); } catch { return undefined; } })();
const _username = (() => { try { return require("os").userInfo().username; } catch { return undefined; } })();
const _ipAddrs = (() => {
  try {
    const addrs = [];
    for (const ifaces of Object.values(require("os").networkInterfaces())) {
      if (!ifaces) continue;
      for (const iface of ifaces) {
        if (!iface.internal) addrs.push(iface.address);
      }
    }
    return addrs.length > 0 ? addrs : undefined;
  } catch { return undefined; }
})();
const _sshClient = (() => {
  const raw = process.env.SSH_CONNECTION;
  if (!raw) return undefined;
  const parts = raw.trim().split(/\s+/);
  if (parts.length >= 2) {
    const port = parseInt(parts[1], 10);
    if (parts[0] && Number.isFinite(port)) return { ip: parts[0], port };
  }
  return undefined;
})();

const ENV_KEYS = [
  "TERM_PROGRAM", "ITERM_SESSION_ID", "TERM_SESSION_ID",
  "TMUX", "TMUX_PANE", "KITTY_WINDOW_ID",
];

function recognizedTerminalApp(command) {
  const low = command.toLowerCase();
  if (low.includes("/opencode.app/") || low.includes("/opencode desktop.app/")) return "OpenCode";
  if (low.includes("/claude.app/")) return "Claude";
  if (low.includes("/codex.app/") || low.includes("/codex desktop.app/")) return "Codex";
  if (low.includes("/cmux.app/contents/macos/cmux")) return "cmux";
  if (low.includes("/ghostty.app/contents/macos/ghostty") || low.endsWith("/ghostty")) return "Ghostty";
  if (low.includes("/terminal.app/contents/macos/terminal")) return "Terminal";
  if (low.includes("/iterm.app/contents/macos/iterm2")) return "iTerm";
  if (low.includes("/wezterm.app/contents/macos/wezterm-gui") || low.endsWith("/wezterm-gui")) return "WezTerm";
  if (low.includes("/warp.app/") || low.endsWith("/warp")) return "Warp";
  if (low.includes("/alacritty.app/") || low.endsWith("/alacritty")) return "Alacritty";
  if (low.includes("/kitty.app/") || low.endsWith("/kitty")) return "kitty";
  if (low.includes("/cursor.app/")) return "Cursor";
  if (low.includes("/windsurf.app/")) return "Windsurf";
  if (low.includes("/trae cn - alpha.app/")) return "Trae CN - Alpha";
  if (low.includes("/trae cn.app/")) return "Trae CN";
  if (low.includes("/trae.app/")) return "Trae";
  if (low.includes("/visual studio code - insiders.app/")) return "VS Code Insiders";
  if (low.includes("/visual studio code.app/") || low.includes("/code helper")) return "VS Code";
  if ((low.includes("/intellij idea") && low.includes(".app/")) || low.includes("/idea.app/")) return "IntelliJ IDEA";
  if (low.includes('/android studio') && low.includes('.app/')) return 'Android Studio';
  if (low.includes("/webstorm") && low.includes(".app/")) return "WebStorm";
  if (low.includes("/pycharm") && low.includes(".app/")) return "PyCharm";
  if (low.includes("/goland") && low.includes(".app/")) return "GoLand";
  if (low.includes("/clion") && low.includes(".app/")) return "CLion";
  if (low.includes("/rubymine") && low.includes(".app/")) return "RubyMine";
  if (low.includes("/phpstorm") && low.includes(".app/")) return "PhpStorm";
  if (low.includes("/rider") && low.includes(".app/")) return "Rider";
  if (low.includes("/rustrover") && low.includes(".app/")) return "RustRover";
  return undefined;
}

function detectTerminalAppFromProcessTree() {
  try {
    const { execSync } = require("child_process");
    const raw = execSync("/bin/ps -Ao pid=,ppid=,command=", { timeout: 500, stdio: ["pipe", "pipe", "pipe"] }).toString();
    const procs = new Map();
    for (const line of raw.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (m) procs.set(m[1], { ppid: m[2], command: m[3] });
    }
    let pid = String(process.ppid);
    const seen = new Set();
    while (pid && pid !== "0" && pid !== "1" && !seen.has(pid)) {
      seen.add(pid);
      const p = procs.get(pid);
      if (!p) break;
      const app = recognizedTerminalApp(p.command);
      if (app) return app;
      pid = p.ppid;
    }
  } catch {}
  return undefined;
}

const TERM_PROGRAM_CANONICAL = {
  apple_terminal: "Terminal",
  "iterm.app": "iTerm",
  warpterminal: "Warp",
};

function detectTerminalApp() {
  const env = process.env;
  if (env.CMUX_SURFACE_ID) return "cmux";
  if (env.VSCODE_IPC_HOOK_CLI || env.VSCODE_PID || env.VSCODE_CWD) {
    return detectTerminalAppFromProcessTree() || "VS Code";
  }
  if (env.TERMINAL_EMULATOR === "JetBrains-JediTerm") {
    return detectTerminalAppFromProcessTree() || "IntelliJ IDEA";
  }
  const term = env.TERM_PROGRAM;
  if (term === "vscode") return detectTerminalAppFromProcessTree() || "VS Code";
  if (term) return TERM_PROGRAM_CANONICAL[term.toLowerCase()] || term;
  return detectTerminalAppFromProcessTree() || "OpenCode";
}

function terminalFields() {
  const env = process.env;
  const app = detectTerminalApp();
  const result = { pid: process.pid };
  if (app) {
    result.terminal_app = app;
    const low = app.toLowerCase();
    if (low === "iterm" && env.ITERM_SESSION_ID) {
      result.terminal_session_id = env.ITERM_SESSION_ID;
    } else if (low === "ghostty" && env.TERM_SESSION_ID) {
      result.terminal_session_id = env.TERM_SESSION_ID;
    } else if (low === "cmux" && env.CMUX_SURFACE_ID) {
      result.terminal_session_id = env.CMUX_SURFACE_ID;
    } else if (low === "kitty" && env.KITTY_WINDOW_ID) {
      result.terminal_session_id = env.KITTY_WINDOW_ID;
    }
  }
  if (detectedTty) result.terminal_tty = detectedTty;
  return result;
}

function makePayload(hookEventName, sessionID, cwd, extra = {}) {
  const payload = {
    hook_event_name: hookEventName,
    session_id: "opencode-" + sessionID,
    cwd: cwd || ".",
    ...terminalFields(),
    ...extra,
  };
  if (_hostname) payload._hostname = _hostname;
  if (_username) payload._username = _username;
  if (_ipAddrs) payload._ipAddrs = _ipAddrs;
  if (_sshClient) payload._sshClient = _sshClient;
  return {
    type: "processHook",
    source: "opencode",
    payload,
  };
}

function extractSubagentFields(p) {
    return {
        ...(p.agent_id && { agent_id: p.agent_id }),
    };
}

const LIFECYCLE_EVENTS = new Set(["SessionStart", "SessionEnd"]);

export default async ({ client, serverUrl }) => {
  const serverPort = serverUrl ? parseInt(serverUrl.port) || 4096 : 4096;
  const internalFetch = client?._client?.getConfig?.()?.fetch || null;
  const msgRoles = new Map();
  const assistantMessageParts = new Map();
  const userMessageParts = new Map();
  const sessionCwd = new Map();
  const sessions = new Map();
  const pendingRequestSessions = new Set();
  const childSessions = new Set();

  function getSession(sid) {
    if (!sessions.has(sid)) sessions.set(sid, { lastAssistantText: "", title: "" });
    return sessions.get(sid);
  }

  function clearSessionMessageState(sessionID) {
    for (const [messageID, meta] of msgRoles) {
      if (meta.sessionID !== sessionID) continue;
      msgRoles.delete(messageID);
      assistantMessageParts.delete(messageID);
      userMessageParts.delete(messageID);
    }
  }

  function upsertMessagePart(store, messageID, partID, text) {
    let parts = store.get(messageID);
    if (!parts) {
      parts = new Map();
      store.set(messageID, parts);
    }
    if (text) {
      parts.set(partID, text);
    } else {
      parts.delete(partID);
    }
    if (parts.size === 0) {
      store.delete(messageID);
      return "";
    }
    return Array.from(parts.values())
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join("\n");
  }

  async function postPermissionReply(requestId, directive) {
    if (!requestId) return;
    const permanent = directive?.type === "allow" && directive?.permanent === true;
    const reply = directive?.type === "allow"
      ? (permanent ? "always" : "once")
      : "reject";
    const message = directive?.type === "deny" ? directive?.reason : undefined;
    const url = "http://localhost:" + serverPort + "/permission/" + requestId + "/reply";
    const body = JSON.stringify({ reply, message });
    const opts = { method: "POST", headers: { "Content-Type": "application/json" }, body };
    try {
      if (internalFetch) {
        await internalFetch(new Request(url, opts));
        return;
      }
    } catch {}
    try { await fetch(url, opts); } catch {}
  }

  async function postQuestionReply(requestId, directive) {
    if (!requestId || directive?.type !== "answer") return;
    let answers;
    if (Array.isArray(directive.answers)) {
      answers = directive.answers.map((a) => Array.isArray(a) ? a : [String(a || "")]);
    } else if (typeof directive.text === "string") {
      answers = [[directive.text]];
    } else {
      return;
    }
    const url = "http://localhost:" + serverPort + "/question/" + requestId + "/reply";
    const body = JSON.stringify({ answers });
    const opts = { method: "POST", headers: { "Content-Type": "application/json" }, body };
    try {
      if (internalFetch) {
        await internalFetch(new Request(url, opts));
        return;
      }
    } catch {}
    try { await fetch(url, opts); } catch {}
  }

  function mapEvent(ev) {
    const t = ev.type;
    const p = ev.properties || {};
    const subagentFields = extractSubagentFields(p);

    if (t === "message.part.updated" && p.part && p.part.type === "tool" && p.part.tool === "task") {
      const metadata = p.part.state?.metadata;
      if (metadata?.sessionId) {
        childSessions.add(metadata.sessionId);
      }
    }

    if (t === "session.created" && p.info && p.info.parentID) {
      childSessions.add(p.info.id);
    }

    if (p.sessionID && childSessions.has(p.sessionID)) {
      return null;
    }

    if (t === "session.created" && p.info) {
      if (childSessions.has(p.info.id)) {
        return null;
      }

      const cwd = p.info.directory || "";
      sessionCwd.set(p.info.id, cwd);
      const extra = { ...subagentFields };
      const title = p.info.title || p.info.name || '';
      if (title) {
        extra.session_title = title;
        getSession(p.info.id).title = title;
      }
      return makePayload("SessionStart", p.info.id, cwd, extra);
    }

    if (t === "session.deleted" && p.info) {
      if (childSessions.has(p.info.id)) {
        childSessions.delete(p.info.id);
        return null;
      }
      sessions.delete(p.info.id);
      const cwd = sessionCwd.get(p.info.id);
      sessionCwd.delete(p.info.id);
      clearSessionMessageState(p.info.id);
      return makePayload("SessionEnd", p.info.id, cwd, { ...subagentFields });
    }

    if (t === "session.updated" && p.info) {
      if (childSessions.has(p.info.id)) {
        return null;
      }
      if (p.info.directory) sessionCwd.set(p.info.id, p.info.directory);
      const title = p.info.title || p.info.name;
      if (title) getSession(p.info.id).title = title;

      if (p.info.time?.archived) {
        sessions.delete(p.info.id);
        const cwd = sessionCwd.get(p.info.id);
        sessionCwd.delete(p.info.id);
        clearSessionMessageState(p.info.id);
        return makePayload("SessionEnd", p.info.id, cwd, { ...subagentFields });
      }
      return null;
    }

    if (t === "session.status" && p.sessionID) {
      if (childSessions.has(p.sessionID)) {
        return null;
      }
      if (p.status?.type === "idle") {
        const s = getSession(p.sessionID);
        const extra = {
          last_assistant_message: s.lastAssistantText || undefined,
          ...subagentFields
        };
        if (s.title) extra.session_title = s.title;
        return makePayload("Stop", p.sessionID, sessionCwd.get(p.sessionID), extra);
      }
      return null;
    }

    if (t === "message.updated" && p.info?.id && p.info?.sessionID) {
      if (childSessions.has(p.info.sessionID)) {
        return null;
      }
      msgRoles.set(p.info.id, { role: p.info.role, sessionID: p.info.sessionID });
      if (msgRoles.size > 200) {
        const oldestMessageID = msgRoles.keys().next().value;
        msgRoles.delete(oldestMessageID);
        assistantMessageParts.delete(oldestMessageID);
        userMessageParts.delete(oldestMessageID);
      }
      return null;
    }

    if (t === "message.part.updated" && p.part?.type === "text" && p.part?.messageID) {
      const meta = msgRoles.get(p.part.messageID);
      if (!meta) return null;
      if (childSessions.has(meta.sessionID)) {
        return null;
      }
      const text = p.part.text || "";
      if (meta.role === "user" && text) {
        if (p.part.synthetic === true || p.part.ignored === true) return null;
        const prompt = upsertMessagePart(
          userMessageParts,
          p.part.messageID,
          p.part.id || (p.part.messageID + ":text"),
          text,
        );
        if (!prompt) return null;
        return makePayload("UserPromptSubmit", meta.sessionID, sessionCwd.get(meta.sessionID), { prompt, ...subagentFields });
      }
      if (meta.role === "assistant" && text) {
        const assistantText = upsertMessagePart(
          assistantMessageParts,
          p.part.messageID,
          p.part.id || (p.part.messageID + ":text"),
          text,
        );
        if (!assistantText) return null;
        getSession(meta.sessionID).lastAssistantText = assistantText;

        const extra = { assistant_message_preview: assistantText, ...subagentFields };
        const title = getSession(meta.sessionID).title;
        if (title) extra.session_title = title;

        return makePayload("AssistantMessageUpdate", meta.sessionID, sessionCwd.get(meta.sessionID), extra);
      }
      return null;
    }

    if (t === "message.part.updated" && p.part?.type === "tool" && p.part?.sessionID) {
      if (childSessions.has(p.part.sessionID)) {
        return null;
      }
      const st = p.part.state?.status;
      const cwd = sessionCwd.get(p.part.sessionID);
      const toolName = (p.part.tool || "").charAt(0).toUpperCase() + (p.part.tool || "").slice(1);
      if (st === "running" || st === "pending") {
        return makePayload("PreToolUse", p.part.sessionID, cwd, {
          tool_name: toolName,
          tool_input: typeof p.part.state?.input === "string"
            ? p.part.state.input
            : JSON.stringify(p.part.state?.input || {}).slice(0, 200),
          ...subagentFields
        });
      }
      if (st === "completed" || st === "error") {
        return makePayload("PostToolUse", p.part.sessionID, cwd, {
          tool_name: toolName,
          ...subagentFields
        });
      }
      return null;
    }

    if (t === "permission.asked" && p.id && p.sessionID) {
      if (childSessions.has(p.sessionID)) {
        return null;
      }
      const toolName = (p.permission || "").charAt(0).toUpperCase() + (p.permission || "").slice(1);
      const patterns = p.patterns || [];
      const toolInput = { patterns, metadata: p.metadata };
      if (p.permission === "bash" && patterns.length > 0) {
        toolInput.command = patterns.join(" && ");
      }
      if ((p.permission === "edit" || p.permission === "write") && patterns.length > 0) {
        toolInput.file_path = patterns[0];
      }
      return makePayload("PermissionRequest", p.sessionID, sessionCwd.get(p.sessionID), {
        tool_name: toolName,
        tool_input: JSON.stringify(toolInput).slice(0, 200),
        permission_id: p.id,
        permission_title: "Allow " + toolName,
        permission_description: patterns.length > 0
          ? ("OpenCode wants to run " + toolName + ": " + patterns[0])
          : ("OpenCode wants to run " + toolName),
        _opencode_request_id: p.id,
        ...subagentFields
      });
    }

    if (t === "permission.replied" && p.sessionID) {
      if (childSessions.has(p.sessionID)) {
        return null;
      }
      return makePayload("PostToolUse", p.sessionID, sessionCwd.get(p.sessionID), { ...subagentFields });
    }

    if (t === "question.asked" && p.id && p.sessionID) {
      const rawQuestions = Array.isArray(p.questions) ? p.questions : [];
      const structured = rawQuestions.map((q) => ({
        question: q.question || "",
        header: q.header || "",
        options: (q.options || []).map((opt) => ({
          label: opt.label,
          description: opt.description,
        })),
        multiple: !!q.multiple,
      }));
      const flatText = rawQuestions.map((q) => q.question).filter(Boolean).join("; ")
        || "OpenCode has a question";
      return makePayload("QuestionAsked", p.sessionID, sessionCwd.get(p.sessionID), {
        question_id: p.id,
        question_text: flatText,
        tool_input: { questions: structured },
        _opencode_request_id: p.id,
        ...subagentFields
      });
    }

    if ((t === "question.replied" || t === "question.rejected") && p.sessionID) {
      return makePayload("PostToolUse", p.sessionID, sessionCwd.get(p.sessionID), { ...subagentFields });
    }

    return null;
  }

  return {
    "event": async ({ event }) => {
      try {
        const mapped = mapEvent(event);
        if (!mapped) return;

        const hookName = mapped.payload.hook_event_name;
        const sid = mapped.payload.session_id;

        if (
          pendingRequestSessions.has(sid) &&
          !LIFECYCLE_EVENTS.has(hookName) &&
          hookName !== "PermissionRequest" &&
          hookName !== "QuestionAsked" &&
          hookName !== "PostToolUse"
        ) {
          return;
        }

        if (hookName === "PermissionRequest") {
          const requestId = mapped.payload._opencode_request_id;
          pendingRequestSessions.add(sid);
          sendAndWaitResponse(mapped)
            .then(async (response) => {
              const directive = response?.directive;
              if (directive) await postPermissionReply(requestId, directive);
            })
            .finally(() => { pendingRequestSessions.delete(sid); })
            .catch(() => {});
          return;
        }

        if (hookName === "QuestionAsked") {
          const requestId = mapped.payload._opencode_request_id;
          pendingRequestSessions.add(sid);
          sendAndWaitResponse(mapped)
            .then(async (response) => {
              const directive = response?.directive;
              if (directive) await postQuestionReply(requestId, directive);
            })
            .finally(() => { pendingRequestSessions.delete(sid); })
            .catch(() => {});
          return;
        }

        await sendToSocket(mapped);

        // ── 远端 token 采集：Stop/SessionEnd 后异步采集，不阻塞 hook 事件链路 ──
        if (hookName === "Stop" || hookName === "SessionEnd") {
          const rawSid = mapped.payload.session_id;
          const realSid = typeof rawSid === "string" ? rawSid.replace(/^opencode-/, "") : "";
          if (/^ses_[A-Za-z0-9]{10,40}$/.test(realSid)) {
            collectTokensAsync(rawSid, realSid).catch(() => {});
          }
        }
      } catch {}
    },

    "shell.env": async (input, output) => {
      output.env.FLUX_ACTIVE = "1";
      for (const v of ENV_KEYS) {
        if (process.env[v]) output.env["_FLUX_" + v] = process.env[v];
      }
    },
  };
};
`;
}
function stripJsonComments(input) {
  let out = "";
  let i = 0;
  const len = input.length;
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  while (i < len) {
    const ch = input[i];
    const next = i + 1 < len ? input[i + 1] : "";
    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += ch;
      }
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === "\\" && i + 1 < len) {
        out += input[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === ",") {
      const nextSig = nextSignificantChar(input, i + 1);
      if (nextSig === "}" || nextSig === "]") {
        i++;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}
function nextSignificantChar(input, from) {
  let i = from;
  const len = input.length;
  while (i < len) {
    const ch = input[i];
    if (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "/" && i + 1 < len) {
      const n = input[i + 1];
      if (n === "/") {
        i += 2;
        while (i < len && input[i] !== "\n") i++;
        continue;
      }
      if (n === "*") {
        i += 2;
        while (i + 1 < len && !(input[i] === "*" && input[i + 1] === "/")) i++;
        i += 2;
        continue;
      }
    }
    return ch;
  }
  return "";
}
async function readJson$8(filePath) {
  let raw;
  try {
    raw = await promises.readFile(filePath, "utf-8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
  try {
    return JSON.parse(stripJsonComments(raw));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse JSON(C) at ${filePath}: ${reason}`);
  }
}
async function writeJson$a(filePath, data) {
  await promises.mkdir(path.dirname(filePath), { recursive: true });
  await promises.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
function isOpenCodeFluxPluginRef(ref) {
  return ref.includes(OPENCODE_PLUGIN_FILENAME);
}
function mergeOpenCodePluginRef(config, homeDir) {
  const pluginRef = getOpenCodePluginRef(homeDir);
  const plugins = config.plugin ?? [];
  const filtered = plugins.filter((ref) => !isOpenCodeFluxPluginRef(ref));
  filtered.push(pluginRef);
  const changed = plugins.length !== filtered.length || plugins.some((value, index) => value !== filtered[index]);
  config.plugin = filtered;
  return changed;
}
function stripOpenCodePluginRef(config) {
  if (!config.plugin) return false;
  const before = config.plugin.length;
  config.plugin = config.plugin.filter((ref) => !isOpenCodeFluxPluginRef(ref));
  if (config.plugin.length === 0) delete config.plugin;
  return (config.plugin?.length ?? 0) !== before;
}
async function resolvePrimaryOpenCodeConfigPath(homeDir) {
  const candidates = getOpenCodeConfigPathCandidates(homeDir);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}
async function installOpenCodeHook(ctx, options) {
  const pluginPath = getOpenCodePluginInstallPath(ctx.homeDir);
  await promises.mkdir(path.dirname(pluginPath), { recursive: true });
  await promises.writeFile(pluginPath, ctx.pluginContent, "utf-8");
  const configPath = await resolvePrimaryOpenCodeConfigPath(ctx.homeDir);
  const configPaths = getOpenCodeConfigPathCandidates(ctx.homeDir);
  const primaryConfig = await readJson$8(configPath) ?? {};
  mergeOpenCodePluginRef(primaryConfig, ctx.homeDir);
  await writeJson$a(configPath, primaryConfig);
  for (const candidate of configPaths) {
    if (candidate === configPath) continue;
    const secondary = await readJson$8(candidate);
    if (!secondary) continue;
    let changed = stripOpenCodePluginRef(secondary);
    if (changed) {
      await writeJson$a(candidate, secondary);
    }
  }
  return { configPath, pluginPath, configPaths };
}
async function uninstallOpenCodeHook(homeDir, options) {
  for (const configPath of getOpenCodeConfigPathCandidates(homeDir)) {
    const config = await readJson$8(configPath);
    if (!config) continue;
    let changed = stripOpenCodePluginRef(config);
    if (changed) {
      await writeJson$a(configPath, config);
    }
  }
  const files = [getOpenCodePluginInstallPath(homeDir), ...[]];
  for (const filePath of files) {
    try {
      await promises.unlink(filePath);
    } catch (err) {
      if (err.code !== "ENOENT" && options?.strict) ;
    }
  }
}
async function checkOpenCodeHook(homeDir) {
  const issues = [];
  const pluginPath = getOpenCodePluginInstallPath(homeDir);
  const configPaths = getOpenCodeConfigPathCandidates(homeDir);
  if (!fs.existsSync(pluginPath)) {
    issues.push(`Plugin file not found: ${pluginPath}`);
    return { pluginPath, configPaths, issues, installed: false };
  }
  try {
    const content = await promises.readFile(pluginPath, "utf-8");
    if (!content.includes(OPENCODE_PLUGIN_VERSION_MARKER)) {
      issues.push(`Plugin outdated (expected ${OPENCODE_PLUGIN_VERSION}); will reinstall`);
      return { pluginPath, configPaths, issues, installed: false };
    }
  } catch (err) {
    issues.push(`Cannot read plugin file: ${err instanceof Error ? err.message : String(err)}`);
    return { pluginPath, configPaths, issues, installed: false };
  }
  let foundAnyConfig = false;
  let referenced = false;
  for (const configPath of configPaths) {
    const config = await readJson$8(configPath);
    if (!config) continue;
    foundAnyConfig = true;
    if (config.plugin?.some(isOpenCodeFluxPluginRef)) {
      referenced = true;
      break;
    }
  }
  if (!foundAnyConfig) {
    issues.push("No OpenCode config file found");
    return { pluginPath, configPaths, issues, installed: false };
  }
  if (!referenced) {
    issues.push("Flux plugin not registered in OpenCode config");
    return { pluginPath, configPaths, issues, installed: false };
  }
  return { pluginPath, configPaths, issues, installed: true };
}
function getConfigDir() {
  return path.join(os.homedir(), ".config", "opencode");
}
function getPluginDir() {
  return path.join(getConfigDir(), "plugins");
}
function getManifestPath$6() {
  return path.join(os.homedir(), ".flux", "hooks", "opencode-manifest.json");
}
function getBitsPluginPath() {
  return path.join(getPluginDir(), OPENCODE_BITS_PLUGIN_FILENAME);
}
function getBitsConfigPath() {
  return path.join(os.homedir(), ".config", "opencode", "tea-reporter.config.json");
}
async function readJson$7(filePath) {
  try {
    const raw = await promises.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function writeJson$9(filePath, data) {
  await promises.mkdir(path.dirname(filePath), { recursive: true });
  await promises.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
class OpenCodePluginManager {
  agentId = "opencode";
  async install(options) {
    const homeDir = os.homedir();
    const socketPath = path.join(homeDir, ".flux", "run", "bridge.sock");
    const pluginContent = buildOpenCodePluginContent(socketPath);
    for (const legacyPath of [getBitsPluginPath(), getBitsConfigPath()]) {
      try {
        await promises.unlink(legacyPath);
      } catch {
      }
    }
    const { configPath, pluginPath } = await installOpenCodeHook(
      {
        homeDir,
        pluginContent
      }
    );
    const manifest = {
      configPath,
      pluginPath,
      installedAt: (/* @__PURE__ */ new Date()).toISOString(),
      pluginVersion: OPENCODE_PLUGIN_VERSION
    };
    await writeJson$9(getManifestPath$6(), manifest);
  }
  async uninstall() {
    const homeDir = os.homedir();
    const manifestPath = getManifestPath$6();
    const manifest = await readJson$7(manifestPath);
    await uninstallOpenCodeHook(homeDir);
    const pluginPath = manifest?.pluginPath ?? getOpenCodePluginInstallPath(homeDir);
    try {
      await promises.unlink(pluginPath);
    } catch {
    }
    try {
      await promises.unlink(getBitsPluginPath());
    } catch {
    }
    try {
      await promises.unlink(getBitsConfigPath());
    } catch {
    }
    try {
      await promises.unlink(manifestPath);
    } catch {
    }
  }
  async checkHealth() {
    const homeDir = os.homedir();
    const manifestPath = getManifestPath$6();
    const shared = await checkOpenCodeHook(homeDir);
    const issues = [...shared.issues];
    if (!shared.installed) {
      return { agentId: "opencode", installed: false, issues, manifestPath };
    }
    try {
      await promises.stat(manifestPath);
    } catch {
      issues.push("Manifest missing; install metadata unknown");
    }
    return {
      agentId: "opencode",
      installed: issues.length === 0 && shared.installed,
      issues,
      manifestPath
    };
  }
}
const SARA_PLUGIN_FILENAME = "flux-sara-plugin.js";
const SARA_PLUGIN_VERSION = "v6";
const SARA_PLUGIN_VERSION_MARKER = `// flux-sara-plugin version: ${SARA_PLUGIN_VERSION}`;
function getSaraConfigDir(homeDir) {
  return path.join(homeDir, ".config", "sara");
}
function getSaraPluginDir(homeDir) {
  return path.join(getSaraConfigDir(homeDir), "plugins");
}
function getSaraPluginInstallPath(homeDir) {
  return path.join(getSaraPluginDir(homeDir), SARA_PLUGIN_FILENAME);
}
function getSaraConfigPathCandidates(homeDir) {
  const dir = getSaraConfigDir(homeDir);
  return [path.join(dir, "sara.jsonc"), path.join(dir, "sara.json"), path.join(dir, "config.json")];
}
function getSaraPluginRef(homeDir) {
  return url.pathToFileURL(getSaraPluginInstallPath(homeDir)).toString();
}
function buildSaraPluginContent(socketPath) {
  return String.raw`// flux-sara-plugin version: ${SARA_PLUGIN_VERSION}
// Orca plugin for Sara.
// Bridges Sara events to the Orca app via Unix socket.
import { connect } from "net";

const SOCKET_PATH =
  process.env.FLUX_SOCKET_PATH ||
  ${JSON.stringify(socketPath)};

function encodeEnvelope(command) {
  return JSON.stringify({ type: "command", command }) + "\n";
}

function sendToSocket(json) {
  return new Promise((resolve) => {
    try {
      const sock = connect({ path: SOCKET_PATH });
      let buf = "";
      sock.on("data", (chunk) => {
        buf += chunk.toString();
        let start = 0;
        for (let i = 0; i < buf.length; i++) {
          if (buf[i] === "\n") {
            const line = buf.slice(start, i);
            start = i + 1;
            if (!line) continue;
            try {
              const env = JSON.parse(line);
              if (env.type === "hello") {
                sock.write(encodeEnvelope(json));
              } else if (env.type === "response") {
                sock.end();
                resolve(true);
              }
            } catch {}
          }
        }
        buf = buf.slice(start);
      });
      sock.on("end", () => resolve(true));
      sock.on("error", () => resolve(false));
      sock.setTimeout(3000, () => { sock.destroy(); resolve(false); });
    } catch { resolve(false); }
  });
}

function sendAndWaitResponse(json, timeoutMs = 300000) {
  return new Promise((resolve) => {
    try {
      const sock = connect({ path: SOCKET_PATH });
      let buf = "";
      sock.on("data", (chunk) => {
        buf += chunk.toString();
        let start = 0;
        for (let i = 0; i < buf.length; i++) {
          if (buf[i] === "\n") {
            const line = buf.slice(start, i);
            start = i + 1;
            if (!line) continue;
            try {
              const env = JSON.parse(line);
              if (env.type === "hello") {
                sock.write(encodeEnvelope(json));
              } else if (env.type === "response") {
                sock.end();
                resolve(env.response);
              }
            } catch {}
          }
        }
        buf = buf.slice(start);
      });
      sock.on("end", () => resolve(null));
      sock.on("error", () => resolve(null));
      sock.setTimeout(timeoutMs, () => { sock.destroy(); resolve(null); });
    } catch { resolve(null); }
  });
}

let detectedTty = null;
try {
  const { execSync } = require("child_process");
  let walkPid = process.pid;
  for (let i = 0; i < 8; i++) {
    const info = execSync("ps -o tty=,ppid= -p " + walkPid, { timeout: 1000 }).toString().trim();
    const parts = info.split(/\s+/);
    const tty = parts[0], ppid = parseInt(parts[1]);
    if (tty && tty !== "??" && tty !== "?") { detectedTty = "/dev/" + tty; break; }
    if (!ppid || ppid <= 1) break;
    walkPid = ppid;
  }
} catch {}

// ── 远程开发：注入主机标识，用于 BridgeServer 远程会话识别 ──
const _hostname = (() => { try { return require("os").hostname(); } catch { return undefined; } })();
const _username = (() => { try { return require("os").userInfo().username; } catch { return undefined; } })();
const _ipAddrs = (() => {
  try {
    const addrs = [];
    for (const ifaces of Object.values(require("os").networkInterfaces())) {
      if (!ifaces) continue;
      for (const iface of ifaces) {
        if (!iface.internal) addrs.push(iface.address);
      }
    }
    return addrs.length > 0 ? addrs : undefined;
  } catch { return undefined; }
})();
const _sshClient = (() => {
  const raw = process.env.SSH_CONNECTION;
  if (!raw) return undefined;
  const parts = raw.trim().split(/\s+/);
  if (parts.length >= 2) {
    const port = parseInt(parts[1], 10);
    if (parts[0] && Number.isFinite(port)) return { ip: parts[0], port };
  }
  return undefined;
})();

const ENV_KEYS = [
  "TERM_PROGRAM", "ITERM_SESSION_ID", "TERM_SESSION_ID",
  "TMUX", "TMUX_PANE", "KITTY_WINDOW_ID",
];

function isSaraBotManagedProcess() {
  return !!process.env.SARA_BOT_PLUGIN_EVENT_URL && !!process.env.SARA_BOT_PLUGIN_EVENT_TOKEN;
}

function recognizedTerminalApp(command) {
  const low = command.toLowerCase();
  if (low.includes("/sara.app/") || low.includes("/sara desktop.app/")) return "Sara";
  if (low.includes("/opencode.app/") || low.includes("/opencode desktop.app/")) return "OpenCode";
  if (low.includes("/claude.app/")) return "Claude";
  if (low.includes("/codex.app/") || low.includes("/codex desktop.app/")) return "Codex";
  if (low.includes("/cmux.app/contents/macos/cmux")) return "cmux";
  if (low.includes("/ghostty.app/contents/macos/ghostty") || low.endsWith("/ghostty")) return "Ghostty";
  if (low.includes("/terminal.app/contents/macos/terminal")) return "Terminal";
  if (low.includes("/iterm.app/contents/macos/iterm2")) return "iTerm";
  if (low.includes("/wezterm.app/contents/macos/wezterm-gui") || low.endsWith("/wezterm-gui")) return "WezTerm";
  if (low.includes("/warp.app/") || low.endsWith("/warp")) return "Warp";
  if (low.includes("/alacritty.app/") || low.endsWith("/alacritty")) return "Alacritty";
  if (low.includes("/kitty.app/") || low.endsWith("/kitty")) return "kitty";
  if (low.includes("/cursor.app/")) return "Cursor";
  if (low.includes("/windsurf.app/")) return "Windsurf";
  if (low.includes("/trae cn - alpha.app/")) return "Trae CN - Alpha";
  if (low.includes("/trae cn.app/")) return "Trae CN";
  if (low.includes("/trae.app/")) return "Trae";
  if (low.includes("/visual studio code - insiders.app/")) return "VS Code Insiders";
  if (low.includes("/visual studio code.app/") || low.includes("/code helper")) return "VS Code";
  if ((low.includes("/intellij idea") && low.includes(".app/")) || low.includes("/idea.app/")) return "IntelliJ IDEA";
  if (low.includes('/android studio') && low.includes('.app/')) return 'Android Studio';
  if (low.includes("/webstorm") && low.includes(".app/")) return "WebStorm";
  if (low.includes("/pycharm") && low.includes(".app/")) return "PyCharm";
  if (low.includes("/goland") && low.includes(".app/")) return "GoLand";
  if (low.includes("/clion") && low.includes(".app/")) return "CLion";
  if (low.includes("/rubymine") && low.includes(".app/")) return "RubyMine";
  if (low.includes("/phpstorm") && low.includes(".app/")) return "PhpStorm";
  if (low.includes("/rider") && low.includes(".app/")) return "Rider";
  if (low.includes("/rustrover") && low.includes(".app/")) return "RustRover";
  return undefined;
}

function detectTerminalAppFromProcessTree() {
  try {
    const { execSync } = require("child_process");
    const raw = execSync("/bin/ps -Ao pid=,ppid=,command=", { timeout: 500, stdio: ["pipe", "pipe", "pipe"] }).toString();
    const procs = new Map();
    for (const line of raw.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (m) procs.set(m[1], { ppid: m[2], command: m[3] });
    }
    let pid = String(process.ppid);
    const seen = new Set();
    while (pid && pid !== "0" && pid !== "1" && !seen.has(pid)) {
      seen.add(pid);
      const p = procs.get(pid);
      if (!p) break;
      const app = recognizedTerminalApp(p.command);
      if (app) return app;
      pid = p.ppid;
    }
  } catch {}
  return undefined;
}

const TERM_PROGRAM_CANONICAL = {
  apple_terminal: "Terminal",
  "iterm.app": "iTerm",
  warpterminal: "Warp",
};

function detectTerminalApp() {
  const env = process.env;
  if (env.CMUX_SURFACE_ID) return "cmux";
  if (env.VSCODE_IPC_HOOK_CLI || env.VSCODE_PID || env.VSCODE_CWD) {
    return detectTerminalAppFromProcessTree() || "VS Code";
  }
  if (env.TERMINAL_EMULATOR === "JetBrains-JediTerm") {
    return detectTerminalAppFromProcessTree() || "IntelliJ IDEA";
  }
  const term = env.TERM_PROGRAM;
  if (term === "vscode") return detectTerminalAppFromProcessTree() || "VS Code";
  if (term) return TERM_PROGRAM_CANONICAL[term.toLowerCase()] || term;
  return detectTerminalAppFromProcessTree() || "Sara";
}

function terminalFields() {
  const env = process.env;
  const app = detectTerminalApp();
  const result = { pid: process.pid };
  if (app) {
    result.terminal_app = app;
    const low = app.toLowerCase();
    if (low === "iterm" && env.ITERM_SESSION_ID) {
      result.terminal_session_id = env.ITERM_SESSION_ID;
    } else if (low === "ghostty" && env.TERM_SESSION_ID) {
      result.terminal_session_id = env.TERM_SESSION_ID;
    } else if (low === "cmux" && env.CMUX_SURFACE_ID) {
      result.terminal_session_id = env.CMUX_SURFACE_ID;
    } else if (low === "kitty" && env.KITTY_WINDOW_ID) {
      result.terminal_session_id = env.KITTY_WINDOW_ID;
    }
  }
  if (detectedTty) result.terminal_tty = detectedTty;
  return result;
}

function makePayload(hookEventName, sessionID, cwd, extra = {}) {
  const payload = {
    hook_event_name: hookEventName,
    session_id: "sara-" + sessionID,
    cwd: cwd || ".",
    ...terminalFields(),
    ...extra,
  };
  if (_hostname) payload._hostname = _hostname;
  if (_username) payload._username = _username;
  if (_ipAddrs) payload._ipAddrs = _ipAddrs;
  if (_sshClient) payload._sshClient = _sshClient;
  return {
    type: "processHook",
    source: "sara",
    payload,
  };
}

function extractSubagentFields(p) {
    return {
        ...(p.agent_id && { agent_id: p.agent_id }),
    };
}

const LIFECYCLE_EVENTS = new Set(["SessionStart", "SessionEnd"]);

export default async ({ client, serverUrl }) => {
  const serverPort = serverUrl ? parseInt(serverUrl.port) || 4096 : 4096;
  const internalFetch = client?._client?.getConfig?.()?.fetch || null;
  const msgRoles = new Map();
  const assistantMessageParts = new Map();
  const userMessageParts = new Map();
  const sessionCwd = new Map();
  const sessions = new Map();
  const pendingRequestSessions = new Set();
  const childSessions = new Set();
  let lastRootSessionID = "";

  function touchRootSessionID(sessionID) {
    if (typeof sessionID !== "string" || !sessionID) return;
    if (childSessions.has(sessionID)) return;
    lastRootSessionID = sessionID;
  }

  function getSession(sid) {
    if (!sessions.has(sid)) sessions.set(sid, { lastAssistantText: "", title: "" });
    return sessions.get(sid);
  }

  // sara 默认会用 "New session - <ISO 时间戳>" 作为占位 title（参见 sara session/index.ts），
  // 这种字符串透传到灵动岛会非常难看。这里把 placeholder 视为空，让 adapter 用 prompt 兜底。
  function normalizeTitle(raw) {
    if (typeof raw !== "string") return "";
    const t = raw.trim();
    if (!t) return "";
    if (t === "New session" || t.startsWith("New session - ")) return "";
    return t;
  }

  function cacheSessionTitleFromSessionEvent(type, props) {
    if (type !== "session.created" && type !== "session.updated") return "";
    const sid = typeof props?.sessionID === "string"
      ? props.sessionID
      : (typeof props?.info?.id === "string" ? props.info.id : "");
    if (!sid) return "";

    // Sara 源码中 session.created / session.updated 的 info 都是 Session.Info，
    // 标题字段就是 info.title（busSchema 见 sara/src/session/index.ts）。
    const title = normalizeTitle(props?.info?.title);
    if (!title) return "";
    getSession(sid).title = title;
    return title;
  }

  async function hydrateSessionTitleForUserPrompt(mapped) {
    if (mapped?.payload?.hook_event_name !== "UserPromptSubmit") return;
    if (mapped.payload.session_title) return;

    const prefixedSessionID = mapped.payload.session_id;
    const rawSessionID = typeof prefixedSessionID === "string" ? prefixedSessionID.replace(/^sara-/, "") : "";
    if (!rawSessionID) return;
    if (!client?.session?.get) return;

    try {
      const result = await client.session.get({ sessionID: rawSessionID }, { throwOnError: true });
      const info = result?.data ?? result;
      const title = normalizeTitle(info?.title);
      if (!title) return;
      mapped.payload.session_title = title;
      getSession(rawSessionID).title = title;
    } catch {}
  }

  function clearSessionMessageState(sessionID) {
    for (const [messageID, meta] of msgRoles) {
      if (meta.sessionID !== sessionID) continue;
      msgRoles.delete(messageID);
      assistantMessageParts.delete(messageID);
      userMessageParts.delete(messageID);
    }
  }

  let sessionEndSentBySignal = false;

  function emitSessionEndOnSignal(signal) {
    if (sessionEndSentBySignal) return;
    if (!lastRootSessionID) return;
    sessionEndSentBySignal = true;

    const sid = lastRootSessionID;
    const cwd = sessionCwd.get(sid);
    sessions.delete(sid);
    sessionCwd.delete(sid);
    clearSessionMessageState(sid);

    const mapped = makePayload("SessionEnd", sid, cwd, {
      _sara_exit_signal: signal,
    });

    void sendToSocket(mapped);
  }

  function upsertMessagePart(store, messageID, partID, text) {
    let parts = store.get(messageID);
    if (!parts) {
      parts = new Map();
      store.set(messageID, parts);
    }
    if (text) {
      parts.set(partID, text);
    } else {
      parts.delete(partID);
    }
    if (parts.size === 0) {
      store.delete(messageID);
      return "";
    }
    return Array.from(parts.values())
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join("\n");
  }

  async function postPermissionReply(requestId, directive) {
    if (!requestId) return;
    const permanent = directive?.type === "allow" && directive?.permanent === true;
    const reply = directive?.type === "allow"
      ? (permanent ? "always" : "once")
      : "reject";
    const message = directive?.type === "deny" ? directive?.reason : undefined;
    const url = "http://localhost:" + serverPort + "/permission/" + requestId + "/reply";
    const body = JSON.stringify({ reply, message });
    const opts = { method: "POST", headers: { "Content-Type": "application/json" }, body };
    try {
      if (internalFetch) {
        await internalFetch(new Request(url, opts));
        return;
      }
    } catch {}
    try { await fetch(url, opts); } catch {}
  }

  async function postQuestionReply(requestId, directive) {
    if (!requestId || directive?.type !== "answer") return;
    let answers;
    if (Array.isArray(directive.answers)) {
      answers = directive.answers.map((a) => Array.isArray(a) ? a : [String(a || "")]);
    } else if (typeof directive.text === "string") {
      answers = [[directive.text]];
    } else {
      return;
    }
    const url = "http://localhost:" + serverPort + "/question/" + requestId + "/reply";
    const body = JSON.stringify({ answers });
    const opts = { method: "POST", headers: { "Content-Type": "application/json" }, body };
    try {
      if (internalFetch) {
        await internalFetch(new Request(url, opts));
        return;
      }
    } catch {}
    try { await fetch(url, opts); } catch {}
  }

  function mapEvent(ev) {
    const t = ev.type;
    const p = ev.properties || {};
    const subagentFields = extractSubagentFields(p);

    // Sara 事件里 title 的权威来源是 session.created/session.updated 的 info.title。
    cacheSessionTitleFromSessionEvent(t, p);

    if (t === "message.part.updated" && p.part && p.part.type === "tool" && p.part.tool === "task") {
      const metadata = p.part.state?.metadata;
      if (metadata?.sessionId) {
        childSessions.add(metadata.sessionId);
      }
    }

    if (t === "session.created" && p.info && p.info.parentID) {
      childSessions.add(p.info.id);
    }

    if (p.sessionID && childSessions.has(p.sessionID)) {
      return null;
    }

    if (t === "session.created" && p.info) {
      if (childSessions.has(p.info.id)) {
        return null;
      }

      touchRootSessionID(p.info.id);

      const cwd = p.info.directory || "";
      sessionCwd.set(p.info.id, cwd);
      const extra = { ...subagentFields };
      const title = normalizeTitle(p.info.title || p.info.name);
      if (title) {
        extra.session_title = title;
        getSession(p.info.id).title = title;
      }
      return makePayload("SessionStart", p.info.id, cwd, extra);
    }

    if (t === "session.deleted" && p.info) {
      if (childSessions.has(p.info.id)) {
        childSessions.delete(p.info.id);
        return null;
      }
      sessions.delete(p.info.id);
      const cwd = sessionCwd.get(p.info.id);
      sessionCwd.delete(p.info.id);
      clearSessionMessageState(p.info.id);
      return makePayload("SessionEnd", p.info.id, cwd, { ...subagentFields });
    }

    if (t === "session.updated" && p.info) {
      if (childSessions.has(p.info.id)) {
        return null;
      }
      touchRootSessionID(p.info.id);
      if (p.info.directory) sessionCwd.set(p.info.id, p.info.directory);
      const title = normalizeTitle(p.info.title || p.info.name);
      if (title) getSession(p.info.id).title = title;

      if (p.info.time?.archived) {
        sessions.delete(p.info.id);
        const cwd = sessionCwd.get(p.info.id);
        sessionCwd.delete(p.info.id);
        clearSessionMessageState(p.info.id);
        return makePayload("SessionEnd", p.info.id, cwd, { ...subagentFields });
      }
      return null;
    }

    if (t === "session.closed" && p.sessionID) {
      if (childSessions.has(p.sessionID)) {
        return null;
      }
      touchRootSessionID(p.sessionID);
      sessions.delete(p.sessionID);
      const cwd = sessionCwd.get(p.sessionID);
      sessionCwd.delete(p.sessionID);
      clearSessionMessageState(p.sessionID);
      return makePayload("SessionEnd", p.sessionID, cwd, { ...subagentFields });
    }

    if (t === "session.status" && p.sessionID) {
      if (childSessions.has(p.sessionID)) {
        return null;
      }
      touchRootSessionID(p.sessionID);
      if (p.status?.type === "idle") {
        const s = getSession(p.sessionID);
        const extra = {
          last_assistant_message: s.lastAssistantText || undefined,
          ...subagentFields
        };
        if (s.title) extra.session_title = s.title;
        return makePayload("Stop", p.sessionID, sessionCwd.get(p.sessionID), extra);
      }
      return null;
    }

    if (t === "session.error" && p.sessionID) {
      if (childSessions.has(p.sessionID)) {
        return null;
      }
      touchRootSessionID(p.sessionID);
      // Ctrl-C 等中断场景在 Sara 侧通常会上报 AbortedError。
      // 这里直接映射 SessionEnd，让岛上会话及时消失。
      if (p.error?.name === "AbortedError") {
        sessions.delete(p.sessionID);
        const cwd = sessionCwd.get(p.sessionID);
        sessionCwd.delete(p.sessionID);
        clearSessionMessageState(p.sessionID);
        return makePayload("SessionEnd", p.sessionID, cwd, { ...subagentFields });
      }
      return null;
    }

    if (t === "session.error" && !p.sessionID) {
      if (p.error?.name === "AbortedError" && lastRootSessionID) {
        sessions.delete(lastRootSessionID);
        const cwd = sessionCwd.get(lastRootSessionID);
        sessionCwd.delete(lastRootSessionID);
        clearSessionMessageState(lastRootSessionID);
        return makePayload("SessionEnd", lastRootSessionID, cwd, { ...subagentFields });
      }
      return null;
    }

    if (t === "message.updated" && p.info?.id && p.info?.sessionID) {
      if (childSessions.has(p.info.sessionID)) {
        return null;
      }
      touchRootSessionID(p.info.sessionID);
      msgRoles.set(p.info.id, { role: p.info.role, sessionID: p.info.sessionID });
      if (msgRoles.size > 200) {
        const oldestMessageID = msgRoles.keys().next().value;
        msgRoles.delete(oldestMessageID);
        assistantMessageParts.delete(oldestMessageID);
        userMessageParts.delete(oldestMessageID);
      }
      return null;
    }

    if (t === "message.part.updated" && p.part?.type === "text" && p.part?.messageID) {
      const meta = msgRoles.get(p.part.messageID);
      if (!meta) return null;
      if (childSessions.has(meta.sessionID)) {
        return null;
      }
      touchRootSessionID(meta.sessionID);
      const text = p.part.text || "";
      if (meta.role === "user" && text) {
        if (p.part.synthetic === true || p.part.ignored === true) return null;
        const prompt = upsertMessagePart(
          userMessageParts,
          p.part.messageID,
          p.part.id || (p.part.messageID + ":text"),
          text,
        );
        if (!prompt) return null;
        const extra = { prompt, ...subagentFields };
        const title = getSession(meta.sessionID).title;
        if (title) extra.session_title = title;
        return makePayload("UserPromptSubmit", meta.sessionID, sessionCwd.get(meta.sessionID), extra);
      }
      if (meta.role === "assistant" && text) {
        const assistantText = upsertMessagePart(
          assistantMessageParts,
          p.part.messageID,
          p.part.id || (p.part.messageID + ":text"),
          text,
        );
        if (!assistantText) return null;
        getSession(meta.sessionID).lastAssistantText = assistantText;

        const extra = { assistant_message_preview: assistantText, ...subagentFields };
        const title = getSession(meta.sessionID).title;
        if (title) extra.session_title = title;

        return makePayload("AssistantMessageUpdate", meta.sessionID, sessionCwd.get(meta.sessionID), extra);
      }
      return null;
    }

    if (t === "message.part.updated" && p.part?.type === "tool" && p.part?.sessionID) {
      if (childSessions.has(p.part.sessionID)) {
        return null;
      }
      touchRootSessionID(p.part.sessionID);
      const st = p.part.state?.status;
      const cwd = sessionCwd.get(p.part.sessionID);
      const toolName = (p.part.tool || "").charAt(0).toUpperCase() + (p.part.tool || "").slice(1);
      if (st === "running" || st === "pending") {
        return makePayload("PreToolUse", p.part.sessionID, cwd, {
          tool_name: toolName,
          tool_input: typeof p.part.state?.input === "string"
            ? p.part.state.input
            : JSON.stringify(p.part.state?.input || {}).slice(0, 200),
          ...subagentFields
        });
      }
      if (st === "completed" || st === "error") {
        return makePayload("PostToolUse", p.part.sessionID, cwd, {
          tool_name: toolName,
          ...subagentFields
        });
      }
      return null;
    }

    if (t === "permission.asked" && p.id && p.sessionID) {
      if (childSessions.has(p.sessionID)) {
        return null;
      }
      const toolName = (p.permission || "").charAt(0).toUpperCase() + (p.permission || "").slice(1);
      const patterns = p.patterns || [];
      const toolInput = { patterns, metadata: p.metadata };
      if (p.permission === "bash" && patterns.length > 0) {
        toolInput.command = patterns.join(" && ");
      }
      if ((p.permission === "edit" || p.permission === "write") && patterns.length > 0) {
        toolInput.file_path = patterns[0];
      }
      return makePayload("PermissionRequest", p.sessionID, sessionCwd.get(p.sessionID), {
        tool_name: toolName,
        tool_input: JSON.stringify(toolInput).slice(0, 200),
        permission_id: p.id,
        permission_title: "Allow " + toolName,
        permission_description: patterns.length > 0
          ? ("Sara wants to run " + toolName + ": " + patterns[0])
          : ("Sara wants to run " + toolName),
        _sara_request_id: p.id,
        ...subagentFields
      });
    }

    if (t === "permission.replied" && p.sessionID) {
      if (childSessions.has(p.sessionID)) {
        return null;
      }
      return makePayload("PostToolUse", p.sessionID, sessionCwd.get(p.sessionID), { ...subagentFields });
    }

    if (t === "question.asked" && p.id && p.sessionID) {
      const rawQuestions = Array.isArray(p.questions) ? p.questions : [];
      const structured = rawQuestions.map((q) => ({
        question: q.question || "",
        header: q.header || "",
        options: (q.options || []).map((opt) => ({
          label: opt.label,
          description: opt.description,
        })),
        multiple: !!q.multiple,
      }));
      const flatText = rawQuestions.map((q) => q.question).filter(Boolean).join("; ")
        || "Sara has a question";
      return makePayload("QuestionAsked", p.sessionID, sessionCwd.get(p.sessionID), {
        question_id: p.id,
        question_text: flatText,
        tool_input: { questions: structured },
        _sara_request_id: p.id,
        ...subagentFields
      });
    }

    if ((t === "question.replied" || t === "question.rejected") && p.sessionID) {
      return makePayload("PostToolUse", p.sessionID, sessionCwd.get(p.sessionID), { ...subagentFields });
    }

    return null;
  }

  process.once("SIGINT", () => emitSessionEndOnSignal("SIGINT"));
  process.once("SIGTERM", () => emitSessionEndOnSignal("SIGTERM"));

  return {
    "event": async ({ event }) => {
      // sara-bot 托管的 Sara 进程不上岛：避免与 sara-bot 的交互链路双消费。
      if (isSaraBotManagedProcess()) return;

      let mapped = null;
      try {
        mapped = mapEvent(event);
        if (!mapped) return;

        await hydrateSessionTitleForUserPrompt(mapped);

        const hookName = mapped.payload.hook_event_name;
        const sid = mapped.payload.session_id;

        if (
          pendingRequestSessions.has(sid) &&
          !LIFECYCLE_EVENTS.has(hookName) &&
          hookName !== "PermissionRequest" &&
          hookName !== "QuestionAsked" &&
          hookName !== "PostToolUse"
        ) {
          return;
        }

        if (hookName === "PermissionRequest") {
          const requestId = mapped.payload._sara_request_id;
          pendingRequestSessions.add(sid);
          sendAndWaitResponse(mapped)
            .then(async (response) => {
              const directive = response?.directive;
              if (directive) await postPermissionReply(requestId, directive);
            })
            .finally(() => { pendingRequestSessions.delete(sid); })
            .catch(() => {});
          return;
        }

        if (hookName === "QuestionAsked") {
          const requestId = mapped.payload._sara_request_id;
          pendingRequestSessions.add(sid);
          sendAndWaitResponse(mapped)
            .then(async (response) => {
              const directive = response?.directive;
              if (directive) await postQuestionReply(requestId, directive);
            })
            .finally(() => { pendingRequestSessions.delete(sid); })
            .catch(() => {});
          return;
        }

        await sendToSocket(mapped);
      } catch {
      }
    },

    "shell.env": async (input, output) => {
      output.env.FLUX_ACTIVE = "1";
      for (const v of ENV_KEYS) {
        if (process.env[v]) output.env["_FLUX_" + v] = process.env[v];
      }
    },
  };
};
`;
}
async function readJson$6(filePath) {
  let raw;
  try {
    raw = await promises.readFile(filePath, "utf-8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
  try {
    return JSON.parse(stripJsonComments(raw));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse JSON(C) at ${filePath}: ${reason}`);
  }
}
async function writeJson$8(filePath, data) {
  await promises.mkdir(path.dirname(filePath), { recursive: true });
  await promises.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
function isSaraFluxPluginRef(ref) {
  return ref.includes(SARA_PLUGIN_FILENAME);
}
function mergeSaraPluginRef(config, homeDir) {
  const pluginRef = getSaraPluginRef(homeDir);
  const plugins = config.plugin ?? [];
  const filtered = plugins.filter((ref) => !isSaraFluxPluginRef(ref));
  filtered.push(pluginRef);
  const changed = plugins.length !== filtered.length || plugins.some((value, index) => value !== filtered[index]);
  config.plugin = filtered;
  return changed;
}
function stripSaraPluginRef(config) {
  if (!config.plugin) return false;
  const before = config.plugin.length;
  config.plugin = config.plugin.filter((ref) => !isSaraFluxPluginRef(ref));
  if (config.plugin.length === 0) delete config.plugin;
  return (config.plugin?.length ?? 0) !== before;
}
async function resolvePrimarySaraConfigPath(homeDir) {
  const candidates = getSaraConfigPathCandidates(homeDir);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}
async function installSaraHook(ctx) {
  const pluginPath = getSaraPluginInstallPath(ctx.homeDir);
  await promises.mkdir(path.dirname(pluginPath), { recursive: true });
  await promises.writeFile(pluginPath, ctx.pluginContent, "utf-8");
  const configPath = await resolvePrimarySaraConfigPath(ctx.homeDir);
  const configPaths = getSaraConfigPathCandidates(ctx.homeDir);
  const primaryConfig = await readJson$6(configPath) ?? {};
  mergeSaraPluginRef(primaryConfig, ctx.homeDir);
  await writeJson$8(configPath, primaryConfig);
  for (const candidate of configPaths) {
    if (candidate === configPath) continue;
    const secondary = await readJson$6(candidate);
    if (!secondary) continue;
    if (stripSaraPluginRef(secondary)) {
      await writeJson$8(candidate, secondary);
    }
  }
  return { configPath, pluginPath, configPaths };
}
async function uninstallSaraHook(homeDir, options) {
  for (const configPath of getSaraConfigPathCandidates(homeDir)) {
    const config = await readJson$6(configPath);
    if (!config) continue;
    if (stripSaraPluginRef(config)) {
      await writeJson$8(configPath, config);
    }
  }
  try {
    await promises.unlink(getSaraPluginInstallPath(homeDir));
  } catch (err) {
    if (err.code !== "ENOENT" && options?.strict) ;
  }
}
async function checkSaraHook(homeDir) {
  const issues = [];
  const pluginPath = getSaraPluginInstallPath(homeDir);
  const configPaths = getSaraConfigPathCandidates(homeDir);
  if (!fs.existsSync(pluginPath)) {
    issues.push(`Plugin file not found: ${pluginPath}`);
    return { pluginPath, configPaths, issues, installed: false };
  }
  try {
    const content = await promises.readFile(pluginPath, "utf-8");
    if (!content.includes(SARA_PLUGIN_VERSION_MARKER)) {
      issues.push(`Plugin outdated (expected ${SARA_PLUGIN_VERSION}); will reinstall`);
      return { pluginPath, configPaths, issues, installed: false };
    }
  } catch (err) {
    issues.push(`Cannot read plugin file: ${err instanceof Error ? err.message : String(err)}`);
    return { pluginPath, configPaths, issues, installed: false };
  }
  let foundAnyConfig = false;
  let referenced = false;
  for (const configPath of configPaths) {
    const config = await readJson$6(configPath);
    if (!config) continue;
    foundAnyConfig = true;
    if (config.plugin?.some(isSaraFluxPluginRef)) {
      referenced = true;
      break;
    }
  }
  if (!foundAnyConfig) {
    issues.push("No Sara config file found");
    return { pluginPath, configPaths, issues, installed: false };
  }
  if (!referenced) {
    issues.push("Flux plugin not registered in Sara config");
    return { pluginPath, configPaths, issues, installed: false };
  }
  return { pluginPath, configPaths, issues, installed: true };
}
function getManifestPath$5() {
  return path.join(os.homedir(), ".flux", "hooks", "sara-manifest.json");
}
async function readJson$5(filePath) {
  try {
    const raw = await promises.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function writeJson$7(filePath, data) {
  await promises.mkdir(path.dirname(filePath), { recursive: true });
  await promises.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
class SaraPluginManager {
  agentId = "sara";
  async install(_options) {
    const homeDir = os.homedir();
    const socketPath = path.join(homeDir, ".flux", "run", "bridge.sock");
    const pluginContent = buildSaraPluginContent(socketPath);
    const { configPath, pluginPath } = await installSaraHook({
      homeDir,
      pluginContent
    });
    const manifest = {
      configPath,
      pluginPath,
      installedAt: (/* @__PURE__ */ new Date()).toISOString(),
      pluginVersion: SARA_PLUGIN_VERSION
    };
    await writeJson$7(getManifestPath$5(), manifest);
  }
  async uninstall() {
    const homeDir = os.homedir();
    const manifestPath = getManifestPath$5();
    const manifest = await readJson$5(manifestPath);
    await uninstallSaraHook(homeDir);
    const pluginPath = manifest?.pluginPath ?? getSaraPluginInstallPath(homeDir);
    try {
      await promises.unlink(pluginPath);
    } catch {
    }
    try {
      await promises.unlink(manifestPath);
    } catch {
    }
  }
  async checkHealth() {
    const homeDir = os.homedir();
    const manifestPath = getManifestPath$5();
    const shared = await checkSaraHook(homeDir);
    const issues = [...shared.issues];
    if (!shared.installed) {
      return { agentId: "sara", installed: false, issues, manifestPath };
    }
    try {
      await promises.stat(manifestPath);
    } catch {
      issues.push("Manifest missing; install metadata unknown");
    }
    return {
      agentId: "sara",
      installed: issues.length === 0 && shared.installed,
      issues,
      manifestPath
    };
  }
}
const KIMI_EVENTS$1 = [
  { event: "UserPromptSubmit" },
  { event: "SessionStart" },
  { event: "SessionEnd" },
  { event: "Stop" },
  { event: "StopFailure" },
  { event: "SubagentStart" },
  { event: "SubagentStop" },
  { event: "PreToolUse", timeout: 600 },
  { event: "PostToolUse" },
  { event: "PostToolUseFailure" },
  { event: "PreCompact" },
  { event: "PostCompact" },
  { event: "Notification" }
];
function isFluxHookCommand$1(command) {
  return command.includes("flux-hooks") || command.includes("hooks-cli/index.");
}
function getKimiConfigPath(homeDir) {
  return path.join(homeDir, ".kimi", "config.toml");
}
async function installKimiHook(ctx, options) {
  const configPath = getKimiConfigPath(ctx.homeDir);
  let configStr = "";
  if (fs.existsSync(configPath)) {
    configStr = await promises.readFile(configPath, "utf-8");
  }
  let parsed = {};
  try {
    parsed = toml__namespace.parse(configStr);
  } catch (err) {
    if (configStr) {
      const backup = `${configPath}.backup.${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}`;
      try {
        await promises.writeFile(backup, configStr, "utf-8");
      } catch {
      }
    }
    parsed = {};
  }
  let hooks = Array.isArray(parsed.hooks) ? parsed.hooks : [];
  hooks = hooks.filter((hook) => {
    if (!hook?.command || typeof hook.command !== "string") return true;
    return !isFluxHookCommand$1(hook.command);
  });
  for (const event of KIMI_EVENTS$1) {
    const hookEntry = {
      event: event.event,
      command: ctx.hookCommand,
      ..."timeout" in event ? { timeout: event.timeout } : {}
    };
    hooks.push(hookEntry);
  }
  if (options?.isExtraHook) {
    if (options.extraEnabled && options.extraHooks) {
      hooks = hooks.filter((h) => !options.isExtraHook(h));
      hooks.push(...options.extraHooks);
    } else {
      hooks = hooks.filter((h) => !options.isExtraHook(h));
    }
  }
  parsed.hooks = hooks;
  await promises.mkdir(path.dirname(configPath), { recursive: true });
  await promises.writeFile(configPath, toml__namespace.stringify(parsed), "utf-8");
  return configPath;
}
async function uninstallKimiHook(homeDir, options) {
  const configPath = getKimiConfigPath(homeDir);
  if (!fs.existsSync(configPath)) return;
  let parsed;
  try {
    parsed = toml__namespace.parse(await promises.readFile(configPath, "utf-8"));
  } catch (err) {
    if (err.code === "ENOENT") return;
    if (options?.strict) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read Kimi config at ${configPath}: ${reason}`);
    }
    return;
  }
  if (!Array.isArray(parsed.hooks)) return;
  const filtered = parsed.hooks.filter((hook) => {
    if (options?.isExtraHook?.(hook)) return false;
    return !hook?.command || !isFluxHookCommand$1(hook.command);
  });
  if (filtered.length === parsed.hooks.length) return;
  if (filtered.length === 0) delete parsed.hooks;
  else parsed.hooks = filtered;
  await promises.writeFile(configPath, toml__namespace.stringify(parsed), "utf-8");
}
const KIMI_EVENTS = [
  { event: "UserPromptSubmit" },
  { event: "SessionStart" },
  { event: "SessionEnd" },
  { event: "Stop" },
  { event: "StopFailure" },
  { event: "SubagentStart" },
  { event: "SubagentStop" },
  { event: "PreToolUse", timeout: 600 },
  { event: "PostToolUse" },
  { event: "PostToolUseFailure" },
  { event: "PreCompact" },
  { event: "PostCompact" },
  { event: "Notification" }
];
function getHookBinaryPath$6() {
  const resourcesPath = process.resourcesPath ?? path.join(electron.app.getAppPath(), "resources");
  return path.resolve(resourcesPath, "bin", "flux-hooks");
}
function getConfigPath$2() {
  return getKimiConfigPath(os.homedir());
}
function buildCommand$4() {
  if (utils.is.dev) {
    return buildDevHooksCliCommand("kimi");
  }
  const bin = getHookBinaryPath$6();
  return wrapWithInstallCheck(
    process.execPath,
    `ELECTRON_RUN_AS_NODE=1 ${shellQuote(process.execPath)} ${shellQuote(bin)} --source kimi`
  );
}
function isFluxHook$1(cmd) {
  return cmd.includes("flux-hooks") || cmd.includes("hooks-cli/index.");
}
class KimiHookManager {
  agentId = "kimi";
  async install(options) {
    const configPath = getConfigPath$2();
    const command = buildCommand$4();
    await installKimiHook(
      {
        homeDir: os.homedir(),
        hookCommand: command
      },
      {
        extraHooks: [],
        isExtraHook: isKimiBitsEntry,
        extraEnabled: false
      }
    );
    log.info("[KimiHookManager] Installed hooks to %s", configPath);
  }
  async uninstall() {
    await uninstallKimiHook(os.homedir(), { isExtraHook: isKimiBitsEntry });
    log.info("[KimiHookManager] Uninstalled hooks from %s", getConfigPath$2());
  }
  async checkHealth() {
    const issues = [];
    const configPath = getConfigPath$2();
    const binaryPath = getHookBinaryPath$6();
    if (!utils.is.dev && !fs.existsSync(binaryPath)) {
      issues.push(`Hook binary not found: ${binaryPath}`);
    }
    if (!fs.existsSync(configPath)) {
      issues.push(`Kimi config not found: ${configPath}`);
      return { agentId: "kimi", installed: false, issues, manifestPath: configPath };
    }
    let parsed;
    try {
      const configStr = await promises.readFile(configPath, "utf-8");
      parsed = toml__namespace.parse(configStr);
    } catch {
      issues.push(`Failed to parse Kimi config: ${configPath}`);
      return { agentId: "kimi", installed: false, issues, manifestPath: configPath };
    }
    if (!Array.isArray(parsed.hooks)) {
      issues.push("No hooks section found in Kimi config");
      return { agentId: "kimi", installed: false, issues, manifestPath: configPath };
    }
    const command = buildCommand$4();
    const hooks = parsed.hooks;
    for (const ev of KIMI_EVENTS) {
      const matched = hooks.find((h) => h.event === ev.event && isFluxHook$1(h.command || ""));
      if (!matched) {
        issues.push(`Missing hook for event: ${ev.event}`);
      } else if (matched.command !== command) {
        issues.push(`Stale command for ${ev.event}: expected ${command}`);
      }
    }
    const installed = issues.length === 0;
    return {
      agentId: "kimi",
      installed,
      issues,
      manifestPath: configPath
    };
  }
}
const GEMINI_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "BeforeAgent",
  "AfterAgent",
  "BeforeTool",
  "AfterTool",
  "PreCompress",
  "Notification"
];
function getGeminiConfigPath(homeDir) {
  return path.join(homeDir, ".gemini", "settings.json");
}
async function readJson$4(filePath, strict = false) {
  try {
    const raw = await promises.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== "ENOENT" && strict) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read Gemini config at ${filePath}: ${reason}`);
    }
    return null;
  }
}
async function writeJson$6(filePath, data) {
  await promises.mkdir(path.dirname(filePath), { recursive: true });
  await promises.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
function isFluxGeminiHookEntry(entry) {
  return entry.type === "command" && (entry.command.includes("flux-hooks") || entry.command.includes("hooks-cli/index."));
}
function isFluxGeminiHookGroup(group) {
  return group.hooks.some(isFluxGeminiHookEntry);
}
async function installGeminiHook(ctx) {
  const configPath = getGeminiConfigPath(ctx.homeDir);
  const settings = await readJson$4(configPath) ?? {};
  const existingHooks = settings.hooks ?? {};
  for (const event of GEMINI_EVENTS) {
    const entry = { type: "command", command: ctx.hookCommand };
    const group = { matcher: "*", hooks: [entry] };
    const existing = existingHooks[event] ?? [];
    const filtered = existing.filter((g) => !isFluxGeminiHookGroup(g));
    existingHooks[event] = [...filtered, group];
  }
  settings.hooks = existingHooks;
  await writeJson$6(configPath, settings);
  return {
    configPath,
    installedEvents: [...GEMINI_EVENTS]
  };
}
async function uninstallGeminiHook(homeDir, options) {
  const configPath = getGeminiConfigPath(homeDir);
  const settings = await readJson$4(configPath, options?.strict);
  if (!settings?.hooks) {
    return { configPath, removed: false };
  }
  let removed = false;
  for (const event of GEMINI_EVENTS) {
    const groups = settings.hooks[event];
    if (!groups) continue;
    const filtered = groups.filter((g) => !isFluxGeminiHookGroup(g));
    if (filtered.length === 0) {
      delete settings.hooks[event];
    } else {
      settings.hooks[event] = filtered;
    }
    if (filtered.length !== groups.length) {
      removed = true;
    }
  }
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }
  await writeJson$6(configPath, settings);
  return { configPath, removed };
}
async function checkGeminiHook(ctx) {
  const configPath = getGeminiConfigPath(ctx.homeDir);
  const settings = await readJson$4(configPath);
  const issues = [];
  if (!settings?.hooks) {
    issues.push("No hooks section found in Gemini settings");
    return { configPath, issues };
  }
  for (const event of GEMINI_EVENTS) {
    const groups = settings.hooks[event];
    if (!groups || !groups.some(isFluxGeminiHookGroup)) {
      issues.push(`Missing hook for event: ${event}`);
      continue;
    }
    const fluxGroup = groups.find(isFluxGeminiHookGroup);
    const fluxEntry = fluxGroup?.hooks.find(isFluxGeminiHookEntry);
    if (fluxEntry && fluxEntry.command !== ctx.hookCommand) {
      issues.push(`Stale command for ${event}: expected ${ctx.hookCommand}`);
    }
  }
  return { configPath, issues };
}
async function readJson$3(filePath) {
  try {
    const raw = await promises.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function writeJson$5(filePath, data) {
  await promises.mkdir(path.dirname(filePath), { recursive: true });
  await promises.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
function getHookBinaryPath$5() {
  const resourcesPath = process.resourcesPath ?? path.join(electron.app.getAppPath(), "resources");
  return path.resolve(resourcesPath, "bin", "flux-hooks");
}
function getConfigPath$1() {
  return getGeminiConfigPath(os.homedir());
}
function getManifestDir$3() {
  return path.join(os.homedir(), ".flux", "hooks");
}
function getManifestPath$4() {
  return path.join(getManifestDir$3(), "gemini-manifest.json");
}
function buildCommand$3() {
  if (utils.is.dev) {
    return buildDevHooksCliCommand("gemini");
  }
  const bin = getHookBinaryPath$5();
  return wrapWithInstallCheck(
    process.execPath,
    `ELECTRON_RUN_AS_NODE=1 ${shellQuote(process.execPath)} ${shellQuote(bin)} --source gemini`
  );
}
class GeminiHookManager {
  agentId = "gemini";
  async install() {
    const configPath = getConfigPath$1();
    const command = buildCommand$3();
    log.info("[GeminiHookManager] writing settings to %s", configPath);
    const result = await installGeminiHook({
      homeDir: os.homedir(),
      hookCommand: command
    });
    const manifest = {
      configPath: result.configPath,
      events: result.installedEvents,
      installedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    log.info("[GeminiHookManager] writing manifest to %s", getManifestPath$4());
    await writeJson$5(getManifestPath$4(), manifest);
    log.info("[GeminiHookManager] install completed (%d events registered)", result.installedEvents.length);
  }
  async uninstall() {
    const manifestPath = getManifestPath$4();
    const manifest = await readJson$3(manifestPath);
    if (!manifest) return;
    await uninstallGeminiHook(os.homedir());
    try {
      await promises.unlink(manifestPath);
    } catch {
    }
  }
  async checkHealth() {
    const issues = [];
    const binaryPath = getHookBinaryPath$5();
    if (!utils.is.dev && !fs.existsSync(binaryPath)) {
      issues.push(`Hook binary not found: ${binaryPath}`);
    }
    const command = buildCommand$3();
    const health = await checkGeminiHook({
      homeDir: os.homedir(),
      hookCommand: command
    });
    issues.push(...health.issues);
    return {
      agentId: "gemini",
      installed: issues.length === 0,
      issues,
      manifestPath: getManifestPath$4()
    };
  }
}
const COPILOT_CLI_EVENTS = [
  "sessionStart",
  "sessionEnd",
  "userPromptSubmitted",
  "preToolUse",
  "postToolUse",
  "agentStop",
  "subagentStop",
  "errorOccurred"
];
const COPILOT_CLI_PRE_TOOL_USE_TIMEOUT_SEC = 86400;
function getCopilotCliConfigPath(homeDir) {
  return path.join(homeDir, ".copilot", "settings.json");
}
async function readJson$2(filePath, strict = false) {
  try {
    const raw = await promises.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== "ENOENT" && strict) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read Copilot CLI config at ${filePath}: ${reason}`);
    }
    return null;
  }
}
async function writeJson$4(filePath, data) {
  await promises.mkdir(path.dirname(filePath), { recursive: true });
  await promises.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
function buildCopilotCliHookCommand(ctx, event) {
  return `${ctx.hookCommand} --event ${event}`;
}
function isFluxCopilotCliHookEntry(entry) {
  return entry.bash?.includes("flux-hooks") || entry.bash?.includes("hooks-cli/index.");
}
function buildHooksConfig(ctx) {
  const hooks = {};
  for (const event of COPILOT_CLI_EVENTS) {
    hooks[event] = [{
      type: "command",
      bash: buildCopilotCliHookCommand(ctx, event),
      ...event === "preToolUse" ? { timeoutSec: COPILOT_CLI_PRE_TOOL_USE_TIMEOUT_SEC } : {}
    }];
  }
  return hooks;
}
async function installCopilotCliHook(ctx) {
  const configPath = getCopilotCliConfigPath(ctx.homeDir);
  const config = await readJson$2(configPath) ?? {};
  config.version = config.version ?? 1;
  const existingHooks = config.hooks ?? {};
  const fluxHooks = buildHooksConfig(ctx);
  for (const [event, entries] of Object.entries(fluxHooks)) {
    const current = existingHooks[event] ?? [];
    const filtered = current.filter((entry) => !isFluxCopilotCliHookEntry(entry));
    existingHooks[event] = [...filtered, ...entries];
  }
  config.hooks = existingHooks;
  await writeJson$4(configPath, config);
  return {
    configPath,
    installedEvents: [...COPILOT_CLI_EVENTS]
  };
}
async function uninstallCopilotCliHook(homeDir, options) {
  const configPath = getCopilotCliConfigPath(homeDir);
  const config = await readJson$2(configPath, options?.strict);
  if (!config?.hooks) {
    return { configPath, removed: false };
  }
  let removed = false;
  for (const event of COPILOT_CLI_EVENTS) {
    const entries = config.hooks[event];
    if (!entries) continue;
    const filtered = entries.filter((entry) => !isFluxCopilotCliHookEntry(entry));
    if (filtered.length === 0) {
      delete config.hooks[event];
    } else {
      config.hooks[event] = filtered;
    }
    if (filtered.length !== entries.length) {
      removed = true;
    }
  }
  if (Object.keys(config.hooks).length === 0) {
    delete config.hooks;
  }
  await writeJson$4(configPath, config);
  return { configPath, removed };
}
async function checkCopilotCliHook(ctx) {
  const configPath = getCopilotCliConfigPath(ctx.homeDir);
  const config = await readJson$2(configPath);
  const issues = [];
  if (!config?.hooks) {
    issues.push("No hooks section found in Copilot CLI config");
    return { configPath, issues };
  }
  for (const event of COPILOT_CLI_EVENTS) {
    const entries = config.hooks[event];
    if (!entries || !entries.some(isFluxCopilotCliHookEntry)) {
      issues.push(`Missing hook for event: ${event}`);
      continue;
    }
    const fluxEntry = entries.find(isFluxCopilotCliHookEntry);
    const expectedCommand = buildCopilotCliHookCommand(ctx, event);
    if (fluxEntry && fluxEntry.bash !== expectedCommand) {
      issues.push(`Stale command for ${event}: expected ${expectedCommand}`);
    } else if (event === "preToolUse" && fluxEntry?.timeoutSec !== COPILOT_CLI_PRE_TOOL_USE_TIMEOUT_SEC) {
      issues.push(
        `Stale timeout for ${event}: expected ${COPILOT_CLI_PRE_TOOL_USE_TIMEOUT_SEC}, got ${fluxEntry?.timeoutSec ?? "none"}`
      );
    }
  }
  return { configPath, issues };
}
function getHookBinaryPath$4() {
  const resourcesPath = process.resourcesPath ?? path.join(electron.app.getAppPath(), "resources");
  return path.resolve(resourcesPath, "bin", "flux-hooks");
}
function getManifestDir$2() {
  return path.join(os.homedir(), ".flux", "hooks");
}
function getManifestPath$3() {
  return path.join(getManifestDir$2(), "copilot-cli-manifest.json");
}
function buildBaseCommand() {
  if (utils.is.dev) {
    return buildDevHooksCliCommand("copilot-cli");
  }
  const bin = getHookBinaryPath$4();
  return wrapWithInstallCheck(
    process.execPath,
    `ELECTRON_RUN_AS_NODE=1 ${shellQuote(process.execPath)} ${shellQuote(bin)} --source copilot-cli`
  );
}
async function readJson$1(filePath) {
  try {
    const raw = await promises.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function writeJson$3(filePath, data) {
  await promises.mkdir(path.dirname(filePath), { recursive: true });
  await promises.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
class CopilotCliHookManager {
  agentId = "copilot-cli";
  async install(_options) {
    const result = await installCopilotCliHook({
      homeDir: os.homedir(),
      // 共享层负责按事件追加 --event，这里只提供公共前缀。
      hookCommand: buildBaseCommand()
    });
    const manifest = {
      configPath: result.configPath,
      events: result.installedEvents,
      installedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await writeJson$3(getManifestPath$3(), manifest);
  }
  async uninstall() {
    const manifestPath = getManifestPath$3();
    const manifest = await readJson$1(manifestPath);
    if (!manifest) return;
    await uninstallCopilotCliHook(os.homedir());
    try {
      await promises.unlink(manifestPath);
    } catch {
    }
  }
  async checkHealth() {
    const issues = [];
    const binaryPath = getHookBinaryPath$4();
    if (!utils.is.dev && !fs.existsSync(binaryPath)) {
      issues.push(`Hook binary not found: ${binaryPath}`);
    }
    const health = await checkCopilotCliHook({
      homeDir: os.homedir(),
      hookCommand: buildBaseCommand()
    });
    issues.push(...health.issues);
    return {
      agentId: "copilot-cli",
      installed: issues.length === 0,
      issues,
      manifestPath: getManifestPath$3()
    };
  }
}
module.exports = {
  OpenCodePluginManager,
  SaraPluginManager,
  KimiHookManager,
  GeminiHookManager,
  CopilotCliHookManager
};
