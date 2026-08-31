import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  MAX_FRAME_BYTES,
  decodeLines,
  encodeLine,
  ensureSocketDir,
  getSocketDir
} = require("../src/main/bridge-protocol.cjs");
const { requestLocalControl } = require("../src/island/local-control-client.cjs");

test("line protocol decodes request ids and preserves a partial frame", () => {
  const first = encodeLine({ type: "control", id: "request-1", command: "control.getSettings", params: {} });
  const second = Buffer.from('{"type":"control","id":"request-2"', "utf8");
  const decoded = decodeLines(Buffer.concat([first, second]));

  assert.deepEqual(decoded.messages, [{ type: "control", id: "request-1", command: "control.getSettings", params: {} }]);
  assert.equal(decoded.remainder.toString("utf8"), second.toString("utf8"));
  assert.deepEqual(decoded.errors, []);
});

test("line protocol reports malformed and oversized frames without accepting them", () => {
  const malformed = decodeLines(Buffer.from("not-json\n"));
  assert.equal(malformed.messages.length, 0);
  assert.deepEqual(malformed.errors, [{ code: "MALFORMED_FRAME" }]);

  const oversized = decodeLines(Buffer.concat([Buffer.alloc(MAX_FRAME_BYTES + 1, 97), Buffer.from("\n") ]));
  assert.equal(oversized.messages.length, 0);
  assert.deepEqual(oversized.errors, [{ code: "FRAME_TOO_LARGE" }]);
});

test("socket directory is private to the current user", { skip: process.platform === "win32" }, () => {
  const home = path.join(os.tmpdir(), `workisland-socket-${process.pid}-${Date.now()}`);
  ensureSocketDir(home, "darwin");
  const mode = require("node:fs").statSync(getSocketDir(home)).mode & 0o777;
  assert.equal(mode, 0o700);
});

test("local control client matches response ids and ignores bridge hello", async (t) => {
  const unique = `workisland-client-${process.pid}-${Date.now()}`;
  const socketPath = process.platform === "win32"
    ? `\\\\.\\pipe\\${unique}`
    : path.join(os.tmpdir(), `${unique}.sock`);
  const server = net.createServer((socket) => {
    socket.write(encodeLine({ type: "hello", hello: { protocolVersion: 1 } }));
    socket.once("data", (chunk) => {
      const request = decodeLines(chunk).messages[0];
      socket.write(encodeLine({ id: "someone-else", ok: true, result: { ignored: true } }));
      socket.write(encodeLine({ id: request.id, ok: true, result: { enabled: true } }));
    });
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  t.after(() => server.close());

  const result = await requestLocalControl("control.getProductState", {}, {
    socketPath,
    client: { name: "test" },
    connectTimeoutMs: 500,
    responseTimeoutMs: 500,
    randomId: () => "request-expected"
  });
  assert.deepEqual(result, { enabled: true });
});

test("local control client returns stable unavailable and timeout errors", async () => {
  const unique = `does-not-exist-${process.pid}`;
  await assert.rejects(
    requestLocalControl("control.getSettings", {}, {
      socketPath: process.platform === "win32"
        ? `\\\\.\\pipe\\${unique}`
        : path.join(os.tmpdir(), `${unique}.sock`),
      connectTimeoutMs: 50,
      responseTimeoutMs: 50
    }),
    (error) => error.code === "WORKISLAND_UNAVAILABLE"
  );
});
