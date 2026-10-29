import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const dir = mkdtempSync(join(tmpdir(), "wi-quota-service-"));

const electronId = require.resolve("electron");
require.cache[electronId] = {
  id: electronId,
  filename: electronId,
  loaded: true,
  exports: { app: { getPath: () => dir }, ipcMain: { on() {}, handle() {}, removeListener() {}, removeHandler() {} } }
};

const { parseRateLimitsFromFile } = require("../src/main/quota-service.cjs");

function tokenCountLine(usedPercent, timestamp) {
  return JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      rate_limits: {
        primary: { used_percent: usedPercent, window_minutes: 300, resets_at: 1793250000 },
        secondary: { used_percent: usedPercent + 1, window_minutes: 10080, resets_at: 1793850000 }
      }
    }
  });
}

test("quota parser reads rate limits from the tail of a large rollout", () => {
  const file = join(dir, "large-rollout.jsonl");
  const old = tokenCountLine(10, "2026-10-29T00:00:00.000Z");
  const fillerLine = JSON.stringify({
    type: "response_item",
    payload: { type: "message", role: "assistant", content: [{ type: "text", text: "x".repeat(1000) }] }
  }) + "\n";
  const tail = tokenCountLine(77, "2026-10-29T12:00:00.000Z");
  writeFileSync(file, old + "\n" + fillerLine.repeat(18_000) + tail + "\n");

  const result = parseRateLimitsFromFile(file);
  assert.ok(result);
  assert.equal(result.limits.primary.used_percent, 77);
  assert.equal(result.limits.secondary.used_percent, 78);
});

test("quota parser returns null when the tail has no rate limits", () => {
  const file = join(dir, "no-limits.jsonl");
  writeFileSync(file, JSON.stringify({ type: "event_msg", payload: { type: "token_count" } }) + "\n");
  assert.equal(parseRateLimitsFromFile(file), null);
});

test("quota parser keeps the last rate limit in a small file", () => {
  const file = join(dir, "small.jsonl");
  writeFileSync(file, [
    tokenCountLine(12, "2026-10-29T00:00:00.000Z"),
    tokenCountLine(34, "2026-10-29T01:00:00.000Z")
  ].join("\n"));
  const result = parseRateLimitsFromFile(file);
  assert.equal(result.limits.primary.used_percent, 34);
});
