import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { MediaService } = require("../src/main/media-service.cjs");

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { writes: [], write(value) { this.writes.push(value); }, end() {} };
  child.kill = () => { child.killed = true; };
  return child;
}

test("media service parses chunked JSON Lines and sends allowlisted commands", () => {
  const child = fakeChild();
  const service = new MediaService({ spawnChild: () => child, helperPath: "/tmp/media-bridge" });
  service.start();
  child.stdout.emit("data", Buffer.from('{"kind":"state","state":{"active":true,"title":"Song"'));
  child.stdout.emit("data", Buffer.from('}}\nnot json\n'));
  assert.equal(service.getSnapshot().title, "Song");
  assert.equal(service.sendCommand({ command: "next" }), true);
  assert.equal(service.sendCommand({ command: "deleteEverything" }), false);
  assert.match(child.stdin.writes[0], /"command":"next"/);
  service.stop();
  assert.equal(child.killed, true);
});

test("disabled media service does not spawn", () => {
  let spawns = 0;
  const service = new MediaService({ spawnChild: () => { spawns += 1; return fakeChild(); }, helperPath: "/tmp/media-bridge" });
  service.setEnabled(false);
  service.start();
  assert.equal(spawns, 0);
  service.setEnabled(true);
  assert.equal(spawns, 1);
});
