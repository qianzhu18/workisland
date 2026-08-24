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

test("media service parses MediaRemote Adapter JSON Lines and sends allowlisted commands", () => {
  const child = fakeChild();
  const spawns = [];
  const commands = [];
  const service = new MediaService({
    spawnChild: (...args) => { spawns.push(args); return child; },
    execute: (...args) => { commands.push(args); },
    resourceDir: "/tmp/mediaremote-adapter"
  });
  service.start();
  assert.deepEqual(spawns[0].slice(0, 2), ["/usr/bin/perl", [
    "/tmp/mediaremote-adapter/mediaremote-adapter.pl",
    "/tmp/mediaremote-adapter/MediaRemoteAdapter.framework",
    "stream", "--no-diff", "--debounce=100"
  ]]);
  child.stdout.emit("data", Buffer.from('{"type":"data","diff":false,"payload":{"bundleIdentifier":"com.apple.Music","playing":true,"title":"Song"'));
  child.stdout.emit("data", Buffer.from('}}\nnot json\n'));
  assert.equal(service.getSnapshot().title, "Song");
  assert.equal(service.sendCommand({ command: "next" }), true);
  assert.deepEqual(commands[0].slice(0, 2), ["/usr/bin/perl", [
    "/tmp/mediaremote-adapter/mediaremote-adapter.pl",
    "/tmp/mediaremote-adapter/MediaRemoteAdapter.framework",
    "send", "4"
  ]]);
  assert.equal(service.sendCommand({ command: "seek", positionSec: 3.5 }), true);
  assert.equal(commands[1][1].at(-1), "3500000");
  assert.equal(service.sendCommand({ command: "deleteEverything" }), false);
  service.stop();
  assert.equal(child.killed, true);
});

test("disabled media service does not spawn", () => {
  let spawns = 0;
  const service = new MediaService({ spawnChild: () => { spawns += 1; return fakeChild(); }, resourceDir: "/tmp/mediaremote-adapter" });
  service.setEnabled(false);
  service.start();
  assert.equal(spawns, 0);
  service.setEnabled(true);
  assert.equal(spawns, 1);
});
