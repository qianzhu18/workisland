import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { UsageService } = require("../src/main/usage-service.cjs");
const { UsagePricing, BUNDLED_PRICING_SNAPSHOT } = require("../src/main/usage-pricing.cjs");

const DAY = 24 * 60 * 60 * 1e3;

// 固定「现在」为 2026-08-28 12:00（本地时区），保证断言确定性
const NOW = new Date(2026, 7, 28, 12, 0, 0).getTime();
const pricing = new UsagePricing({ fetchImpl: null, now: () => 1 });
pricing.lastFetchedAt = 1;

function fakeStats({ tokens = [], sessions = [], retentionDays = 90 } = {}) {
  return {
    tokens,
    sessions,
    retentionDays,
    dirty: false,
    flushToDisk() {
      this.dirty = false;
      this.flushed = true;
    }
  };
}

function tokenRecord(over = {}) {
  return {
    tool: "claude",
    sessionId: "s1",
    timestamp: NOW - 1 * DAY,
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    model: "claude-sonnet-4",
    ...over
  };
}

test("summary buckets by local-timezone day with zero fill", () => {
  const stats = fakeStats({
    tokens: [tokenRecord({ timestamp: new Date(2026, 7, 27, 23, 30).getTime(), inputTokens: 1000, outputTokens: 500 })],
    sessions: [{ tool: "claude", startedAt: NOW - 2 * DAY, completedAt: new Date(2026, 7, 27, 23, 40).getTime(), sessionId: "s1" }]
  });
  const svc = new UsageService({ statsService: stats, pricing, now: () => NOW });
  const summary = svc.getUsageSummary({ days: 7 });
  assert.equal(summary.byDay.length, 7);
  assert.deepEqual(
    summary.byDay.map((d) => d.date),
    ["2026-08-22", "2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"]
  );
  // 23:30 本地时间必须落在 08-27 桶（本地时区分桶，非 UTC）
  const bucket = summary.byDay.find((d) => d.date === "2026-08-27");
  assert.equal(bucket.inputTokens, 1000);
  assert.equal(bucket.sessionCount, 1);
  assert.equal(summary.byDay[0].inputTokens, 0, "older days zero-filled");
  assert.equal(summary.totals.sessionCount, 1);
});

test("summary aggregates per agent and per model with cache-aware micro-dollar cost", () => {
  const stats = fakeStats({
    tokens: [
      tokenRecord({ tool: "claude", model: "claude-sonnet-4", inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 1e6, cacheCreationTokens: 1e6 }),
      tokenRecord({ sessionId: "s2", tool: "codex", model: "gpt-5-codex", inputTokens: 2e6, outputTokens: 0 }),
      tokenRecord({ sessionId: "s3", tool: "opencode", model: "mystery-model", inputTokens: 100, outputTokens: 100 })
    ]
  });
  const svc = new UsageService({ statsService: stats, pricing, now: () => NOW });
  const summary = svc.getUsageSummary({ days: 7 });
  const claude = summary.byAgent.find((a) => a.tool === "claude");
  assert.equal(claude.costMicroUsd, 22050000, "3+15+0.3+3.75 USD in micro-dollars");
  const gpt = summary.byModel.find((m) => m.model === "gpt-5-codex");
  assert.equal(gpt.costMicroUsd, 2500000);
  const unknown = summary.byModel.find((m) => m.model === "mystery-model");
  assert.equal(unknown.costMicroUsd, 0, "unknown pricing never adds fake cost");
  assert.equal(unknown.unknownCostTokens, 200, "unknown tokens listed separately");
  assert.equal(summary.totals.costMicroUsd, 24550000);
  assert.equal(summary.totals.unknownCostTokens, 200);
});

test("summary tracks the remote split", () => {
  const stats = fakeStats({
    tokens: [
      tokenRecord({ isRemote: true, remoteHost: "mac-studio", inputTokens: 400, outputTokens: 100 }),
      tokenRecord({ sessionId: "s2", inputTokens: 50 })
    ]
  });
  const svc = new UsageService({ statsService: stats, pricing, now: () => NOW });
  const summary = svc.getUsageSummary({ days: 7 });
  assert.equal(summary.remote.records, 1);
  assert.equal(summary.remote.tokens, 500);
});

test("session insights classify quick / marathon / automation and estimate peak context", () => {
  const stats = fakeStats({
    tokens: [
      // quick: 5 分钟内、token 很少
      tokenRecord({ sessionId: "quick", timestamp: NOW - 60 * 1e3, inputTokens: 100, outputTokens: 50 }),
      // marathon: 跨度 ≥ 60min
      tokenRecord({ sessionId: "marathon", timestamp: NOW - 90 * 60 * 1e3, inputTokens: 5e4, outputTokens: 1e4 }),
      tokenRecord({ sessionId: "marathon", timestamp: NOW - 10 * 60 * 1e3, inputTokens: 8e4, outputTokens: 2e4, cacheReadTokens: 3e4 }),
      // automation: remote 标记
      tokenRecord({ sessionId: "remote", timestamp: NOW - 30 * 1e3, inputTokens: 10, outputTokens: 10, isRemote: true }),
      // standard: 其余
      tokenRecord({ sessionId: "standard", timestamp: NOW - 30 * 60 * 1e3, inputTokens: 6e4, outputTokens: 5e3 })
    ],
    sessions: [
      { tool: "claude", startedAt: NOW - 5 * 60 * 1e3, completedAt: NOW - 55 * 1e3, sessionId: "quick" },
      { tool: "claude", startedAt: NOW - 95 * 60 * 1e3, completedAt: NOW - 5 * 60 * 1e3, sessionId: "marathon" },
      { tool: "claude", startedAt: NOW - 40 * 60 * 1e3, completedAt: NOW - 25 * 60 * 1e3, sessionId: "standard" }
    ]
  });
  const svc = new UsageService({ statsService: stats, pricing, now: () => NOW });
  const { sessions } = svc.getSessionInsights({ days: 7 });
  const byId = Object.fromEntries(sessions.map((s) => [s.sessionId, s]));
  assert.equal(byId.quick.category, "quick");
  assert.equal(byId.quick.durationMs, 4 * 60 * 1e3 + 5 * 1e3, "duration prefers session_records join");
  assert.equal(byId.marathon.category, "marathon");
  assert.equal(byId.marathon.peakContextTokens, 11e4, "peak context = max single-record input+cacheRead+cacheCreation");
  assert.equal(byId.remote.category, "automation");
  assert.equal(byId.remote.isRemote, true);
  assert.equal(byId.standard.category, "standard");
  assert.equal(sessions[0].completedAt >= sessions[sessions.length - 1].completedAt, true, "sorted by recency");
});

test("export and clear round out the data-ownership story", () => {
  const stats = fakeStats({
    tokens: [tokenRecord()],
    sessions: [{ tool: "claude", startedAt: NOW - 1000, completedAt: NOW, sessionId: "s1" }]
  });
  const svc = new UsageService({ statsService: stats, pricing, now: () => NOW });
  const exported = svc.exportUsageData();
  assert.equal(exported.tokenRecords.length, 1);
  assert.equal(exported.sessionRecords.length, 1);
  assert.equal(exported.retentionDays, 90);
  assert.equal(exported.pricing.source, "litellm");

  let changed = 0;
  svc.onChange(() => changed += 1);
  svc.clearUsageData();
  assert.equal(stats.tokens.length, 0);
  assert.equal(stats.sessions.length, 0);
  assert.equal(stats.flushed, true, "clear flushes empty arrays to disk");
  assert.equal(changed, 1);
});

test("days is clamped to [1, 90] and defaults to 7", () => {
  const svc = new UsageService({ statsService: fakeStats(), pricing, now: () => NOW });
  assert.equal(svc.getUsageSummary({}).days, 7);
  assert.equal(svc.getUsageSummary({ days: 400 }).days, 90);
  assert.equal(svc.getUsageSummary({ days: 0 }).days, 1);
});
