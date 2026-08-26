import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const {
  createAgentSoundDeduplicator,
  resolveCodexTranscriptSoundEvent
} = require("../src/main/agent-sound-policy.cjs");
const { CodexTranscriptWatcher } = require("../src/main/codex-transcript-watcher.cjs");

test("Codex transcript lifecycle events map to start, complete, and error sounds", () => {
  assert.equal(resolveCodexTranscriptSoundEvent({ detectionSource: "codex-transcript", type: "turnStarted" }), "sessionStart");
  assert.equal(resolveCodexTranscriptSoundEvent({ detectionSource: "codex-transcript", type: "sessionCompleted" }), "taskComplete");
  assert.equal(resolveCodexTranscriptSoundEvent({ detectionSource: "codex-transcript", type: "sessionCompleted", error: "failed" }), "taskError");
  assert.equal(resolveCodexTranscriptSoundEvent({ detectionSource: "codex-transcript", type: "sessionCompleted", isInterrupt: true }), null);
  assert.equal(resolveCodexTranscriptSoundEvent({ detectionSource: "codex-transcript", type: "turnStarted", replayed: true }), null);
});

test("sound dedup keeps one lifecycle sound per session without muting another session", () => {
  const dedup = createAgentSoundDeduplicator({ now: () => 1000 });
  assert.equal(dedup.shouldPlay("taskComplete", "one", 1000), true);
  assert.equal(dedup.shouldPlay("taskComplete", "one", 2000), false);
  assert.equal(dedup.shouldPlay("taskComplete", "two", 2000), true);
  assert.equal(dedup.shouldPlay("taskComplete", "one", 6000), true);
});

test("a Codex user message creates one turn-start edge for sound playback", () => {
  const watcher = new CodexTranscriptWatcher();
  const events = [];
  watcher.on("event", (event) => events.push(event));
  const file = {
    sessionId: "sound-regression-session",
    startedAt: 0,
    lastReadSize: 0,
    lastEventAt: 0,
    title: "Codex 会话",
    turnRunning: false,
    lastTurnCompleted: false
  };

  watcher.processLine(file, JSON.stringify({
    timestamp: "2026-08-26T00:00:00.000Z",
    payload: { type: "user_message", message: "请完成声音回归测试" }
  }));

  assert.equal(events.filter((event) => event.type === "turnStarted").length, 1);
  assert.equal(events.find((event) => event.type === "turnStarted")?.detectionSource, "codex-transcript");
});
