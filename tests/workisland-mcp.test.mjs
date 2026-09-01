import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { decodeLines, encodeLine } = require("../src/main/bridge-protocol.cjs");
const packageJson = require("../package.json");
const serverPath = fileURLToPath(new URL("../src/island/workisland-mcp/index.mjs", import.meta.url));

function uniqueEndpoint(prefix) {
  const unique = `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return process.platform === "win32"
    ? `\\\\.\\pipe\\${unique}`
    : path.join(os.tmpdir(), `${unique}.sock`);
}

const EXPECTED_TOOLS = [
  "describe_settings",
  "focus_session",
  "get_product_state",
  "get_settings",
  "list_visible_sessions",
  "open_settings",
  "set_display_surface",
  "undo_settings_change",
  "update_settings"
];

async function createFakeWorkIsland(t) {
  const requests = [];
  const socketPath = uniqueEndpoint("workisland-mcp");
  const server = net.createServer((socket) => {
    socket.write(encodeLine({ type: "hello", hello: { protocolVersion: 1 } }));
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const decoded = decodeLines(buffer);
      buffer = decoded.remainder;
      for (const request of decoded.messages) {
        requests.push(request);
        socket.write(encodeLine({
          id: request.id,
          ok: true,
          result: { forwardedCommand: request.command, forwardedParams: request.params }
        }));
      }
    });
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { socketPath, requests };
}

async function connectClient(t, socketPath) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env, FLUX_SOCKET_PATH: socketPath, WORKISLAND_MCP_CLIENT: "Codex test" },
    stderr: "pipe"
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const client = new Client({ name: "workisland-mcp-test", version: "1.0.0" });
  await client.connect(transport);
  t.after(async () => client.close());
  return { client, getStderr: () => stderr };
}

test("package exposes the WorkIsland MCP stdio server", () => {
  assert.equal(packageJson.bin?.["workisland-mcp"], "src/island/workisland-mcp/index.mjs");
});

test("MCP lists the exact safe tool surface and forwards every tool", async (t) => {
  const fake = await createFakeWorkIsland(t);
  const { client, getStderr } = await connectClient(t, fake.socketPath);
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), EXPECTED_TOOLS);

  const cases = [
    ["describe_settings", {}, "control.describeSettings", {}],
    ["get_settings", { keys: ["mediaEnabled"] }, "control.getSettings", { keys: ["mediaEnabled"] }],
    ["update_settings", { changes: { mediaEnabled: false } }, "control.updateSettings", { changes: { mediaEnabled: false } }],
    ["undo_settings_change", { changeId: "change-public" }, "control.undoSettingsChange", { changeId: "change-public" }],
    ["get_product_state", {}, "control.getProductState", {}],
    ["list_visible_sessions", {}, "control.listVisibleSessions", {}],
    ["focus_session", { id: "session-public" }, "control.focusSession", { id: "session-public" }],
    ["open_settings", { section: "agent-control" }, "control.openSettings", { section: "agent-control" }],
    ["set_display_surface", { surface: "pet" }, "control.setDisplaySurface", { surface: "pet" }]
  ];
  for (const [name, args, command, params] of cases) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, { forwardedCommand: command, forwardedParams: params });
  }
  assert.equal(getStderr(), "");
  assert.equal(fake.requests.every((request) => request.client.name === "Codex test"), true);
});

test("MCP returns an actionable tool error when WorkIsland is unavailable", async (t) => {
  const missingSocket = uniqueEndpoint("workisland-mcp-missing");
  const { client } = await connectClient(t, missingSocket);
  const result = await client.callTool({ name: "get_product_state", arguments: {} });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /WORKISLAND_UNAVAILABLE/);
});

test("MCP input schemas reject arbitrary sections and oversized changes", async (t) => {
  const fake = await createFakeWorkIsland(t);
  const { client } = await connectClient(t, fake.socketPath);

  const badSection = await client.callTool({ name: "open_settings", arguments: { section: "https://example.com" } });
  assert.equal(badSection.isError, true);
  const tooMany = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`key-${index}`, true]));
  const badChanges = await client.callTool({ name: "update_settings", arguments: { changes: tooMany } });
  assert.equal(badChanges.isError, true);
  assert.equal(fake.requests.length, 0);
});
