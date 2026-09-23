import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, test } from "node:test";

const require = createRequire(import.meta.url);
const { CodexTranscriptWatcher } = require("../src/main/codex-transcript-watcher.cjs");
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTranscript(contents = "") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workisland-transcript-"));
  tempDirs.push(dir);
  const transcriptPath = path.join(dir, "rollout-test.jsonl");
  fs.writeFileSync(transcriptPath, contents);
  return transcriptPath;
}

function createTrackedFile(transcriptPath) {
  return {
    path: transcriptPath,
    sessionId: "chunked-session",
    startedAt: 0,
    lastReadSize: 0,
    lastEventAt: 0,
    title: "Codex 会话",
    turnRunning: false,
    lastTurnCompleted: false
  };
}

function jsonLine(payload) {
  return JSON.stringify({ timestamp: "2026-09-22T00:00:00.000Z", payload });
}

test("increment reads stay bounded and preserve lifecycle events across UTF-8 chunks", () => {
  const transcriptPath = createTranscript([
    jsonLine({ type: "user_message", message: "请完整保留跨分块的中文提示" }),
    jsonLine({ type: "task_complete", last_agent_message: "已经完成" })
  ].join("\n") + "\n");
  const requestedBytes = [];
  const trackedFs = {
    ...fs,
    readSync(fd, buffer, offset, length, position) {
      requestedBytes.push(length);
      return fs.readSync(fd, buffer, offset, length, position);
    }
  };
  const watcher = new CodexTranscriptWatcher({
    incrementChunkBytes: 17,
    fsModule: trackedFs
  });
  const events = [];
  watcher.on("event", (event) => events.push(event));
  const file = createTrackedFile(transcriptPath);

  watcher.readIncrement(file);

  assert.ok(requestedBytes.length > 1);
  assert.ok(requestedBytes.every((length) => length <= 17));
  assert.equal(file.lastPrompt, "请完整保留跨分块的中文提示");
  assert.deepEqual(events.map((event) => event.type), [
    "turnStarted",
    "sessionStarted",
    "sessionCompleted"
  ]);
});

test("unfinished JSONL tail is emitted only after the rest of the line arrives", () => {
  const line = jsonLine({ type: "user_message", message: "半行追加后才处理" });
  const splitAt = Buffer.byteLength(line, "utf8") - 8;
  const encoded = Buffer.from(line, "utf8");
  const transcriptPath = createTranscript(encoded.subarray(0, splitAt));
  const watcher = new CodexTranscriptWatcher({ incrementChunkBytes: 11 });
  const events = [];
  watcher.on("event", (event) => events.push(event));
  const file = createTrackedFile(transcriptPath);

  watcher.readIncrement(file);
  assert.equal(events.length, 0);

  fs.appendFileSync(transcriptPath, Buffer.concat([
    encoded.subarray(splitAt),
    Buffer.from("\n")
  ]));
  watcher.readIncrement(file);

  assert.equal(file.lastPrompt, "半行追加后才处理");
  assert.deepEqual(events.map((event) => event.type), ["turnStarted", "sessionStarted"]);
});

test("truncation clears an unfinished tail before parsing replacement content", () => {
  const transcriptPath = createTranscript(
    '{"payload":{"type":"user_message","message":"' + "旧内容".repeat(80)
  );
  const watcher = new CodexTranscriptWatcher({ incrementChunkBytes: 13 });
  const events = [];
  watcher.on("event", (event) => events.push(event));
  const file = createTrackedFile(transcriptPath);

  watcher.readIncrement(file);
  assert.equal(events.length, 0);

  const replacement = jsonLine({ type: "user_message", message: "新文件内容" }) + "\n";
  fs.writeFileSync(transcriptPath, replacement);
  watcher.readIncrement(file);

  assert.equal(file.lastPrompt, "新文件内容");
  assert.deepEqual(events.map((event) => event.type), ["turnStarted", "sessionStarted"]);
});
