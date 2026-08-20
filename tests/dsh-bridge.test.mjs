import assert from "node:assert/strict";
import { test } from "node:test";

const bridge = await import("../resources/dsh-workisland-bridge/index.mjs");

test("DSH bridge claims approval only when WorkIsland returns a decision", async () => {
  const listeners = new Map();
  const ctx = { on: (name, listener) => listeners.set(name, listener) };
  bridge.apply(ctx, { requestApproval: async () => "allowed-once" });
  const listener = listeners.get("approval/request");
  assert.equal(typeof listener, "function");
  const outcome = await listener({
    agent: { id: "dsh-session", session: { header: { cwd: "/tmp/project" } } },
    toolName: "bash",
    reason: "Needs approval"
  }, () => Promise.resolve("unavailable"));
  assert.equal(outcome, "allowed-once");
});

test("DSH bridge falls through to the native UI when WorkIsland is unavailable", async () => {
  const listeners = new Map();
  const ctx = { on: (name, listener) => listeners.set(name, listener) };
  bridge.apply(ctx, { requestApproval: async () => null });
  const outcome = await listeners.get("approval/request")({
    agent: { id: "dsh-session", session: { header: { cwd: "/tmp/project" } } },
    toolName: "bash"
  }, () => Promise.resolve("native-ui"));
  assert.equal(outcome, "native-ui");
});
