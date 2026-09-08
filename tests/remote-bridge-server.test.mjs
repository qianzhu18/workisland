import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";

const require = createRequire(import.meta.url);
const { RemoteBridgeServer } = require("../src/main/remote-bridge-server.cjs");
const { createPairingTokenManager } = require("../src/main/remote-protocol.cjs");
const { createRemoteHostStore } = require("../src/main/remote-host-store.cjs");

const UUID = "a1b2c3d4-e5f6-4a1b-8c2d-1234567890ab";

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), "workisland-remote-test-"));
  const store = createRemoteHostStore({ filePath: join(dir, "remote-hosts.json") });
  return { store, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** 行协议客户端：收到的每行 JSON 依次出队。 */
function makeClient(port) {
  const socket = connect({ port, host: "127.0.0.1" });
  let buffer = "";
  const queue = [];
  const pending = [];
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      if (pending.length > 0) pending.shift()(JSON.parse(line));
      else queue.push(JSON.parse(line));
    }
  });
  const nextLine = () => new Promise((resolve) => pending.push(resolve));
  const waitLine = async () => (queue.length > 0 ? queue.shift() : nextLine());
  const send = (obj) => socket.write(`${JSON.stringify(obj)}\n`);
  return { socket, waitLine, send, end: () => new Promise((r) => socket.end(r)) };
}

async function setupServer() {
  const { store, cleanup } = makeStore();
  const tokenManager = createPairingTokenManager();
  const server = new RemoteBridgeServer({ hostStore: store, tokenManager });
  const events = [];
  server.on("agentEvent", (event) => events.push(event));
  server.start(0);
  for (let i = 0; i < 50 && !server.port; i += 1) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(server.port > 0, "server must expose its bound port");
  return { server, port: server.port, events, store, tokenManager, cleanup, stop: () => server.stop() };
}

test("pair with valid token issues session key once (D2)", async () => {
  const ctx = await setupServer();
  try {
    const { token } = ctx.tokenManager.createToken();
    const client = makeClient(ctx.port);
    await client.waitLine(); // ready
    client.send({ type: "pair", hostId: UUID, displayName: "dev-box", token });
    const pairResult = await client.waitLine();
    assert.equal(pairResult.ok, true);
    assert.ok(pairResult.sessionKey.length >= 16);
    assert.equal(ctx.store.hostCount(), 1);
    await client.end();

    // 同一令牌第二次配对必须失败（一次性）
    const attacker = makeClient(ctx.port);
    await attacker.waitLine();
    attacker.send({ type: "pair", hostId: UUID, displayName: "dev-box", token });
    const second = await attacker.waitLine();
    assert.equal(second.ok, false, "token must be single-use");
    assert.equal(second.error, "TOKEN_INVALID");
    await attacker.end();
  } finally {
    ctx.stop();
    ctx.cleanup();
  }
});

test("pair with invalid token is rejected and never registers a host", async () => {
  const ctx = await setupServer();
  try {
    const client = makeClient(ctx.port);
    await client.waitLine();
    client.send({ type: "pair", hostId: UUID, displayName: "dev-box", token: "forged" });
    const result = await client.waitLine();
    assert.equal(result.ok, false);
    assert.equal(result.error, "TOKEN_INVALID");
    assert.equal(ctx.store.hostCount(), 0);
    await client.end();
  } finally {
    ctx.stop();
    ctx.cleanup();
  }
});

test("state events flow with host metadata and never carry content (D3)", async () => {
  const ctx = await setupServer();
  try {
    const { token } = ctx.tokenManager.createToken();
    const client = makeClient(ctx.port);
    await client.waitLine();
    client.send({ type: "pair", hostId: UUID, displayName: "dev-box", token });
    const { sessionKey } = await client.waitLine();

    client.send({
      type: "state",
      sessionKey,
      state: "running",
      sessionId: "sess-12345678",
      tool: "claude",
      prompt: "机密提示词",
      transcript_path: "/home/user/.claude/x.jsonl"
    });
    const ack = await client.waitLine();
    assert.equal(ack.ok, true);

    await new Promise((r) => setTimeout(r, 20));
    assert.equal(ctx.events.length, 1);
    const event = ctx.events[0];
    assert.equal(event.type, "sessionStarted");
    assert.equal(event.isRemote, true);
    assert.equal(event.remoteHostId, UUID);
    assert.equal(event.remoteHostName, "dev-box");
    assert.equal(event.sessionId, "sess-12345678");
    assert.equal(event.prompt, undefined, "content fields must be dropped at entry");
    assert.equal(event.transcript_path, undefined, "content fields must be dropped at entry");
    await client.end();
  } finally {
    ctx.stop();
    ctx.cleanup();
  }
});

test("state with unknown session key is rejected", async () => {
  const ctx = await setupServer();
  try {
    const client = makeClient(ctx.port);
    await client.waitLine();
    client.send({ type: "state", sessionKey: "nobody-issued-this-key-0001", state: "running", sessionId: "sess-12345678", tool: "claude" });
    const ack = await client.waitLine();
    assert.equal(ack.ok, false);
    assert.equal(ack.error, "HOST_UNKNOWN_OR_REVOKED");
    await client.end();
  } finally {
    ctx.stop();
    ctx.cleanup();
  }
});

test("revoked host key stops working immediately (D5)", async () => {
  const ctx = await setupServer();
  try {
    const { token } = ctx.tokenManager.createToken();
    const client = makeClient(ctx.port);
    await client.waitLine();
    client.send({ type: "pair", hostId: UUID, displayName: "dev-box", token });
    const { sessionKey } = await client.waitLine();

    client.send({ type: "state", sessionKey, state: "running", sessionId: "sess-12345678", tool: "claude" });
    assert.equal((await client.waitLine()).ok, true);

    // D5：撤销即拉黑当前会话密钥，并断开该主机现存连接。
    assert.equal(ctx.server.revokeHost(UUID), true);
    const fresh = makeClient(ctx.port);
    await fresh.waitLine();
    fresh.send({ type: "state", sessionKey, state: "completed", sessionId: "sess-12345678", tool: "claude" });
    const ack = await fresh.waitLine();
    assert.equal(ack.ok, false, "revoked key must fail");
    assert.equal(ack.error, "HOST_UNKNOWN_OR_REVOKED");
    await fresh.end();
  } finally {
    ctx.stop();
    ctx.cleanup();
  }
});

test("non-whitelisted state is rejected without emitting events", async () => {
  const ctx = await setupServer();
  try {
    const { token } = ctx.tokenManager.createToken();
    const client = makeClient(ctx.port);
    await client.waitLine();
    client.send({ type: "pair", hostId: UUID, displayName: "dev-box", token });
    const { sessionKey } = await client.waitLine();

    client.send({ type: "state", sessionKey, state: "attach", sessionId: "sess-12345678", tool: "claude" });
    const ack = await client.waitLine();
    assert.equal(ack.ok, false);
    assert.equal(ack.error, "STATE_NOT_ALLOWED");
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(ctx.events.length, 0, "observe-only：交互式诉求在入口被拒");
    await client.end();
  } finally {
    ctx.stop();
    ctx.cleanup();
  }
});

test("tunnel close emits disconnected completion, never fake running", async () => {
  const ctx = await setupServer();
  try {
    const { token } = ctx.tokenManager.createToken();
    const client = makeClient(ctx.port);
    await client.waitLine();
    client.send({ type: "pair", hostId: UUID, displayName: "dev-box", token });
    const { sessionKey } = await client.waitLine();

    client.send({ type: "state", sessionKey, state: "running", sessionId: "sess-12345678", tool: "claude" });
    await client.waitLine();
    client.socket.destroy();

    await new Promise((r) => setTimeout(r, 50));
    const close = ctx.events.find((e) => e.type === "sessionCompleted" && e.error === "remote-disconnected");
    assert.ok(close, "disconnect must complete the session with a disconnected marker");
    assert.equal(close.isSessionEnd, false);
    assert.equal(close.remoteHostName, "dev-box");
  } finally {
    ctx.stop();
    ctx.cleanup();
  }
});

test("reconnect from the same host supersedes the stale connection's disconnect events", async () => {
  const ctx = await setupServer();
  try {
    const first = makeClient(ctx.port);
    await first.waitLine();
    const { token } = ctx.tokenManager.createToken();
    first.send({ type: "pair", hostId: UUID, displayName: "dev-box", token });
    const { sessionKey } = await first.waitLine();
    first.send({ type: "state", sessionKey, state: "running", sessionId: "sess-12345678", tool: "claude" });
    await first.waitLine();

    // 同主机第二连接接管后，旧连接断开不应发断线收卡
    const second = makeClient(ctx.port);
    await second.waitLine();
    second.send({ type: "state", sessionKey, state: "running", sessionId: "sess-12345678", tool: "claude" });
    await second.waitLine();
    first.socket.destroy();

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(
      ctx.events.some((e) => e.error === "remote-disconnected"),
      false,
      "superseded connection must not emit disconnect events"
    );
    second.socket.destroy();
  } finally {
    ctx.stop();
    ctx.cleanup();
  }
});

test("sync() starts and stops the listener with settings (loopback only)", () => {
  const { store, cleanup } = makeStore();
  try {
    const server = new RemoteBridgeServer({ hostStore: store });
    let status = server.sync({ enabled: false });
    assert.equal(status.running, false);

    status = server.sync({ enabled: true, port: 20000 + Math.floor(Math.random() * 20000) });
    assert.equal(status.running, true);
    assert.ok(status.port > 0);

    status = server.sync({ enabled: false });
    assert.equal(status.running, false);
  } finally {
    cleanup();
  }
});
