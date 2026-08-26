"use strict";

const SOUND_DEDUP_WINDOW_MS = 5000;
const SOUND_DEDUP_CAPACITY = 512;

/**
 * Translate events synthesized from a Codex transcript into the same sound
 * vocabulary used by hook adapters. Replayed startup state and user-initiated
 * interruptions deliberately stay quiet.
 */
function resolveCodexTranscriptSoundEvent(event = {}) {
  if (event.detectionSource !== "codex-transcript" || event.replayed) return null;
  if (event.type === "turnStarted") return "sessionStart";
  if (event.type !== "sessionCompleted" || event.isInterrupt) return null;
  return event.error ? "taskError" : "taskComplete";
}

/**
 * Hooks and the transcript watcher can describe the same lifecycle edge a
 * moment apart. Keep audio idempotent without suppressing another session.
 */
function createAgentSoundDeduplicator({
  now = Date.now,
  windowMs = SOUND_DEDUP_WINDOW_MS,
  capacity = SOUND_DEDUP_CAPACITY
} = {}) {
  const recent = new Map();

  function shouldPlay(eventId, sessionId, timestamp) {
    const occurredAt = Number.isFinite(timestamp) ? timestamp : now();
    const key = `${sessionId || "unknown"}:${eventId}`;
    const previous = recent.get(key);
    if (previous !== undefined && occurredAt - previous < windowMs) return false;

    recent.set(key, occurredAt);
    if (recent.size > capacity) recent.delete(recent.keys().next().value);
    return true;
  }

  return { shouldPlay };
}

module.exports = {
  SOUND_DEDUP_WINDOW_MS,
  createAgentSoundDeduplicator,
  resolveCodexTranscriptSoundEvent
};
