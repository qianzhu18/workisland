import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { AlmaApprovalBridge, normalizeApprovalRequest, sessionIdFor, mapResolution } = require("../src/main/alma-approvals.cjs");
const { resolveApprovalMode, normalizeApprovalModes, approvalModesFor } = require("../src/shared/approval-policy.cjs");

/** Minimal fake of Alma's /api/handoff/tool-approvals endpoint. */
function createFakeAlma({ requests = [], onPost } = {}) {
  return async function request({ method, url, body }) {
    if (method === "GET" && url.endsWith("/api/handoff/tool-approvals")) {
      return { statusCode: 200, body: requests.map((r) => ({ ...r })) };
    }
    if (method === "POST" && url.endsWith("/api/handoff/tool-approvals")) {
      if (typeof onPost === "function") onPost(body);
      return { statusCode: 200, body: { ok: true } };
    }
    return { statusCode: 404, body: null };
  };
}

const SAMPLE = {
  requestId: "req-1",
  source: "bash",
  title: "Run command",
  message: "npm test",
  confirmLabel: "允许",
  cancelLabel: "拒绝",
  type: "warning",
  threadId: "thread-9",
  metadata: { command: "npm test" }
};

function makeBridge(overrides = {}) {
  const events = [];
  const bridge = new AlmaApprovalBridge({
    request: overrides.request || createFakeAlma(overrides.alma || {}),
    getConfig: overrides.getConfig || (() => ({ enabled: true, mode: "bridge" })),
    pollIntervalMs: 1e4,
    ...overrides.options
  });
  bridge.on("event", (event) => events.push(event));
  return { bridge, events };
}

test("Alma handoff approval normalizes into an Island permission card", () => {
  const approval = normalizeApprovalRequest(SAMPLE);
  assert.equal(approval.requestId, "req-1");
  assert.equal(approval.threadId, "thread-9");
  assert.equal(approval.toolName, "Bash");
  assert.equal(approval.toolInput, "npm test");
  assert.equal(approval.riskLevel, "high");
  assert.equal(sessionIdFor(approval), "thread-9");
  const orphan = normalizeApprovalRequest({ requestId: "req-2", source: "mcp" });
  assert.equal(sessionIdFor(orphan), "alma-approval:req-2");
  assert.equal(orphan.toolName, "mcp");
  assert.equal(orphan.riskLevel, "medium");
});

test("poll surfaces new pending requests and resolves vanishings", async () => {
  const { bridge, events } = makeBridge({ alma: { requests: [SAMPLE] } });
  await bridge.poll();
  const requested = events.find((e) => e.type === "permissionRequested");
  assert.ok(requested, "expected permissionRequested");
  assert.equal(requested.tool, "alma");
  assert.equal(requested.sessionId, "thread-9");
  assert.equal(requested.permissionRequest.id, "req-1");
  assert.equal(requested.permissionRequest.approvalMode, "bridge");
  assert.equal(requested.permissionRequest.provider, "alma");

  // Same request again must not double-fire.
  await bridge.poll();
  assert.equal(events.filter((e) => e.type === "permissionRequested").length, 1);

  // Request answered inside Alma (or timed out) -> card clears.
  const { bridge: gone, events: goneEvents } = makeBridge({
    alma: {
      requests: [],
      onPost(body) {
        assert.fail("vanishing request must not POST");
      }
    }
  });
  await gone.poll();
  assert.equal(goneEvents.length, 0);
});

test("Island resolution POSTs the mapped action back to Alma", async () => {
  const posts = [];
  const { bridge, events } = makeBridge({
    alma: { requests: [SAMPLE], onPost: (body) => posts.push(body) }
  });
  await bridge.poll();
  assert.equal(await bridge.resolveById("req-1", "allowOnce"), true);
  assert.deepEqual(posts, [{ requestId: "req-1", response: { action: "allow_once" } }]);
  const resolved = events.find((e) => e.type === "permissionResolved");
  assert.ok(resolved, "expected permissionResolved");
  assert.equal(resolved.sessionId, "thread-9");

  // A second resolve on an id Alma no longer reports must not re-POST:
  // resolveById refuses ids that vanished from the pending list.
  assert.equal(await bridge.resolveById("req-1", "allowOnce"), false);
  assert.equal(posts.length, 1);
});

test("trust mode answers allow_always without surfacing a card", async () => {
  const posts = [];
  const { bridge, events } = makeBridge({
    alma: { requests: [SAMPLE], onPost: (body) => posts.push(body) },
    getConfig: () => ({ enabled: true, mode: "trust" })
  });
  await bridge.poll();
  assert.deepEqual(posts, [{ requestId: "req-1", response: { action: "allow_always" } }]);
  assert.equal(events.filter((e) => e.type === "permissionRequested").length, 0);
});

test("native mode and disabled toggle never poll", async () => {
  for (const config of [{ enabled: true, mode: "native" }, { enabled: false, mode: "bridge" }]) {
    let fetched = 0;
    const request = async ({ method }) => {
      if (method === "GET") fetched += 1;
      return { statusCode: 200, body: [SAMPLE] };
    };
    const { bridge, events } = makeBridge({ options: { request, getConfig: () => config } });
    await bridge.poll();
    bridge.sync();
    await bridge.poll();
    assert.equal(fetched, 0, `expected no GET for ${JSON.stringify(config)}`);
    assert.equal(events.length, 0);
  }
});

test("mode changes resync: bridge -> trust answers later requests", async () => {
  let mode = "bridge";
  const posts = [];
  const { bridge, events } = makeBridge({
    alma: { requests: [], onPost: (body) => posts.push(body) },
    getConfig: () => ({ enabled: true, mode })
  });
  await bridge.poll();
  assert.equal(events.length, 0);
  mode = "trust";
  bridge.sync();
  const { bridge: bridge2 } = { bridge };
  void bridge2;
  // Fake Alma now reports a pending request; poll answers it automatically.
  const responder = async ({ method, body }) => {
    if (method === "GET") return { statusCode: 200, body: [SAMPLE] };
    posts.push(body);
    return { statusCode: 200, body: { ok: true } };
  };
  bridge.request = responder;
  await bridge.poll();
  assert.deepEqual(posts, [{ requestId: "req-1", response: { action: "allow_always" } }]);
});

test("approval-policy gives Alma island/trust/native modes", () => {
  assert.deepEqual(approvalModesFor("alma"), ["bridge", "trust", "native"]);
  assert.deepEqual(approvalModesFor("codex"), ["bridge", "terminalNative"]);
  assert.equal(resolveApprovalMode({}, "alma"), "bridge");
  assert.equal(resolveApprovalMode({ approvalModes: { alma: "native" } }, "alma"), "native");
  assert.equal(resolveApprovalMode({ approvalModes: { alma: "terminalNative" } }, "alma"), "bridge");
  assert.equal(normalizeApprovalModes({ alma: "trust" }).alma, "trust");
});

test("mapResolution covers allowOnce/allowAlways/deny with reason", () => {
  assert.deepEqual(mapResolution("allowOnce"), { action: "allow_once" });
  assert.deepEqual(mapResolution("allowAlways"), { action: "allow_always" });
  assert.deepEqual(mapResolution("deny"), { action: "deny" });
  assert.deepEqual(mapResolution("deny", "跑不了"), { action: "deny_with_reason", reason: "跑不了" });
  assert.equal(mapResolution("unknown"), null);
});
