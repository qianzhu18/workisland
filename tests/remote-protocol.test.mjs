import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  REMOTE_STATES,
  createPairingTokenManager,
  validatePairRequest,
  validateStateEnvelope,
  mapStateToAgentEvents,
  buildDisconnectedEvents
} = require("../src/main/remote-protocol.cjs");

test("pairing token is single-use (D2)", () => {
  const manager = createPairingTokenManager();
  const { token } = manager.createToken();
  assert.equal(manager.consume(token).ok, true, "first consume must succeed");
  assert.equal(manager.consume(token).ok, false, "second consume must fail — 一次性");
});

test("pairing token expires after TTL (D2)", () => {
  let clock = 1_000_000;
  const manager = createPairingTokenManager({ now: () => clock });
  const { token } = manager.createToken();
  clock += 10 * 60 * 1000 + 1;
  assert.equal(manager.consume(token).ok, false, "expired token must be rejected");
});

test("pairing token unknown value is rejected", () => {
  const manager = createPairingTokenManager();
  assert.equal(manager.consume("").ok, false);
  assert.equal(manager.consume("forged-token").ok, false);
  assert.equal(manager.consume(undefined).ok, false);
});

test("pairing token carries invite meta through consume", () => {
  const manager = createPairingTokenManager();
  const { token } = manager.createToken({ inviteHostId: "h-uuid-1234" });
  const consumed = manager.consume(token);
  assert.equal(consumed.ok, true);
  assert.equal(consumed.meta.inviteHostId, "h-uuid-1234");
});

test("validatePairRequest accepts UUID hostId and sanitizes displayName", () => {
  const pair = validatePairRequest({
    hostId: "a1b2c3d4-e5f6-4a1b-8c2d-1234567890ab",
    displayName: "  dev-box\n\u0007  "
  });
  assert.equal(pair.ok, true);
  assert.equal(pair.hostId, "a1b2c3d4-e5f6-4a1b-8c2d-1234567890ab");
  assert.equal(pair.displayName, "dev-box");
  assert.ok(pair.displayName.length <= 64);
});

test("validatePairRequest rejects non-UUID hostId and falls back display name", () => {
  assert.equal(validatePairRequest({ hostId: "not-a-uuid" }).ok, false);
  assert.equal(validatePairRequest({ hostId: 42 }).ok, false);
  const fallback = validatePairRequest({ hostId: "a1b2c3d4-e5f6-4a1b-8c2d-1234567890ab" });
  assert.equal(fallback.ok, true);
  assert.equal(fallback.displayName, "远程主机");
});

test("D3 whitelist: envelope with content fields only yields the four allowed fields", () => {
  const envelope = validateStateEnvelope({
    sessionKey: "k".repeat(32),
    state: "running",
    sessionId: "sess-12345678",
    tool: "claude",
    // 攻击性/内容字段：即使出现也绝不能进入返回对象
    prompt: "内部机密提示词",
    transcript: "==========",
    cwd: "/home/user/secret-project",
    apiKey: "sk-xxx"
  });
  assert.equal(envelope.ok, true);
  assert.deepEqual(Object.keys(envelope).sort(), ["ok", "sessionId", "sessionKey", "state", "tool"]);
  assert.equal(envelope.prompt, undefined);
  assert.equal(envelope.transcript, undefined);
  assert.equal(envelope.cwd, undefined);
  assert.equal(envelope.apiKey, undefined);
});

test("D3 whitelist: interactive / unknown states are rejected", () => {
  for (const state of REMOTE_STATES) {
    assert.equal(validateStateEnvelope({ sessionKey: "k".repeat(32), state, sessionId: "sess-12345678", tool: "claude" }).ok, true, state);
  }
  for (const state of ["attach", "input", "read_screen", "exec", "running; drop table"]) {
    assert.equal(validateStateEnvelope({ sessionKey: "k".repeat(32), state, sessionId: "sess-12345678", tool: "claude" }).ok, false, state);
  }
});

test("validateStateEnvelope rejects malformed ids and tools", () => {
  const base = { sessionKey: "k".repeat(32), state: "running" };
  assert.equal(validateStateEnvelope({ ...base, sessionId: "short", tool: "claude" }).ok, false);
  assert.equal(validateStateEnvelope({ ...base, sessionId: "has 空格 inside!", tool: "claude" }).ok, false);
  assert.equal(validateStateEnvelope({ ...base, sessionId: "sess-12345678", tool: "Bad Tool" }).ok, false);
  assert.equal(validateStateEnvelope({ ...base, sessionId: "sess-12345678", tool: "claude", sessionKey: "tiny" }).ok, false);
});

test("mapStateToAgentEvents produces fixed content-free shapes", () => {
  const args = { sessionId: "sess-12345678", tool: "claude", timestamp: 1000, hostId: "h-uuid", hostName: "dev-box" };
  const [running] = mapStateToAgentEvents({ state: "running", ...args });
  assert.equal(running.type, "sessionStarted");
  assert.equal(running.isRemote, true);
  assert.equal(running.remoteHostName, "dev-box");
  assert.equal(running.title, "claude · 345678");
  assert.equal(running.latestUserPrompt, undefined);

  const [approval] = mapStateToAgentEvents({ state: "approval_requested", ...args });
  assert.equal(approval.type, "permissionRequested");
  assert.deepEqual(Object.keys(approval.permissionRequest), ["toolName"], "observe-only：不带审批内容");

  const [completed] = mapStateToAgentEvents({ state: "completed", ...args });
  assert.equal(completed.type, "sessionCompleted");
  assert.equal(completed.isSessionEnd, false);
  assert.equal(completed.summary, "远程任务完成");

  const [failed] = mapStateToAgentEvents({ state: "failed", ...args });
  assert.equal(failed.type, "sessionCompleted");
  assert.equal(failed.error, "remote-failed");

  const [stale] = mapStateToAgentEvents({ state: "stale", ...args });
  assert.equal(stale.type, "sessionCompleted");
  assert.equal(stale.isSessionEnd, true);

  // 所有远程事件都不允许携带内容型字段
  for (const event of [running, approval, completed, failed, stale]) {
    for (const forbidden of ["latestUserPrompt", "lastAssistantMessage", "currentActivity", "transcriptPath", "cwd"]) {
      assert.equal(event[forbidden], undefined, `${event.type} must not carry ${forbidden}`);
    }
  }
});

test("buildDisconnectedEvents marks every tracked session without fake running", () => {
  const sessions = new Map([["sess-12345678", "claude"], ["sess-aaaaaaaa", "codex"]]);
  const events = buildDisconnectedEvents({ sessions, hostId: "h-uuid", hostName: "dev-box", timestamp: 42 });
  assert.equal(events.length, 2);
  for (const event of events) {
    assert.equal(event.type, "sessionCompleted");
    assert.equal(event.isRemote, true);
    assert.equal(event.isSessionEnd, false);
    assert.equal(event.error, "remote-disconnected");
    assert.equal(event.summary, "远程连接已断开");
  }
});
