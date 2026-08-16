import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { readClaudeTranscriptState } = require("../src/main/transcript-recovery.cjs");
const { CodexTranscriptWatcher } = require("../src/main/codex-transcript-watcher.cjs");

function tempTranscript(prefix, records) {
  const file = path.join(os.tmpdir(), `${prefix}-${process.pid}-${Date.now()}.jsonl`);
  fs.writeFileSync(file, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  return file;
}

test("Claude recovery keeps a turn open after tool results without end_turn", () => {
  const file = tempTranscript("workisland-claude-open", [
    { type: "user", timestamp: new Date(Date.now() - 30 * 60e3).toISOString(), message: { content: "finish the long task" } },
    { type: "assistant", message: { stop_reason: "tool_use", content: [{ type: "tool_use" }] } },
    { type: "user", message: { content: [{ type: "tool_result", content: "still working" }] } }
  ]);
  try {
    assert.deepEqual(readClaudeTranscriptState(file).unfinished, true);
    assert.equal(readClaudeTranscriptState(file).latestPrompt, "finish the long task");
  } finally {
    fs.unlinkSync(file);
  }
});

test("Claude recovery ignores a turn with a terminal end_turn", () => {
  const file = tempTranscript("workisland-claude-done", [
    { type: "user", message: { content: "already finished" } },
    { type: "assistant", message: { stop_reason: "end_turn", content: [{ type: "text", text: "done" }] } }
  ]);
  try {
    assert.equal(readClaudeTranscriptState(file).unfinished, false);
  } finally {
    fs.unlinkSync(file);
  }
});

test("Codex recovery replays an unfinished turn even when its last event is old", () => {
  const old = new Date(Date.now() - 30 * 60e3).toISOString();
  const file = tempTranscript("workisland-codex-open", [
    { type: "session_meta", timestamp: old, payload: { thread_source: "user" } },
    { type: "event_msg", timestamp: old, payload: { type: "task_started", turn_id: "turn-old" } },
    { type: "event_msg", timestamp: old, payload: { type: "user_message", message: "long running recovery check" } }
  ]);
  try {
    const watcher = new CodexTranscriptWatcher();
    const events = [];
    watcher.on("event", (event) => events.push(event));
    const tracked = {
      path: file,
      sessionId: "old-session",
      startedAt: Date.now() - 30 * 60e3,
      lastReadSize: 0,
      lastEventAt: Date.now() - 30 * 60e3,
      title: "Codex",
      turnRunning: false,
      lastTurnCompleted: false
    };
    watcher.readTail(tracked);
    assert.ok(events.some((event) => event.type === "sessionStarted" && event.replayed));
  } finally {
    fs.unlinkSync(file);
  }
});
