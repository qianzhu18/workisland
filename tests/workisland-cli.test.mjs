import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createRequire } from "node:module";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const { decodeLines, encodeLine } = require("../src/main/bridge-protocol.cjs");
const packageJson = require("../package.json");
const cliPath = new URL("../src/island/workisland-cli/index.cjs", import.meta.url).pathname;

async function withFakeWorkIsland(run) {
  const requests = [];
  const socketPath = path.join(os.tmpdir(), `workisland-cli-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sock`);
  const server = net.createServer((socket) => {
    socket.write(encodeLine({ type: "hello", hello: { protocolVersion: 1 } }));
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const decoded = decodeLines(buffer);
      buffer = decoded.remainder;
      for (const request of decoded.messages) {
        requests.push(request);
        socket.write(encodeLine({ id: request.id, ok: true, result: { command: request.command, params: request.params } }));
      }
    });
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  try {
    return await run({ socketPath, requests });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function invoke(args, socketPath) {
  return execFileAsync(process.execPath, [cliPath, ...args], {
    env: { ...process.env, FLUX_SOCKET_PATH: socketPath }
  });
}

test("package exposes the WorkIsland automation CLI", () => {
  assert.equal(packageJson.bin?.workisland, "src/island/workisland-cli/index.cjs");
});

test("settings commands map to structured local control requests", async () => {
  await withFakeWorkIsland(async ({ socketPath, requests }) => {
    const cases = [
      { args: ["settings", "list"], command: "control.describeSettings", params: {} },
      { args: ["settings", "get", "sound.volume"], command: "control.getSettings", params: { keys: ["sound.volume"] } },
      { args: ["settings", "set", "sound.volume", "42"], command: "control.updateSettings", params: { changes: { "sound.volume": 42 } } },
      { args: ["settings", "set", "islandDisplayMode", "minimal"], command: "control.updateSettings", params: { changes: { islandDisplayMode: "minimal" } } },
      { args: ["settings", "undo", "change-123"], command: "control.undoSettingsChange", params: { changeId: "change-123" } },
      { args: ["settings", "open", "agent-control"], command: "control.openSettings", params: { section: "agent-control" } }
    ];
    for (const expected of cases) {
      const { stdout, stderr } = await invoke(expected.args, socketPath);
      assert.equal(stderr, "");
      assert.deepEqual(JSON.parse(stdout), { command: expected.command, params: expected.params });
    }
    assert.deepEqual(requests.map(({ command, params }) => ({ command, params })), cases.map(({ command, params }) => ({ command, params })));
  });
});

test("session surface and state commands are allowlisted", async () => {
  await withFakeWorkIsland(async ({ socketPath }) => {
    const cases = [
      [["sessions", "list"], "control.listVisibleSessions", {}],
      [["session", "focus", "session-public"], "control.focusSession", { id: "session-public" }],
      [["surface", "set", "pet"], "control.setDisplaySurface", { surface: "pet" }],
      [["state"], "control.getProductState", {}],
      [["activity"], "control.getRecentActivity", {}]
    ];
    for (const [args, command, params] of cases) {
      const { stdout } = await invoke(args, socketPath);
      assert.deepEqual(JSON.parse(stdout), { command, params });
    }
  });
});

test("usage errors exit 2 and never contact WorkIsland", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [cliPath, "session", "delete", "secret"], { env: process.env }),
    (error) => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /Usage:/);
      assert.equal(error.stdout, "");
      return true;
    }
  );
});

test("WorkIsland errors exit 1 as JSON with a stable code", async () => {
  const missing = path.join(os.tmpdir(), `workisland-cli-missing-${process.pid}.sock`);
  await assert.rejects(
    invoke(["state"], missing),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(JSON.parse(error.stderr).error.code, "WORKISLAND_UNAVAILABLE");
      assert.equal(error.stdout, "");
      return true;
    }
  );
});
