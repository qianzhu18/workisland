"use strict";

/**
 * PRD-016 T2 远程接入协议（第一阶段 observe-only，ADR-0005 D1–D7）。
 *
 * 纯函数模块，不依赖 electron / net —— 全部规则在这里单测覆盖：
 * - D2 配对令牌：一次性、短时效（10 分钟），换取持久会话密钥；
 * - D3 事件白名单：入口只读取 sessionKey / state / sessionId / tool 四个字段，
 *   其余字段（prompt/transcript/路径等）即使出现在报文中也不进入下游对象；
 * - 状态 → agentEvent 映射只产出固定、无内容的摘要文案，不透传远程内容。
 */

const crypto = require("node:crypto");

const DEFAULT_REMOTE_PORT = 7878;
const PAIRING_TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_PAIR_FAILURES = 5;

// D3：仅接受这五种状态事件。交互式（attach / 输入 / 内容回传）一律不在此列。
const REMOTE_STATES = Object.freeze(["running", "completed", "failed", "approval_requested", "stale"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const TOOL_RE = /^[a-z][a-z0-9-]{1,23}$/;

/**
 * 配对令牌管理器（D2）。令牌只存在于内存，从不持久化；
 * consume 一次即销毁，无论成功与否。
 */
function createPairingTokenManager({ now = Date.now, ttlMs = PAIRING_TOKEN_TTL_MS } = {}) {
  const tokens = /* @__PURE__ */ new Map();
  return {
    createToken() {
      for (const [token, expiresAt] of tokens) {
        if (expiresAt <= now()) tokens.delete(token);
      }
      const token = crypto.randomBytes(24).toString("base64url");
      const expiresAt = now() + ttlMs;
      tokens.set(token, expiresAt);
      return { token, expiresAt, ttlMs };
    },
    consume(token) {
      if (typeof token !== "string" || token.length === 0) return false;
      const expiresAt = tokens.get(token);
      if (expiresAt === undefined) return false;
      tokens.delete(token);
      return expiresAt > now();
    },
    get pendingCount() {
      return tokens.size;
    }
  };
}

/** 校验配对请求（hostId 必须是 UUID，显示名去控制字符并限长）。 */
function validatePairRequest(msg) {
  const hostId = typeof msg?.hostId === "string" ? msg.hostId.trim() : "";
  if (!UUID_RE.test(hostId)) return { ok: false, reason: "HOST_ID_INVALID" };
  let displayName = typeof msg?.displayName === "string" ? msg.displayName.trim() : "";
  displayName = displayName.replace(/[\u0000-\u001f]/g, "").slice(0, 64);
  if (!displayName) displayName = "远程主机";
  return { ok: true, hostId, displayName };
}

/**
 * D3 白名单校验与字段抽取。返回对象只含四个白名单字段——
 * 这是「入口丢弃内容字段」的物理实现：下游拿不到没被读出来的东西。
 */
function validateStateEnvelope(msg) {
  const sessionKey = typeof msg?.sessionKey === "string" ? msg.sessionKey : "";
  if (sessionKey.length < 16 || sessionKey.length > 128) {
    return { ok: false, reason: "SESSION_KEY_INVALID" };
  }
  const state = msg?.state;
  if (!REMOTE_STATES.includes(state)) {
    return { ok: false, reason: "STATE_NOT_ALLOWED" };
  }
  const sessionId = typeof msg?.sessionId === "string" ? msg.sessionId : "";
  if (!SESSION_ID_RE.test(sessionId)) {
    return { ok: false, reason: "SESSION_ID_INVALID" };
  }
  const tool = typeof msg?.tool === "string" ? msg.tool : "";
  if (!TOOL_RE.test(tool)) {
    return { ok: false, reason: "TOOL_INVALID" };
  }
  return { ok: true, sessionKey, state, sessionId, tool };
}

function shortSessionCode(sessionId) {
  return sessionId.slice(-6);
}

/**
 * 远程状态 → 本地 agentEvent 映射。只产出固定形状、无远程内容的事件：
 * 标题用 tool + sessionId 短码合成，摘要文案固定，不含远程发来的任何文本。
 */
function mapStateToAgentEvents({ state, sessionId, tool, timestamp, hostId, hostName }) {
  const base = {
    sessionId,
    tool,
    timestamp,
    isRemote: true,
    remoteHostId: hostId,
    remoteHostName: hostName
  };
  switch (state) {
    case "running":
      return [{ ...base, type: "sessionStarted", title: `${tool} · ${shortSessionCode(sessionId)}` }];
    case "approval_requested":
      return [{
        ...base,
        type: "permissionRequested",
        title: `${tool} · ${shortSessionCode(sessionId)}`,
        // observe-only：不携带工具参数等审批内容；远程会话不走审批卡，仅展示等待状态。
        permissionRequest: { toolName: "remote" }
      }];
    case "completed":
      return [{
        ...base,
        type: "sessionCompleted",
        title: `${tool} · ${shortSessionCode(sessionId)}`,
        isSessionEnd: false,
        summary: "远程任务完成"
      }];
    case "failed":
      return [{
        ...base,
        type: "sessionCompleted",
        title: `${tool} · ${shortSessionCode(sessionId)}`,
        isSessionEnd: false,
        error: "remote-failed",
        summary: "远程任务失败"
      }];
    case "stale":
      return [{
        ...base,
        type: "sessionCompleted",
        isSessionEnd: true
      }];
    default:
      return [];
  }
}

/** 隧道断开时对该连接内的活跃会话发出的收卡事件（ADR-0005 风险 2 / 附注 3）。 */
function buildDisconnectedEvents({ sessions, hostId, hostName, timestamp = Date.now() }) {
  const events = [];
  for (const [sessionId, tool] of sessions) {
    events.push({
      type: "sessionCompleted",
      sessionId,
      tool,
      timestamp,
      isRemote: true,
      remoteHostId: hostId,
      remoteHostName: hostName,
      isSessionEnd: false,
      error: "remote-disconnected",
      summary: "远程连接已断开"
    });
  }
  return events;
}

module.exports = {
  DEFAULT_REMOTE_PORT,
  PAIRING_TOKEN_TTL_MS,
  MAX_PAIR_FAILURES,
  REMOTE_STATES,
  createPairingTokenManager,
  validatePairRequest,
  validateStateEnvelope,
  mapStateToAgentEvents,
  buildDisconnectedEvents
};
