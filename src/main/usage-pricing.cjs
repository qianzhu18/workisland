"use strict";

/**
 * PRD-015 T3：模型定价表与成本计算。
 *
 * - 定价源：LiteLLM model_prices_and_zero_day_markups.json（MIT）。
 *   运行时拉取并缓存到 userData/usage/pricing-cache.json，24h TTL；
 *   拉取失败静默降级到缓存/内置快照，绝不阻塞任何调用（local-first）。
 * - 成本单位：整数微美元（micro-usd），避免浮点累加误差。
 *   表内价格换算为「每百万 token 的美元数」，microUsd = perMillionUsd * tokens。
 * - 缓存感知：cacheRead / cacheCreation 与新鲜 input 分开计价；
 *   定价缺失的记录返回 unknown，绝不折算成 0（PRD 验收标准）。
 */

const fs = require("node:fs");
const path = require("node:path");
const log = require("electron-log");

const LITELLM_PRICING_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_zero_day_markups.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1e3;

/**
 * 内置离线快照（美元 / 百万 token，数量级参照，联网后 24h 内被 LiteLLM 刷新覆盖）。
 * key 是归一化后的模型名（小写、无厂牌前缀）。
 */
const BUNDLED_PRICING_SNAPSHOT = Object.freeze({
  "claude-sonnet-4": { inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheCreationPerMillion: 3.75 },
  "claude-opus-4": { inputPerMillion: 15, outputPerMillion: 75, cacheReadPerMillion: 1.5, cacheCreationPerMillion: 18.75 },
  "claude-haiku-3.5": { inputPerMillion: 0.8, outputPerMillion: 4, cacheReadPerMillion: 0.08, cacheCreationPerMillion: 1 },
  "gpt-5": { inputPerMillion: 1.25, outputPerMillion: 10, cacheReadPerMillion: 0.125, cacheCreationPerMillion: 0 },
  "gpt-5-codex": { inputPerMillion: 1.25, outputPerMillion: 10, cacheReadPerMillion: 0.125, cacheCreationPerMillion: 0 },
  "gemini-2.5-pro": { inputPerMillion: 1.25, outputPerMillion: 10, cacheReadPerMillion: 0.315, cacheCreationPerMillion: 0 },
  "kimi-k2": { inputPerMillion: 0.6, outputPerMillion: 2.5, cacheReadPerMillion: 0.15, cacheCreationPerMillion: 0.6 },
  "deepseek-chat": { inputPerMillion: 0.27, outputPerMillion: 1.1, cacheReadPerMillion: 0.07, cacheCreationPerMillion: 0.27 }
});

const VENDOR_PREFIXES = ["anthropic/", "openai/", "google/", "moonshot/", "deepseek/", "bedrock/", "azure/", "gemini/"];

function normalizeModelName(model) {
  if (typeof model !== "string") return "";
  let name = model.trim().toLowerCase();
  for (const prefix of VENDOR_PREFIXES) {
    if (name.startsWith(prefix)) {
      name = name.slice(prefix.length);
      break;
    }
  }
  return name;
}

/**
 * 归一化 LiteLLM 原始条目（价格为每 token 美元浮点）为每百万美元口径；
 * 非 chat/completion 类条目（embedding、tts、per_second 计费等）跳过。
 */
function normalizeLitellmEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (entry.mode && entry.mode !== "chat" && entry.mode !== "completion") return null;
  if (typeof entry.input_price !== "number" && typeof entry.output_price !== "number") return null;
  return {
    inputPerMillion: (entry.input_price ?? 0) * 1e6,
    outputPerMillion: (entry.output_price ?? 0) * 1e6,
    cacheReadPerMillion: (entry.cached_input_price ?? 0) * 1e6,
    cacheCreationPerMillion: (entry.cache_creation_input_price ?? 0) * 1e6
  };
}

/** 在定价表中查找模型：精确命中 -> 去厂牌前缀 -> 最长前缀匹配（带日期后缀的变体）。 */
function lookupModel(models, model) {
  const norm = normalizeModelName(model);
  if (!norm) return null;
  if (models[norm]) return models[norm];
  // 模型名常带日期/版本后缀（claude-sonnet-4-20250514 -> claude-sonnet-4）
  let best = null;
  for (const key of Object.keys(models)) {
    if (norm.startsWith(key) && (best === null || key.length > best.length)) {
      best = key;
    }
  }
  return best === null ? null : models[best];
}

/**
 * 单条 token 记录的成本（整数微美元）。
 * 返回 { costMicroUsd, unknown }：定价缺失时 costMicroUsd 为 null 且 unknown 为 true，
 * 调用方必须把这类记录单列展示，不能显示为 $0。
 */
function computeCostMicroUsd(models, record) {
  const entry = lookupModel(models, record?.model);
  if (!entry) {
    const tokens = (record?.inputTokens ?? 0) + (record?.outputTokens ?? 0) + (record?.cacheReadTokens ?? 0) + (record?.cacheCreationTokens ?? 0);
    return { costMicroUsd: null, unknown: true, unknownTokens: tokens };
  }
  const cost =
    Math.round((entry.inputPerMillion || 0) * (record.inputTokens ?? 0)) +
    Math.round((entry.outputPerMillion || 0) * (record.outputTokens ?? 0)) +
    Math.round((entry.cacheReadPerMillion || 0) * (record.cacheReadTokens ?? 0)) +
    Math.round((entry.cacheCreationPerMillion || 0) * (record.cacheCreationTokens ?? 0));
  return { costMicroUsd: cost, unknown: false, unknownTokens: 0 };
}

class UsagePricing {
  /** cachePath / fetchImpl / now 均可注入（测试）。 */
  constructor({ cachePath, fetchImpl, now = Date.now } = {}) {
    this.cachePath = cachePath ?? null; // 为空时不落盘（纯内存）
    this.fetchImpl = fetchImpl ?? (typeof fetch === "function" ? fetch : null);
    this.now = now;
    this.models = { ...BUNDLED_PRICING_SNAPSHOT };
    this.lastFetchedAt = null;
    this.refreshing = false;
  }

  /** 同步加载缓存并按需触发异步刷新（失败静默）。启动时调用一次即可。 */
  start() {
    this.loadCache();
    this.refresh().catch(() => {});
    return this;
  }

  loadCache() {
    if (!this.cachePath) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.cachePath, "utf-8"));
      if (parsed && typeof parsed === "object" && parsed.models && typeof parsed.models === "object" && parsed.fetchedAt) {
        this.models = parsed.models;
        this.lastFetchedAt = parsed.fetchedAt;
        log.info("[UsagePricing] loaded cached pricing table: %d models, fetchedAt=%d", Object.keys(parsed.models).length, parsed.fetchedAt);
      }
    } catch (err) {
      if (err?.code !== "ENOENT") log.warn("[UsagePricing] failed to load pricing cache:", err?.message ?? err);
    }
  }

  /** 拉取 LiteLLM 定价表并写缓存。缓存未过期时跳过；任何失败静默返回 false。 */
  async refresh({ force = false } = {}) {
    if (this.refreshing) return false;
    if (!force && this.lastFetchedAt && this.now() - this.lastFetchedAt < CACHE_TTL_MS) return false;
    if (!this.fetchImpl) return false;
    this.refreshing = true;
    try {
      const res = await this.fetchImpl(LITELLM_PRICING_URL, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        log.info("[UsagePricing] refresh skipped: HTTP %s", res.status);
        return false;
      }
      const raw = await res.json();
      const models = {};
      for (const [name, entry] of Object.entries(raw ?? {})) {
        const norm = normalizeModelName(name);
        const value = normalizeLitellmEntry(entry);
        if (norm && value && (value.inputPerMillion > 0 || value.outputPerMillion > 0)) {
          models[norm] = value;
        }
      }
      if (Object.keys(models).length === 0) return false;
      this.models = models;
      this.lastFetchedAt = this.now();
      this.persist();
      log.info("[UsagePricing] refreshed pricing table: %d models", Object.keys(models).length);
      return true;
    } catch (err) {
      log.info("[UsagePricing] refresh failed (offline?): %s", err?.message ?? err);
      return false;
    } finally {
      this.refreshing = false;
    }
  }

  persist() {
    if (!this.cachePath) return;
    try {
      fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
      const tmp = this.cachePath + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify({ fetchedAt: this.lastFetchedAt, source: "litellm", models: this.models }), "utf-8");
      fs.renameSync(tmp, this.cachePath);
    } catch (err) {
      log.warn("[UsagePricing] failed to persist pricing cache:", err?.message ?? err);
    }
  }

  getModels() {
    return this.models;
  }

  /** 计算单条记录成本；供聚合层逐条调用。 */
  costFor(record) {
    return computeCostMicroUsd(this.models, record);
  }
}

let _instance = null;
/** 默认单例：缓存落在 userData/usage/pricing-cache.json。 */
function getUsagePricing() {
  if (!_instance) {
    let cachePath = null;
    try {
      const electron = require("electron");
      cachePath = path.join(electron.app.getPath("userData"), "usage", "pricing-cache.json");
    } catch {
      cachePath = null;
    }
    _instance = new UsagePricing({ cachePath }).start();
  }
  return _instance;
}

module.exports = {
  UsagePricing,
  getUsagePricing,
  computeCostMicroUsd,
  lookupModel,
  normalizeModelName,
  normalizeLitellmEntry,
  BUNDLED_PRICING_SNAPSHOT
};
