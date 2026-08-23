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
  DISABLE_GEOIP_PROPERTY,
  EVENTS,
  PROPERTY_WHITELIST,
  SETTINGS_KEY_WHITELIST,
  sanitizeProps
} = require("../shared/telemetry.cjs");

const STATE_FILE = "state.json";
const PENDING_FILE = "pending.json";
// Agent lifecycle messages can arrive through a hook and a transcript watcher.
// This short in-memory window only coalesces the two reports for one active
// turn; it is deliberately never persisted or included in telemetry payloads.
const LIFECYCLE_COALESCE_WINDOW_MS = 5e3;
const LIFECYCLE_TRACKING_CAPACITY = 1024;

/**
 * Anonymous usage telemetry (PRD-005; default-on policy since 2026-08-22,
 * disclosed in Settings → About with a one-click off).
 *
 * Guarantees, in order of importance:
 * 1. Off means off: when telemetryEnabled is false nothing is queued, and
 *    turning it off drops the pending queue immediately.
 * 2. Only whitelisted events/props leave the machine (see shared/telemetry.cjs);
 *    unknown event names and persisted queue entries are rejected fail-closed.
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
        activationSent: persistedState.activationSent === true,
        lastSuccessAt: Number.isFinite(persistedState.lastSuccessAt) && persistedState.lastSuccessAt > 0
          ? persistedState.lastSuccessAt
          : null
      }
    : { anonId: null, activationSent: false, lastSuccessAt: null };
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
  /** @type {Map<string, { startedAt: number, completed: boolean, seenAt: number }>} */
  const lifecycleTurnsBySession = new Map();

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

  function enabled() {
    return getSettings()?.telemetryEnabled === true;
  }

  function canUpload() {
    return enabled() && isPackaged === true && typeof apiKey === "string" && apiKey.length > 0;
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
    if (!enabled()) return;
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

  /**
   * Record a lifecycle event once per active local turn.
   *
   * sessionId is an internal, in-memory deduplication key only. It is neither
   * passed to track() nor persisted, so the upload contract remains the
   * event/property whitelist in shared/telemetry.cjs.
   */
  function trackLifecycleEvent(eventName, { sessionId, tool } = {}) {
    if (!enabled()) return false;
    if (
      (eventName !== EVENTS.SESSION_STARTED && eventName !== EVENTS.SESSION_COMPLETED) ||
      typeof sessionId !== "string" ||
      sessionId.length === 0 ||
      sessionId.length > 512
    ) return false;

    const capturedAt = now();
    pruneLifecycleTurns(capturedAt);
    const previous = lifecycleTurnsBySession.get(sessionId);

    if (eventName === EVENTS.SESSION_STARTED) {
      // A second source may report the same just-started turn. Once a terminal
      // event was seen, however, the next start is a genuine new user turn and
      // must count even if it happens immediately.
      if (previous && !previous.completed && capturedAt - previous.startedAt < LIFECYCLE_COALESCE_WINDOW_MS) {
        previous.seenAt = capturedAt;
        return false;
      }
      lifecycleTurnsBySession.set(sessionId, {
        startedAt: capturedAt,
        completed: false,
        seenAt: capturedAt
      });
      track(eventName, { tool });
      return true;
    }

    // The first terminal event closes the locally observed turn. A later
    // duplicate completion cannot inflate completion/retention metrics.
    if (previous?.completed) {
      previous.seenAt = capturedAt;
      return false;
    }
    lifecycleTurnsBySession.set(sessionId, {
      startedAt: previous?.startedAt ?? capturedAt,
      completed: true,
      seenAt: capturedAt
    });
    track(eventName, { tool });
    return true;
  }

  function pruneLifecycleTurns(capturedAt) {
    const expiry = capturedAt - LIFECYCLE_COALESCE_WINDOW_MS;
    for (const [sessionId, state] of lifecycleTurnsBySession) {
      // A completed turn can be released quickly. Running turns stay long
      // enough to collapse hook/transcript fan-out, then a later start is
      // treated as a new turn rather than retaining an identifier indefinitely.
      if (state.seenAt < expiry) lifecycleTurnsBySession.delete(sessionId);
    }
    if (lifecycleTurnsBySession.size <= LIFECYCLE_TRACKING_CAPACITY) return;
    const overflow = lifecycleTurnsBySession.size - LIFECYCLE_TRACKING_CAPACITY;
    const oldest = Array.from(lifecycleTurnsBySession.entries())
      .sort(([, a], [, b]) => a.seenAt - b.seenAt)
      .slice(0, overflow);
    for (const [sessionId] of oldest) lifecycleTurnsBySession.delete(sessionId);
  }

  /** Activation signal — emitted at most once per installation. */
  function markFirstAgentSignal(tool) {
    // Do not consume the one-shot marker while collection is turned off.
    if (state.activationSent || !enabled()) return;
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
        // No location must be inferred from the request IP. This is applied at
        // upload time rather than persisted with the product-event whitelist.
        properties: { [DISABLE_GEOIP_PROPERTY]: true, ...baseProperties(), ...(entry.props || {}) },
        timestamp: new Date(entry.ts).toISOString()
      }))
    };
    inFlight = sendBatch(payload)
      .then((ok) => {
        if (ok) {
          queue = queue.slice(batch.length);
          // This is an HTTP 2xx acknowledgement from PostHog's batch endpoint,
          // not a claim about downstream analytics processing.
          state.lastSuccessAt = now();
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
   * Setting changes funnel through here. Disabling wipes every pending event
   * right away — "off" must mean the data is gone, not queued for later.
   */
  function setEnabled(enabled) {
    if (enabled) return;
    queue = [];
    lifecycleTurnsBySession.clear();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    writeJsonAtomic(pendingPath, queue);
  }

  function getStatus() {
    const isEnabled = enabled();
    const canSend = canUpload();
    return {
      enabled: isEnabled,
      canUpload: canSend,
      pendingEventCount: queue.length,
      lastSuccessAt: state.lastSuccessAt,
      status: !isEnabled
        ? "disabled"
        : !isPackaged
          ? "development"
          : !apiKey
            ? "not-configured"
            : "ready"
    };
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
    trackLifecycleEvent,
    markFirstAgentSignal,
    trackSettingChange,
    setEnabled,
    flush,
    start,
    stop,
    isEnabled: enabled,
    getStatus,
    queueLength: () => queue.length,
    getStatePath: () => statePath,
    getPendingPath: () => pendingPath
  };
}

module.exports = {
  createTelemetryService
};
