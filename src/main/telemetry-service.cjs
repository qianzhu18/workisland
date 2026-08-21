"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  POSTHOG_HOST,
  POSTHOG_API_KEY,
  TELEMETRY_FLUSH_INTERVAL_MS,
  TELEMETRY_REQUEST_TIMEOUT_MS,
  TELEMETRY_QUEUE_MAX,
  TELEMETRY_BATCH_MAX,
  EVENTS,
  PROPERTY_WHITELIST,
  SETTINGS_KEY_WHITELIST,
  sanitizeProps
} = require("../shared/telemetry.cjs");

const STATE_FILE = "state.json";
const PENDING_FILE = "pending.json";

/**
 * Opt-in anonymous telemetry (ADR-0003 / PRD-005).
 *
 * Guarantees, in order of importance:
 * 1. Disabled means disabled: without consent nothing is queued, and turning
 *    consent off drops the pending queue immediately.
 * 2. Only whitelisted events/props leave the machine (see shared/telemetry.cjs).
 * 3. Uploads never disturb the app: 8s timeout, silent retries, queue caps.
 * 4. Development builds never upload; they may queue locally for inspection.
 */
function createTelemetryService({
  getSettings = () => ({}),
  isPackaged = true,
  appVersion = "",
  osVersion = "",
  userDataPath = ".",
  fetchImpl = globalThis.fetch,
  host = POSTHOG_HOST,
  apiKey = POSTHOG_API_KEY,
  now = () => Date.now(),
  flushIntervalMs = TELEMETRY_FLUSH_INTERVAL_MS,
  logger = console
} = {}) {
  const dir = path.join(userDataPath, "telemetry");
  const statePath = path.join(dir, STATE_FILE);
  const pendingPath = path.join(dir, PENDING_FILE);

  // Fail closed on disk state: a stale or malformed file must never smuggle an
  // unknown event, property, or anonymous id past the whitelist.
  const persistedState = readJson(statePath, {});
  const state = persistedState && typeof persistedState === "object" && !Array.isArray(persistedState)
    ? {
        anonId: typeof persistedState.anonId === "string" && persistedState.anonId.length > 0
          ? persistedState.anonId
          : null,
        activationSent: persistedState.activationSent === true
      }
    : { anonId: null, activationSent: false };
  const persistedQueue = readJson(pendingPath, []);
  let queue = Array.isArray(persistedQueue)
    ? persistedQueue.filter((entry) => (
        entry &&
        typeof entry.event === "string" &&
        Object.prototype.hasOwnProperty.call(PROPERTY_WHITELIST, entry.event) &&
        Number.isFinite(entry.ts)
      )).map((entry) => ({
        event: entry.event,
        props: sanitizeProps(entry.event, entry.props),
        ts: entry.ts
      }))
    : [];
  let saveTimer = null;
  let flushTimer = null;
  let inFlight = null;

  function readJson(filePath, fallback) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return fallback;
    }
  }

  function writeJsonAtomic(filePath, value) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.tmp`;
      fs.writeFileSync(temporaryPath, JSON.stringify(value));
      fs.renameSync(temporaryPath, filePath);
    } catch (error) {
      // Telemetry persistence must never break the app.
      logger.warn?.("[TelemetryService] failed to persist state:", error?.message || error);
    }
  }

  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      writeJsonAtomic(pendingPath, queue);
      writeJsonAtomic(statePath, state);
    }, 300);
  }

  function consented() {
    return getSettings()?.telemetryEnabled === true;
  }

  function canUpload() {
    return consented() && isPackaged === true && typeof apiKey === "string" && apiKey.length > 0;
  }

  function anonId() {
    if (typeof state.anonId === "string" && state.anonId.length > 0) return state.anonId;
    state.anonId = crypto.randomUUID();
    writeJsonAtomic(statePath, state);
    return state.anonId;
  }

  function baseProperties() {
    return {
      appVersion: String(appVersion || ""),
      osVersion: String(osVersion || "")
    };
  }

  function track(eventName, props) {
    if (!consented()) return;
    // Fail closed for event names outside the shared whitelist; sanitizing
    // properties alone would still let an unknown event name leave the machine.
    if (!Object.prototype.hasOwnProperty.call(PROPERTY_WHITELIST, eventName)) return;
    queue.push({
      event: eventName,
      props: sanitizeProps(eventName, props),
      ts: now()
    });
    if (queue.length > TELEMETRY_QUEUE_MAX) {
      queue = queue.slice(queue.length - TELEMETRY_QUEUE_MAX);
    }
    scheduleSave();
  }

  /** Activation signal — emitted at most once per installation. */
  function markFirstAgentSignal(tool) {
    // Do not consume the one-shot marker before the user has opted in. An
    // agent can signal while the consent window is still open.
    if (state.activationSent || !consented()) return;
    state.activationSent = true;
    track(EVENTS.FIRST_AGENT_SIGNAL, { tool });
  }

  /** Whitelisted setting keys only; values are never recorded. */
  function trackSettingChange(key) {
    if (typeof key !== "string") return;
    if (!SETTINGS_KEY_WHITELIST.includes(key)) return;
    track(EVENTS.SETTINGS_CHANGED, { key });
  }

  async function flush() {
    if (!canUpload() || queue.length === 0 || inFlight) return;
    const batch = queue.slice(0, TELEMETRY_BATCH_MAX);
    const payload = {
      api_key: apiKey,
      batch: batch.map((entry) => ({
        event: entry.event,
        distinct_id: anonId(),
        properties: { ...baseProperties(), ...(entry.props || {}) },
        timestamp: new Date(entry.ts).toISOString()
      }))
    };
    inFlight = sendBatch(payload)
      .then((ok) => {
        if (ok) {
          queue = queue.slice(batch.length);
          scheduleSave();
        }
      })
      .catch(() => {
        // Keep the queue; the next flush interval retries.
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  async function sendBatch(payload) {
    if (typeof fetchImpl !== "function") return false;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), TELEMETRY_REQUEST_TIMEOUT_MS) : null;
    try {
      const response = await fetchImpl(`${host}/batch/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "WorkIsland-telemetry"
        },
        body: JSON.stringify(payload),
        signal: controller?.signal
      });
      return Boolean(response?.ok);
    } catch {
      return false;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  /**
   * Consent changes funnel through here. Disabling wipes every pending event
   * right away — "off" must mean the data is gone, not queued for later.
   */
  function setEnabled(enabled) {
    if (enabled) return;
    queue = [];
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    writeJsonAtomic(pendingPath, queue);
  }

  function start() {
    if (flushTimer) return;
    flushTimer = setInterval(() => {
      void flush();
    }, flushIntervalMs);
  }

  function stop() {
    if (flushTimer) clearInterval(flushTimer);
    flushTimer = null;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      writeJsonAtomic(pendingPath, queue);
      writeJsonAtomic(statePath, state);
    }
    // Best-effort final flush; anything unsent stays queued for next launch.
    void flush();
  }

  return {
    track,
    markFirstAgentSignal,
    trackSettingChange,
    setEnabled,
    flush,
    start,
    stop,
    isConsented: consented,
    queueLength: () => queue.length,
    getStatePath: () => statePath,
    getPendingPath: () => pendingPath
  };
}

module.exports = {
  createTelemetryService
};
