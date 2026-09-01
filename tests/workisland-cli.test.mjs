import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";

const require = createRequire(import.meta.url);
const {
  EXIT_OK,
  EXIT_USAGE,
  EXIT_BRIDGE_ERROR,
  EXIT_VALIDATION,
  parseArgs,
  buildBridgeCommand,
  resolveSocketPath,
  readManual,
  sendBridgeCommand
} = require("../src/island/workisland-cli/index.cjs");

// ── 参数解析 ─────────────────────────────────────────────────────────────────

test("parseArgs maps every documented subcommand", () => {
  assert.equal(parseArgs(["node", "cli"]).action, "usage");
  assert.deepEqual(parseArgs(["node", "cli", "appearance", "get"]), { action: "appearance-get", socketPath: undefined });
  assert.deepEqual(parseArgs(["node", "cli", "appearance", "reset"]), { action: "appearance-reset", socketPath: undefined });
  assert.deepEqual(parseArgs(["node", "cli", "pet", "list"]), { action: "pet-list", socketPath: undefined });
  assert.deepEqual(parseArgs(["node", "cli", "pet", "set", "my-pet.webp"]), {
    action: "pet-set", sprite: "my-pet.webp", socketPath: undefined
  });
  assert.deepEqual(parseArgs(["node", "cli", "pet", "install", "/tmp/a.webp", "--name", "a", "--no-select"]), {
    action: "pet-install", sourcePath: "/tmp/a.webp", name: "a", select: false, socketPath: undefined
  });
  assert.deepEqual(parseArgs(["node", "cli", "validate", "/tmp/a.webp"]), {
    action: "validate", sourcePath: "/tmp/a.webp", socketPath: undefined
  });
  assert.equal(parseArgs(["node", "cli", "manual"]).action, "manual");
  const withSocket = parseArgs(["node", "cli", "appearance", "get", "--socket", "/tmp/x.sock"]);
  assert.equal(withSocket.socketPath, "/tmp/x.sock");
});

test("parseArgs rejects missing required operands as usage errors", () => {
  assert.equal(parseArgs(["node", "cli", "pet", "set"]).action, "usage");
  assert.equal(parseArgs(["node", "cli", "pet", "install"]).action, "usage");
  assert.equal(parseArgs(["node", "cli", "validate"]).action, "usage");
});

// ── 命令构造 ─────────────────────────────────────────────────────────────────

test("buildBridgeCommand turns flags into protocol frames", async () => {
  assert.deepEqual(await buildBridgeCommand({ action: "appearance-get" }), { type: "getAppearance" });
  assert.deepEqual(await buildBridgeCommand({ action: "appearance-reset" }), { type: "resetAppearance" });
  const set = await buildBridgeCommand({
    action: "appearance-set",
    jsonArg: '{"kind":"solid","color":"#0B1E3A"}',
    imageArg: "/tmp/bg.png"
  });
  assert.deepEqual(set, {
    type: "setAppearance",
    appearance: { kind: "solid", color: "#0B1E3A" },
    imageSource: { sourcePath: "/tmp/bg.png" }
  });
  const pet = await buildBridgeCommand({ action: "pet-install", sourcePath: "/tmp/a.webp", name: "a", select: true });
  assert.deepEqual(pet, { type: "installPet", sourcePath: "/tmp/a.webp", name: "a", select: true });
  await assert.rejects(
    () => buildBridgeCommand({ action: "appearance-set", jsonArg: "{oops" }),
    /JSON 解析失败/
  );
});

test("buildBridgeCommand reads theme JSON from a file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wi-cli-"));
  try {
    const themePath = join(dir, "theme.json");
    writeFileSync(themePath, JSON.stringify({ kind: "gradient", color: "#1F1330", color2: "#0B0716" }));
    const command = await buildBridgeCommand({ action: "appearance-set", fileArg: themePath });
    assert.equal(command.appearance.kind, "gradient");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── socket 与手册 ────────────────────────────────────────────────────────────

test("resolveSocketPath honors override, env, then default", () => {
  assert.equal(resolveSocketPath("/tmp/one.sock"), "/tmp/one.sock");
  process.env.FLUX_SOCKET_PATH = "/tmp/env.sock";
  assert.equal(resolveSocketPath(undefined), "/tmp/env.sock");
  delete process.env.FLUX_SOCKET_PATH;
  assert.equal(resolveSocketPath(undefined).endsWith(join(".flux", "run", "bridge.sock")), true);
});

test("readManual prefers WORKISLAND_MANUAL_PATH and falls back to embedded text", () => {
  const dir = mkdtempSync(join(tmpdir(), "wi-manual-"));
  try {
    const manualPath = join(dir, "manual.md");
    writeFileSync(manualPath, "# Custom Manual");
    process.env.WORKISLAND_MANUAL_PATH = manualPath;
    assert.equal(readManual(), "# Custom Manual");
    process.env.WORKISLAND_MANUAL_PATH = join(dir, "missing.md");
    const fallback = readManual();
    assert.ok(fallback.includes("appearance set"));
    assert.ok(fallback.includes("1536x2288") || fallback.includes("1536×2288"));
  } finally {
    delete process.env.WORKISLAND_MANUAL_PATH;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sendBridgeCommand completes the hello → command → response round trip", async () => {
  const socketPath = join(tmpdir(), `wi-cli-test-${process.pid}.sock`);
  const server = net.createServer((socket) => {
    socket.write(`${JSON.stringify({ type: "hello", hello: { protocolVersion: 1, serverLabel: "test" } })}\n`);
    socket.on("data", (chunk) => {
      for (const line of chunk.toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.type === "command") {
          socket.write(`${JSON.stringify({
            type: "response",
            response: { type: "result", data: { echo: message.command.type } }
          })}\n`);
        }
      }
    });
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  try {
    const response = await sendBridgeCommand(socketPath, { type: "getAppearance" });
    assert.deepEqual(response, { type: "result", data: { echo: "getAppearance" } });
  } finally {
    server.close();
    rmSync(socketPath, { force: true });
  }
});

test("sendBridgeCommand times out when the bridge never answers", async () => {
  const socketPath = join(tmpdir(), `wi-cli-silent-${process.pid}.sock`);
  // Greets but never answers commands.
  const server = net.createServer((socket) => {
    socket.write(`${JSON.stringify({ type: "hello", hello: { protocolVersion: 1 } })}\n`);
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  try {
    await assert.rejects(
      () => sendBridgeCommand(socketPath, { type: "getAppearance" }, 300),
      /超时/
    );
  } finally {
    server.close();
    rmSync(socketPath, { force: true });
  }
});

test("exit codes are distinct and documented", () => {
  assert.notEqual(EXIT_OK, EXIT_USAGE);
  assert.notEqual(EXIT_USAGE, EXIT_BRIDGE_ERROR);
  assert.notEqual(EXIT_BRIDGE_ERROR, EXIT_VALIDATION);
});
