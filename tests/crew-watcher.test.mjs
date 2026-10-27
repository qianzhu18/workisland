import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { createCrewWatcher, getCrewEventsFile } = require("../src/main/crew-watcher.cjs");

function makeFixture() {
  const homeDir = mkdtempSync(join(tmpdir(), "crew-watcher-"));
  mkdirSync(join(homeDir, ".flux", "hooks", "crew"), { recursive: true });
  const eventsFile = getCrewEventsFile(homeDir);
  const append = (lines) => writeFileSync(eventsFile, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", { flag: "a" });
  return { homeDir, eventsFile, append, cleanup: () => rmSync(homeDir, { recursive: true, force: true }) };
}

test("crew events file drives start/task/completion lifecycle, content never leaks", () => {
  const fx = makeFixture();
  try {
    let clock = Date.now();
    const events = [];
    const watcher = createCrewWatcher({
      homeDir: fx.homeDir,
      onEvent: (event) => events.push(event),
      scanIntervalMs: 5,
      now: () => clock
    });
    watcher.start();

    fx.append([
      { type: "sessionStarted", sessionId: "run0001", crewName: "research crew", cwd: "/Users/mac/demo-project", timestamp: clock }
    ]);
    watcher.scan();

    assert.equal(events.length, 1);
    const start = events[0];
    assert.equal(start.type, "sessionStarted");
    assert.equal(start.tool, "crew");
    assert.equal(start.sessionId, "crew-run0001");
    assert.equal(start.title, "Crew · research crew");
    assert.equal(start.projectPath, "/Users/mac/demo-project");
    assert.equal(start.detectionSource, "crew-events-file");

    // 任务完成 → activity 更新
    fx.append([
      { type: "taskCompleted", sessionId: "run0001", taskName: "收集资料", timestamp: clock }
    ]);
    watcher.scan();
    assert.equal(events.length, 2);
    assert.equal(events[1].type, "activityUpdated");
    assert.equal(events[1].activity, "任务完成：收集资料");

    // 整场完成 → completed
    fx.append([
      { type: "sessionCompleted", sessionId: "run0001", timestamp: clock }
    ]);
    watcher.scan();
    assert.equal(events.length, 3);
    assert.equal(events[2].type, "sessionCompleted");
    assert.equal(events[2].sessionId, "crew-run0001");

    // 已收卡不重复（无新内容不产生事件）
    watcher.scan();
    assert.equal(events.length, 3);

    // observe-only：事件对象不含任何任务正文（events.jsonl 只有字段，无正文）
    assert.equal(JSON.stringify(start).includes("research"), true); // 元数据可含 crew 名
    assert.equal(JSON.stringify(events).includes("正文"), false);
  } finally {
    fx.cleanup();
  }
});

test("historical events at watcher startup are not replayed; failures mark completion", () => {
  const fx = makeFixture();
  try {
    // 先写好历史事件（模拟 WorkIsland 启动前 crew 已运行）
    fx.append([
      { type: "sessionStarted", sessionId: "oldrun", crewName: "old", cwd: "/tmp", timestamp: 1 },
      { type: "taskCompleted", sessionId: "oldrun", taskName: "t1", timestamp: 1 },
      { type: "sessionCompleted", sessionId: "oldrun", timestamp: 1 }
    ]);
    const events = [];
    const watcher = createCrewWatcher({
      homeDir: fx.homeDir,
      onEvent: (event) => events.push(event),
      scanIntervalMs: 5,
      now: () => Date.now()
    });
    watcher.start();
    watcher.scan();
    assert.equal(events.length, 0, "history must be silent");

    // 新事件从游标之后开始播报
    fx.append([
      { type: "sessionStarted", sessionId: "newrun", crewName: "new", cwd: "/tmp", timestamp: 1 },
      { type: "sessionCompleted", sessionId: "newrun", failed: true, timestamp: 1 }
    ]);
    watcher.scan();
    assert.equal(events.length, 2);
    assert.equal(events[0].type, "sessionStarted");
    assert.equal(events[1].type, "sessionCompleted");
    assert.equal(events[1].error, "crew 运行失败");
  } finally {
    fx.cleanup();
  }
});

test("file truncation (clear + shorter rewrite) resets cursor and re-consumes from head", () => {
  const fx = makeFixture();
  try {
    const events = [];
    const watcher = createCrewWatcher({
      homeDir: fx.homeDir,
      onEvent: (event) => events.push(event),
      scanIntervalMs: 5,
      now: () => Date.now()
    });
    watcher.start();

    fx.append([{ type: "sessionStarted", sessionId: "s1", crewName: "c", cwd: "/tmp", timestamp: 1 }]);
    watcher.scan();
    assert.equal(events.length, 1);

    // 文件被清空（truncate）后重写为更短内容：size 回退 → 游标重置，从头消费。
    truncateSync(fx.eventsFile, 0);
    writeFileSync(fx.eventsFile, JSON.stringify({ type: "sessionStarted", sessionId: "s2", crewName: "c2", cwd: "/", timestamp: 1 }) + "\n", { flag: "a" });
    watcher.scan();
    assert.equal(events.length, 2);
    assert.equal(events[1].sessionId, "crew-s2");

    // 文件被删除重建（ino 变化）：同样从头消费。
    rmSync(fx.eventsFile, { force: true });
    writeFileSync(fx.eventsFile, JSON.stringify({ type: "sessionStarted", sessionId: "s3", crewName: "c3", cwd: "/", timestamp: 1 }) + "\n", { flag: "a" });
    watcher.scan();
    assert.equal(events.length, 3);
    assert.equal(events[2].sessionId, "crew-s3");
  } finally {
    fx.cleanup();
  }
});

test("malformed lines are skipped without crashing", () => {
  const fx = makeFixture();
  try {
    const events = [];
    const watcher = createCrewWatcher({
      homeDir: fx.homeDir,
      onEvent: (event) => events.push(event),
      scanIntervalMs: 5,
      now: () => Date.now()
    });
    watcher.start();
    writeFileSync(fx.eventsFile, "not-json\n{ broken\n" + JSON.stringify({ type: "sessionStarted", sessionId: "ok", crewName: "c", cwd: "/tmp", timestamp: 1 }) + "\n");
    watcher.scan();
    assert.equal(events.length, 1);
    assert.equal(events[0].sessionId, "crew-ok");
  } finally {
    fx.cleanup();
  }
});
