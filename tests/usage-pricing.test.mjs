import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const dir = mkdtempSync(join(tmpdir(), "wi-usage-pricing-"));

const {
  UsagePricing,
  computeCostMicroUsd,
  lookupModel,
  normalizeModelName,
  normalizeLitellmEntry,
  BUNDLED_PRICING_SNAPSHOT
} = require("../src/main/usage-pricing.cjs");

test("computeCostMicroUsd is cache-aware integer micro-dollars", () => {
  const models = BUNDLED_PRICING_SNAPSHOT;
  const result = computeCostMicroUsd(models, {
    model: "claude-sonnet-4",
    inputTokens: 1e6,
    outputTokens: 1e6,
    cacheReadTokens: 1e6,
    cacheCreationTokens: 1e6
  });
  // 3 + 15 + 0.3 + 3.75 = 22.05 USD -> 22050000 micro-usd
  assert.equal(result.costMicroUsd, 22050000);
  assert.equal(result.unknown, false);
  assert.equal(result.unknownTokens, 0);
});

test("missing pricing returns unknown, never a fake zero", () => {
  const result = computeCostMicroUsd(BUNDLED_PRICING_SNAPSHOT, {
    model: "totally-unknown-model",
    inputTokens: 500,
    outputTokens: 100
  });
  assert.equal(result.costMicroUsd, null);
  assert.equal(result.unknown, true);
  assert.equal(result.unknownTokens, 600);
});

test("vendor prefixes and dated variants resolve to base models", () => {
  assert.equal(normalizeModelName("anthropic/claude-sonnet-4-20250514"), "claude-sonnet-4-20250514");
  const entry = lookupModel(BUNDLED_PRICING_SNAPSHOT, "claude-sonnet-4-20250514");
  assert.ok(entry, "dated variant must resolve via longest-prefix match");
  assert.equal(entry.inputPerMillion, 3);
  const gpt = lookupModel(BUNDLED_PRICING_SNAPSHOT, "gpt-5.1-2026-07");
  assert.ok(gpt, "newer dated variant falls back to family pricing");
});

test("normalizeLitellmEntry converts per-token floats and skips non-chat entries", () => {
  assert.equal(normalizeLitellmEntry({ mode: "embedding", input_price: 1e-7 }), null, "embedding entries are skipped");
  assert.equal(normalizeLitellmEntry({}), null);
  const entry = normalizeLitellmEntry({ input_price: 3e-6, output_price: 15e-6, cached_input_price: 3e-7, cache_creation_input_price: 3.75e-6 });
  assert.deepEqual(entry, {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheCreationPerMillion: 3.75
  });
});

test("refresh pulls LiteLLM, persists cache, and honors TTL", async () => {
  const cachePath = join(dir, `pricing-${Math.random().toString(36).slice(2)}.json`);
  let clock = 1000000;
  const fake = async () => ({
    ok: true,
    json: async () => ({
      "anthropic/claude-sonnet-4-20261101": { mode: "chat", input_price: 2e-6, output_price: 10e-6, cached_input_price: 2e-7 },
      "text-embedding-3-small": { mode: "embedding", input_price: 2e-8 }
    })
  });
  const pricing = new UsagePricing({ cachePath, fetchImpl: fake, now: () => clock }).start();
  await new Promise((r) => setImmediate(r));
  await pricing.refresh(); // ensure refresh completed (start fired one concurrently)
  assert.ok(pricing.getModels()["claude-sonnet-4-20261101"], "fetched model must be present");
  assert.ok(!pricing.getModels()["text-embedding-3-small"], "embedding entry filtered out");
  const cached = JSON.parse(readFileSync(cachePath, "utf-8"));
  assert.equal(cached.source, "litellm");
  assert.equal(cached.fetchedAt, clock);
  // TTL: same clock -> skipped
  assert.equal(await pricing.refresh(), false);
  // TTL expired -> fetches again
  clock += 25 * 60 * 60 * 1e3;
  assert.equal(await pricing.refresh(), true);
});

test("offline start falls back to the bundled snapshot and never throws", async () => {
  const failing = async () => {
    throw new Error("offline");
  };
  const pricing = new UsagePricing({ fetchImpl: failing, now: () => 0 }).start();
  await pricing.refresh({ force: true });
  assert.equal(pricing.costFor({ model: "gpt-5", inputTokens: 1e6, outputTokens: 0 }).costMicroUsd, 1250000);
});

test("a cached table survives process restart without network", () => {
  const cachePath = join(dir, `pricing-restart-${Math.random().toString(36).slice(2)}.json`);
  const pricing = new UsagePricing({ cachePath, fetchImpl: null, now: () => 12345 });
  pricing.models = { "private-model": { inputPerMillion: 1, outputPerMillion: 2, cacheReadPerMillion: 0, cacheCreationPerMillion: 0 } };
  pricing.lastFetchedAt = 12345;
  pricing.persist();
  const revived = new UsagePricing({ cachePath, fetchImpl: null, now: () => 999999 });
  revived.loadCache();
  assert.equal(revived.costFor({ model: "private-model", inputTokens: 2e6, outputTokens: 1e6 }).costMicroUsd, 4000000);
});
