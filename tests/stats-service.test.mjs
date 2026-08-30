import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const dir = mkdtempSync(join(tmpdir(), "wi-stats-service-"));

// stats-service 顶部 require("electron")（无二进制时 require 即抛错），先塞桩。
// 用 DI 注入 statsDir 后桩内 getPath 不会被调用。
const electronId = require.resolve("electron");
require.cache[electronId] = {
  id: electronId,
  filename: electronId,
  loaded: true,
  exports: { app: { getPath: () => dir }, ipcMain: { on() {}, handle() {}, removeListener() {}, removeHandler() {} } }
};

const { StatsService, DEFAULT_RETENTION_DAYS } = require("../src/main/stats-service.cjs");
const DAY = 24 * 60 * 60 * 1e3;

function newService() {
  return new StatsService({ statsDir: join(dir, `stats-${Math.random().toString(36).slice(2)}`) });
}

test("default retention is 90 days (PRD-015 raised from 8)", () => {
  assert.equal(DEFAULT_RETENTION_DAYS, 90);
  const svc = newService();
  assert.equal(svc.retentionDays, 90);
});

test("flush keeps records younger than retention and prunes older ones", () => {
  const svc = newService();
  const now = Date.now();
  svc.tokens = [
    { tool: "claude", sessionId: "s-old", timestamp: now - 91 * DAY, inputTokens: 1, outputTokens: 1, model: "m" },
    { tool: "claude", sessionId: "s-mid", timestamp: now - 30 * DAY, inputTokens: 2, outputTokens: 2, model: "m" },
    { tool: "claude", sessionId: "s-new", timestamp: now - 1 * DAY, inputTokens: 3, outputTokens: 3, model: "m" }
  ];
  svc.sessions = [
    { tool: "claude", startedAt: now - 91 * DAY, completedAt: now - 91 * DAY },
    { tool: "claude", startedAt: now - 30 * DAY, completedAt: now - 30 * DAY }
  ];
  svc.dirty = true;
  svc.flushToDisk();
  assert.deepEqual(svc.tokens.map((r) => r.sessionId), ["s-mid", "s-new"], "30-day-old record must survive the 90-day retention");
  assert.equal(svc.sessions.length, 1);
});

test("legacy token records without model are normalized to unknown on load", () => {
  const statsDir = join(dir, `stats-mig-${Math.random().toString(36).slice(2)}`);
  mkdirSync(statsDir, { recursive: true });
  writeFileSync(
    join(statsDir, "token_records.json"),
    JSON.stringify([
      { tool: "opencode", sessionId: "a", timestamp: Date.now(), inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 },
      { tool: "gemini", sessionId: "b", timestamp: Date.now(), inputTokens: 1, outputTokens: 1, model: "gemini-2.5-pro" }
    ]),
    "utf-8"
  );
  const svc = new StatsService({ statsDir });
  assert.equal(svc.tokens[0].model, "unknown", "missing model must be migrated, not dropped");
  assert.equal(svc.tokens[1].model, "gemini-2.5-pro");
});

test("recordToken persists model and notifies onChange listeners", () => {
  const svc = newService();
  let notified = 0;
  const off = svc.onChange(() => notified += 1);
  svc.recordToken("claude", "s1", 10, 5, 3, 1, null, "claude-sonnet-4");
  svc.recordToken("claude", "s2", 10, 5, 3, 1);
  assert.equal(notified, 2);
  assert.equal(svc.tokens[0].model, "claude-sonnet-4");
  assert.equal(svc.tokens[1].model, "unknown", "recordToken without model falls back to unknown");
  off();
  svc.dispose();
});

test("setRetentionDays clamps to [8, 730] and ignores garbage", () => {
  const svc = newService();
  svc.setRetentionDays(2);
  assert.equal(svc.retentionDays, 8, "lower bound is 8");
  svc.setRetentionDays(99999);
  assert.equal(svc.retentionDays, 730, "upper bound is 730");
  svc.setRetentionDays(120);
  assert.equal(svc.retentionDays, 120);
  svc.setRetentionDays("nope");
  assert.equal(svc.retentionDays, 120, "invalid input is ignored");
});

test("flush + reload roundtrip through the injected directory", () => {
  const statsDir = join(dir, `stats-rt-${Math.random().toString(36).slice(2)}`);
  const a = new StatsService({ statsDir });
  a.recordToken("codex", "s1", 100, 40, 30, 10, null, "gpt-5-codex");
  a.recordSession("codex", Date.now() - 1000, Date.now());
  a.dispose();
  const raw = JSON.parse(readFileSync(join(statsDir, "token_records.json"), "utf-8"));
  assert.equal(raw.length, 1);
  assert.equal(raw[0].model, "gpt-5-codex");
  const b = new StatsService({ statsDir });
  assert.equal(b.getTokenTotals("codex", "s1").input, 100);
  assert.equal(b.sessions.length, 1);
});
