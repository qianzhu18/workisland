import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { createQoderWatcher, parseMetaFromHead, listTranscriptDirs } = require("../src/main/qoder-watcher.cjs");

function makeFixture() {
  const homeDir = mkdtempSync(join(tmpdir(), "qoder-watcher-"));
  const transcriptDir = join(homeDir, ".qoder", "projects", "-Users-mac-demo", "transcript");
  mkdirSync(transcriptDir, { recursive: true });
  return { homeDir, transcriptDir, cleanup: () => rmSync(homeDir, { recursive: true, force: true }) };
}

const META_LINE = JSON.stringify({
  type: "session_meta",
  sessionId: "task-f1e2d3c4.session.execution",
  timestamp: "2026-09-13T05:00:00.000Z",
  cwd: "/Users/mac/demo-project"
});

test("new transcript emits start, idle emits completion, prompt content never leaks", () => {
  const fx = makeFixture();
  try {
    let clock = Date.now();
    const events = [];
    const watcher = createQoderWatcher({
      homeDir: fx.homeDir,
      onEvent: (event) => events.push(event),
      idleCompleteMs: 1000,
      now: () => clock
    });
    watcher.start();

    writeFileSync(join(fx.transcriptDir, "task-f1e2d3c4.session.execution.jsonl"), [
      META_LINE,
      JSON.stringify({ type: "user", message: { content: "机密提示词不应外泄" } })
    ].join("\n"));
    watcher.scan();

    assert.equal(events.length, 1);
    const start = events[0];
    assert.equal(start.type, "sessionStarted");
    assert.equal(start.tool, "qoder");
    assert.equal(start.sessionId, "qoder-task-f1e2d3c4.session.execution");
    assert.equal(start.projectPath, "/Users/mac/demo-project");
    assert.equal(start.title, "Qoder · e2d3c4");
    assert.equal(JSON.stringify(start).includes("机密提示词"), false, "observe-only：正文不进事件");

    clock += 500;
    watcher.scan();
    assert.equal(events.length, 1, "未闲置不收卡");

    clock += 1200;
    watcher.scan();
    assert.equal(events.length, 2);
    assert.equal(events[1].type, "sessionCompleted");
    assert.equal(events[1].sessionId, "qoder-task-f1e2d3c4.session.execution");

    watcher.scan();
    assert.equal(events.length, 2, "已收卡不重复");
    watcher.stop();
  } finally {
    fx.cleanup();
  }
});

test("historical idle transcripts are archived silently", () => {
  const fx = makeFixture();
  try {
    const events = [];
    const watcher = createQoderWatcher({
      homeDir: fx.homeDir,
      onEvent: (event) => events.push(event),
      idleCompleteMs: 1000,
      now: () => Date.now()
    });
    const oldFile = join(fx.transcriptDir, "task-old000009.session.execution.jsonl");
    writeFileSync(oldFile, META_LINE);
    const past = Date.now() - 60_000;
    utimesSync(oldFile, new Date(past), new Date(past));

    watcher.start();
    assert.equal(events.length, 0, "历史会话静默归档");
    assert.equal(watcher.sessionCount(), 1);
    watcher.stop();
  } finally {
    fx.cleanup();
  }
});

test("no qoder projects dir yields nothing", () => {
  const events = [];
  const watcher = createQoderWatcher({ homeDir: "/nonexistent-home", onEvent: (e) => events.push(e), now: () => Date.now() });
  watcher.start();
  watcher.stop();
  assert.equal(events.length, 0);
});

test("parseMetaFromHead extracts cwd and sessionId, tolerates broken head", () => {
  const meta = parseMetaFromHead(`${META_LINE}\nnoise`);
  assert.equal(meta.cwd, "/Users/mac/demo-project");
  assert.equal(meta.sessionId, "task-f1e2d3c4.session.execution");
  assert.deepEqual(parseMetaFromHead("not json"), { cwd: "", sessionId: "" });
  assert.equal(listTranscriptDirs("/nonexistent-home").length, 0);
});
