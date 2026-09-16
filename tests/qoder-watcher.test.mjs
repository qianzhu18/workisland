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

test("QwenWorkCN chats table drives qoder sessions (new/updated/idle/reconciled)", async () => {
  const fx = makeFixture();
  try {
    let clock = Date.now();
    const events = [];
    let rows = [
      ["chatA", "帮我整理运营素材", "/Users/mac/.qwenworkcn/workspace/chatA", String(Math.floor((clock - 60_000) / 1000)), String(Math.floor((clock + 900) / 1000))],
      ["chatOld", "历史任务", "/Users/mac/.qwenworkcn/workspace/chatOld", String(Math.floor((clock - 600_000) / 1000)), String(Math.floor((clock - 500_000) / 1000))]
    ];
    const watcher = createQoderWatcher({
      homeDir: fx.homeDir,
      onEvent: (event) => events.push(event),
      idleCompleteMs: 1000,
      now: () => clock,
      runSqliteQuery: async (dbPath, sql) => {
        assert.ok(dbPath.endsWith("agents.db"), "must query the QwenWorkCN agents.db");
        assert.match(sql, /FROM chats/);
        return rows.map((row) => row.join("|")).join("\n");
      }
    });
    // db 文件需存在才扫
    const { getQwenWorkChatsDb } = require("../src/main/qoder-watcher.cjs");
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(require("node:path").dirname(getQwenWorkChatsDb(fx.homeDir)), { recursive: true });
    writeFileSync(getQwenWorkChatsDb(fx.homeDir), "");

    watcher.start();
    await new Promise((r) => setTimeout(r, 10));

    const started = events.filter((e) => e.type === "sessionStarted");
    assert.equal(started.length, 1, "新 chat 发 running，历史 chat 静默");
    assert.equal(started[0].sessionId, "qoder-qwc-chatA");
    assert.equal(started[0].title, "Qoder · 帮我整理运营素材");
    assert.equal(started[0].projectPath, "/Users/mac/.qwenworkcn/workspace/chatA");

    // updated_at 刷新 → 复活；随后闲置 → 收卡
    clock += 2000;
    rows = rows.map((row) => row[0] === "chatA" ? [...row.slice(0, 4), String(Math.floor(clock / 1000))] : row);
    watcher.scan();
    await new Promise((r) => setTimeout(r, 10));

    clock += 2000;
    watcher.scan();
    await new Promise((r) => setTimeout(r, 10));

    const completed = events.filter((e) => e.type === "sessionCompleted" && e.sessionId === "qoder-qwc-chatA");
    assert.equal(completed.length, 1, "闲置后收卡");
    watcher.stop();
  } finally {
    fx.cleanup();
  }
});
