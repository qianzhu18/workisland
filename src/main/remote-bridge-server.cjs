"use strict";

/**
 * PRD-016 T2/T3 远程接入 observe-only 入口（ADR-0005 D1–D7 第一阶段）。
 *
 * 边界约束：
 * - 仅监听 127.0.0.1（D1 loopback）；端口被占用时报可读错误，不静默换端口（风险 3）；
 * - 配对：一次性短时效令牌（D2）换取持久会话密钥，密钥只存哈希；
 * - D3 白名单在 remote-protocol.cjs 强制执行：状态事件之外的一切（含
 *   attach / 输入 / 内容回传）在本入口被拒收，不进入任何下游对象；
 * - 观察模式：只发 agentEvent，不发 hookDirective —— 远程审批、远程操作
 *   在第一阶段一律不开放（PRD-016 非目标 2）。
 */

const net = require("node:net");
const crypto = require("node:crypto");
const log = require("electron-log");
const { EventEmitter } = require("node:events");
const { encodeLine, decodeLines } = require("./bridge-protocol.cjs");
const {
  DEFAULT_REMOTE_PORT,
  MAX_PAIR_FAILURES,
  createPairingTokenManager,
  validatePairRequest,
  validateStateEnvelope,
  mapStateToAgentEvents,
  buildDisconnectedEvents
} = require("./remote-protocol.cjs");
const { createRemoteHostStore } = require("./remote-host-store.cjs");

class RemoteBridgeServer extends EventEmitter {
  server = null;
  port = null;
  lastError = null;
  connections = /* @__PURE__ */ new Map();
  hostStore;
  tokenManager;

  constructor({ hostStore, tokenManager } = {}) {
    super();
    this.hostStore = hostStore ?? createRemoteHostStore();
    this.tokenManager = tokenManager ?? createPairingTokenManager();
  }

  /** 按设置启停（对齐 developer-api 的 sync 生命周期模式）。 */
  sync(remoteAccess = {}) {
    const wantRunning = remoteAccess?.enabled === true;
    if (!wantRunning) {
      this.stop();
      return this.getStatus();
    }
    const port = Number(remoteAccess.port) > 0 ? Number(remoteAccess.port) : DEFAULT_REMOTE_PORT;
    if (this.server && this.port === port) return this.getStatus();
    this.stop();
    this.start(port);
    return this.getStatus();
  }

  start(port = DEFAULT_REMOTE_PORT) {
    if (this.server) return;
    const server = net.createServer((socket) => this.handleConnection(socket));
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        // ADR-0005 风险 3：端口冲突必须可读，禁止静默换端口。
        this.lastError = "PORT_IN_USE";
        this.server = null;
        this.port = null;
        log.error("[RemoteBridge]", `监听失败：127.0.0.1:${port} 已被占用。请释放该端口或在设置中更换远程接入端口。`);
      } else {
        this.lastError = "LISTEN_ERROR";
        log.error("[RemoteBridge] server error:", err.message);
      }
    });
    server.listen(port, "127.0.0.1", () => {
      this.lastError = null;
      // port=0（测试临时端口）时回填系统分配的真实端口。
      this.port = server.address()?.port ?? port;
      log.info("[RemoteBridge]", `observe-only 入口已就绪：127.0.0.1:${this.port}`);
    });
    this.server = server;
    this.port = port;
  }

  stop() {
    for (const conn of this.connections.values()) {
      try {
        conn.socket.destroy();
      } catch {
        // socket 已关闭时的销毁失败可以忽略
      }
    }
    this.connections.clear();
    if (this.server) {
      try {
        this.server.close();
      } catch (err) {
        log.warn("[RemoteBridge] close failed:", err?.message ?? String(err));
      }
      this.server = null;
      this.port = null;
    }
  }

  getStatus() {
    return {
      running: !!this.server,
      port: this.port,
      lastError: this.lastError,
      connectedHosts: this.hostStore ? Array.from(new Set(Array.from(this.connections.values(), (c) => c.hostId).filter(Boolean))) : []
    };
  }

  listHosts() {
    return this.hostStore.listHosts();
  }

  hostCount() {
    return this.hostStore.hostCount();
  }

  createPairingToken() {
    return this.tokenManager.createToken();
  }

  revokeHost(hostId) {
    const changed = this.hostStore.revokeHost(hostId);
    if (changed) {
      // 撤销即断开该主机现存连接（D5）：旧会话密钥随记录删除而失效。
      for (const conn of this.connections.values()) {
        if (conn.hostId === hostId) {
          try {
            conn.socket.destroy();
          } catch {
            // 忽略销毁失败
          }
        }
      }
    }
    return changed;
  }

  handleConnection(socket) {
    const connId = crypto.randomUUID();
    const conn = {
      id: connId,
      socket,
      buffer: Buffer.alloc(0),
      hostId: null,
      hostName: null,
      // sessionId → tool，断线时用于收卡
      sessions: /* @__PURE__ */ new Map(),
      pairFailures: 0
    };
    this.connections.set(connId, conn);
    // 欢迎行：让远程脚本连接后立刻能确认到达的是 WorkIsland observe-only 入口。
    this.writeLine(conn, { type: "ready", protocolVersion: 1, observeOnly: true });
    socket.on("data", (chunk) => {
      conn.buffer = Buffer.concat([conn.buffer, chunk]);
      const { messages, remainder, errors } = decodeLines(conn.buffer);
      conn.buffer = remainder;
      for (const error of errors) {
        this.writeLine(conn, { type: "ack", ok: false, error: error.code });
      }
      for (const msg of messages) {
        this.handleLine(conn, msg);
      }
    });
    const finish = () => {
      this.connections.delete(connId);
      if (conn.hostId && conn.sessions.size > 0) {
        for (const event of buildDisconnectedEvents({
          sessions: conn.sessions,
          hostId: conn.hostId,
          hostName: conn.hostName ?? "远程主机"
        })) {
          this.emit("agentEvent", event);
        }
      }
    };
    socket.on("close", finish);
    socket.on("error", finish);
  }

  handleLine(conn, msg) {
    if (msg?.type === "pair") {
      this.handlePair(conn, msg);
      return;
    }
    if (msg?.type === "state") {
      this.handleState(conn, msg);
      return;
    }
    this.writeLine(conn, { type: "ack", ok: false, error: "UNKNOWN_TYPE" });
  }

  handlePair(conn, msg) {
    if (!this.tokenManager.consume(msg.token)) {
      conn.pairFailures += 1;
      this.writeLine(conn, { type: "pairResult", ok: false, error: "TOKEN_INVALID" });
      if (conn.pairFailures >= MAX_PAIR_FAILURES) {
        conn.socket.destroy();
      }
      return;
    }
    const pair = validatePairRequest(msg);
    if (!pair.ok) {
      this.writeLine(conn, { type: "pairResult", ok: false, error: pair.reason });
      return;
    }
    const sessionKey = crypto.randomBytes(32).toString("base64url");
    const host = this.hostStore.upsertHost(pair.hostId, pair.displayName, sessionKey);
    conn.hostId = host.hostId;
    conn.hostName = host.displayName;
    log.info("[RemoteBridge]", `主机已配对：${host.displayName} (${host.hostId})`);
    this.writeLine(conn, { type: "pairResult", ok: true, sessionKey, hostId: host.hostId, displayName: host.displayName });
  }

  handleState(conn, msg) {
    const envelope = validateStateEnvelope(msg);
    if (!envelope.ok) {
      this.writeLine(conn, { type: "ack", ok: false, error: envelope.reason });
      return;
    }
    const host = this.hostStore.findBySessionKey(envelope.sessionKey);
    if (!host) {
      this.writeLine(conn, { type: "ack", ok: false, error: "HOST_UNKNOWN_OR_REVOKED" });
      return;
    }
    // 同主机重连接管：旧连接不再持有该主机的会话，断开时不发误报收卡。
    for (const other of this.connections.values()) {
      if (other !== conn && other.hostId === host.hostId && other.sessions.size > 0) {
        other.sessions.clear();
      }
    }
    conn.hostId = host.hostId;
    conn.hostName = host.displayName;
    if (envelope.state === "stale" || envelope.state === "completed" || envelope.state === "failed") {
      conn.sessions.delete(envelope.sessionId);
    } else {
      conn.sessions.set(envelope.sessionId, envelope.tool);
    }
    for (const event of mapStateToAgentEvents({
      state: envelope.state,
      sessionId: envelope.sessionId,
      tool: envelope.tool,
      timestamp: Date.now(),
      hostId: host.hostId,
      hostName: host.displayName
    })) {
      this.emit("agentEvent", event);
    }
    this.writeLine(conn, { type: "ack", ok: true });
  }

  writeLine(conn, payload) {
    try {
      conn.socket.write(encodeLine(payload));
    } catch (err) {
      log.warn("[RemoteBridge] write failed:", err?.message ?? String(err));
    }
  }
}

module.exports = { RemoteBridgeServer };
