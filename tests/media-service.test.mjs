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
    platform: "darwin",
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
  const service = new MediaService({ platform: "darwin", spawnChild: () => { spawns += 1; return fakeChild(); }, resourceDir: "/tmp/mediaremote-adapter" });
  service.setEnabled(false);
  service.start();
  assert.equal(spawns, 0);
  service.setEnabled(true);
  assert.equal(spawns, 1);
});

test("media service publishes metadata immediately and then enriches it with the source app icon", async () => {
  const child = fakeChild();
  let resolveIcon;
  const service = new MediaService({
    platform: "darwin",
    spawnChild: () => child,
    resolveAppIcon: () => new Promise((resolve) => { resolveIcon = resolve; }),
    resourceDir: "/tmp/mediaremote-adapter"
  });
  const updates = [];
  service.on("update", (state) => updates.push(state));
  service.start();

  child.stdout.emit("data", Buffer.from('{"type":"data","diff":false,"payload":{"bundleIdentifier":"com.apple.Music","playing":true,"title":"Song"}}\n'));
  assert.equal(service.getSnapshot().title, "Song");
  assert.equal(service.getSnapshot().appIconDataUrl, "");

  resolveIcon("data:image/png;base64,aWNvbg==");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.getSnapshot().appIconDataUrl, "data:image/png;base64,aWNvbg==");
  assert.equal(updates.at(-1).appIconDataUrl, "data:image/png;base64,aWNvbg==");
});

test("media service never attaches a completed icon lookup to a different media source", async () => {
  const child = fakeChild();
  const pending = new Map();
  const service = new MediaService({
    platform: "darwin",
    spawnChild: () => child,
    resolveAppIcon: (bundleId) => new Promise((resolve) => pending.set(bundleId, resolve)),
    resourceDir: "/tmp/mediaremote-adapter"
  });
  service.start();

  child.stdout.emit("data", Buffer.from('{"type":"data","diff":false,"payload":{"bundleIdentifier":"com.apple.Music","playing":true,"title":"First"}}\n'));
  child.stdout.emit("data", Buffer.from('{"type":"data","diff":false,"payload":{"bundleIdentifier":"com.netease.163music","playing":true,"title":"Second"}}\n'));
  pending.get("com.apple.Music")("data:image/png;base64,YXBwbGU=");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.getSnapshot().appBundleId, "com.netease.163music");
  assert.equal(service.getSnapshot().appIconDataUrl, "");

  pending.get("com.netease.163music")("data:image/png;base64,bmV0ZWFzZQ==");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.getSnapshot().appIconDataUrl, "data:image/png;base64,bmV0ZWFzZQ==");
});

test("Windows media service polls GSMTC and routes allowlisted commands through PowerShell", async () => {
  const commands = [];
  const service = new MediaService({
    platform: "win32",
    pollIntervalMs: 60_000,
    windowsScriptPath: "C:\\WorkIsland\\media-session.ps1",
    env: { SystemRoot: "C:\\Windows" },
    query: async () => ({ stdout: JSON.stringify({
      active: true, playing: true, title: "Windows Song", appBundleId: "Player.exe", appName: "Player",
      canPlayPause: true, canNext: true, canPrevious: true, updatedAt: 1
    }) }),
    execute: (...args) => commands.push(args)
  });
  service.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.getSnapshot().title, "Windows Song");
  assert.equal(service.sendCommand({ command: "next" }), true);
  assert.equal(commands[0][1].some((value) => value.endsWith("media-session.ps1")), true);
  assert.equal(commands[0][1].at(commands[0][1].indexOf("-Action") + 1), "next");
  service.stop();
});
