import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildSshArgs, createRemoteTunnelManager } = require("../src/main/remote-tunnel-manager.cjs");

test("buildSshArgs forwards remote loopback to the local observe-only port", () => {
  const args = buildSshArgs({ sshTarget: "cn-tx", remoteForwardPort: 17878, localPort: 7878 });
  assert.deepEqual(args, [
    "-N",
    "-R", "17878:127.0.0.1:7878",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "cn-tx"
  ]);
});

test("tunnel manager restarts on exit with backoff and stops cleanly", async () => {
  const spawned = [];
  let onExit = null;
  function fakeSpawn(binary, args) {
    assert.equal(binary, "ssh");
    const child = {
      pid: spawned.length + 1,
      stderr: { on() {} },
      on(event, handler) { if (event === "exit") onExit = handler; },
      kill() { onExit?.(0); }
    };
    spawned.push({ args });
    return child;
  }
  const manager = createRemoteTunnelManager({ spawnProcess: fakeSpawn, getLocalPort: () => 7878 });
  assert.equal(manager.startTunnel({ hostId: "h1", sshTarget: "cn-tx" }), true);
  assert.equal(spawned.length, 1);
  assert.equal(manager.status().h1.running, true);

  // 首次断开 → 自动重拉
  onExit?.(255);
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(spawned.length, 2, "must relaunch after exit");
  assert.equal(manager.status().h1.restarts, 1);

  // 手动停止后不再重拉
  assert.equal(manager.stopTunnel("h1"), true);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(manager.hasTunnel("h1"), false);
  assert.equal(manager.status().h1, undefined);
});

test("startTunnel is idempotent while a tunnel is already running", () => {
  const children = [];
  function fakeSpawn(_binary, _args) {
    const child = { pid: children.length + 1, stderr: { on() {} }, on() {}, kill() {} };
    children.push(child);
    return child;
  }
  const manager = createRemoteTunnelManager({ spawnProcess: fakeSpawn });
  assert.equal(manager.startTunnel({ hostId: "h1", sshTarget: "a" }), true);
  assert.equal(manager.startTunnel({ hostId: "h1", sshTarget: "a" }), true);
  assert.equal(children.length, 1);
  manager.stopAll();
});
