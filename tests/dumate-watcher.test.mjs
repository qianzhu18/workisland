import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { createDuMateWatcher, parseProjectDirFromHead, listAccountSandboxDirs } = require("../src/main/dumate-watcher.cjs");

function makeFixture() {
  const homeDir = mkdtempSync(join(tmpdir(), "dumate-watcher-"));
  const sandboxDir = join(homeDir, "Library", "Application Support", "qianfan-desktop-app", "qianfan_desk_xdg", "acc1", "data", "logs", "sandbox");
  mkdirSync(sandboxDir, { recursive: true });
  return { homeDir, sandboxDir, cleanup: () => rmSync(homeDir, { recursive: true, force: true }) };
}

test("new sandbox session log emits start, idle emits completion, content never leaks", () => {
  const fx = makeFixture();
  try {
    let clock = Date.now();
    const events = [];
    const watcher = createDuMateWatcher({
      homeDir: fx.homeDir,
      onEvent: (event) => events.push(event),
      scanIntervalMs: 5,
      idleCompleteMs: 1000,
      now: () => clock
    });
    watcher.start();

    writeFileSync(join(fx.sandboxDir, "ses_abc123456789.log"), [
      "INFO service=sandbox.entry sandbox starting",
      "INFO service=sandbox.entry directory=/Users/mac/demo-project bootstrap received",
      "INFO service=bus type=message.part.updated publishing 绝密正文不应外泄"
    ].join("\n"));
    watcher.scan();

    assert.equal(events.length, 1, "start event on first sighting");
    const start = events[0];
    assert.equal(start.type, "sessionStarted");
    assert.equal(start.tool, "dumate");
    assert.equal(start.sessionId, "dumate-abc123456789");
    assert.equal(start.projectPath, "/Users/mac/demo-project");
    assert.equal(start.title, "DuMate · 456789");
    // observe-only：日志正文不进事件对象
    assert.equal(JSON.stringify(start).includes("绝密正文"), false);

    // 未闲置：不收卡
    clock += 500;
    watcher.scan();
    assert.equal(events.length, 1);

    // 闲置超过阈值 → completed
    clock += 1200;
    watcher.scan();
    assert.equal(events.length, 2);
    assert.equal(events[1].type, "sessionCompleted");
    assert.equal(events[1].sessionId, "dumate-abc123456789");

    // 已收卡不再重复
    watcher.scan();
    assert.equal(events.length, 2);

    // 历史会话（出现即已闲置）静默归档，不弹卡
    writeFileSync(join(fx.sandboxDir, "ses_old000000009.log"), "INFO service=sandbox.entry sandbox starting");
    const past = clock - 60_000;
    utimesSync(join(fx.sandboxDir, "ses_old000000009.log"), new Date(past), new Date(past));
    watcher.scan();
    assert.equal(events.length, 2, "historical idle session must be silent");
    assert.equal(watcher.hasSession("old000000009"), true);
    watcher.stop();
  } finally {
    fx.cleanup();
  }
});

test("multiple accounts and session resume are handled", () => {
  const fx = makeFixture();
  try {
    const sandbox2 = join(fx.homeDir, "Library", "Application Support", "qianfan-desktop-app", "qianfan_desk_xdg", "acc2", "data", "logs", "sandbox");
    mkdirSync(sandbox2, { recursive: true });
    assert.equal(listAccountSandboxDirs(fx.homeDir).length, 2);

    const events = [];
    const watcher = createDuMateWatcher({
      homeDir: fx.homeDir,
      onEvent: (event) => events.push(event),
      idleCompleteMs: 1000,
      now: () => Date.now()
    });
    writeFileSync(join(sandbox2, "ses_def000000000.log"), "INFO service=sandbox.entry handshake complete");
    watcher.start();
    assert.equal(events.length, 1);
    assert.ok(watcher.hasSession("def000000000"));

    // 同一会话重复扫描不重复发事件
    watcher.scan();
    assert.equal(events.length, 1);
    watcher.stop();
  } finally {
    fx.cleanup();
  }
});

test("missing qianfan root yields no directories and no events", () => {
  const events = [];
  const watcher = createDuMateWatcher({
    homeDir: "/nonexistent-home",
    onEvent: (event) => events.push(event),
    now: () => Date.now()
  });
  watcher.start();
  watcher.stop();
  assert.equal(events.length, 0);
});

test("parseProjectDirFromHead picks the first directory field", () => {
  assert.equal(parseProjectDirFromHead("INFO service=sandbox.entry directory=/Users/mac/p1 bootstrap"), "/Users/mac/p1");
  assert.equal(parseProjectDirFromHead("INFO nothing here"), "");
});
