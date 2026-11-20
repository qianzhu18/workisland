"use strict";

const http = require("node:http");
const { EventEmitter } = require("node:events");

const APPROVALS_PATH = "/api/handoff/tool-approvals";

/** Only these modes should drive the polling bridge (native/none => leave approvals in Alma). */
function isBridgeMode(mode) {
  return mode === "bridge" || mode === "trust";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/**
 * Normalize one Alma handoff approval into the fields the Island approval card reads.
 * Alma sends { requestId, source, title, message, confirmLabel, cancelLabel, type,
 * threadId, metadata }. For bash requests the runnable command lives in metadata.command.
 */
function normalizeApprovalRequest(raw) {
  const input = asObject(raw);
  const metadata = asObject(input.metadata);
  const source = text(input.source) || "tool";
  const title = text(input.title) || text(input.confirmLabel) || source;
  const message = text(input.message);
  const command = text(metadata.command);
  const isBash = source === "bash" || text(input.type) === "bash";
  return {
    requestId: text(input.requestId),
    source,
    title,
    message,
    type: text(input.type),
    threadId: text(input.threadId),
    toolName: isBash ? "Bash" : title,
    toolInput: command || message || title || "Alma 请求执行操作",
    riskLevel: isBash ? "high" : "medium"
  };
}

/** The alma adapter uses threadId as the session id; fall back to a stable key for orphans. */
function sessionIdFor(approval) {
  return approval.threadId || `alma-approval:${approval.requestId}`;
}

/**
 * Map an Island resolution action to Alma's handoff response vocabulary.
 * The Island has allowOnce / allowAlways / deny, and the API also accepts
 * deny_with_reason when a reason is supplied.
 */
function mapResolution(action, reason) {
  const detail = text(reason);
  switch (action) {
    case "allowOnce":
      return { action: "allow_once" };
    case "allowAlways":
      return { action: "allow_always" };
    case "deny":
    case "reject":
      return detail ? { action: "deny_with_reason", reason: detail } : { action: "deny" };
    default:
      return null;
  }
}

/** Minimal JSON-over-HTTP client using node:http; injectable for tests. */
function requestJson({ method, url, body, timeoutMs = 2000 }) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (err) {
      reject(err);
      return;
    }
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method,
      headers: payload
        ? { "content-type": "application/json", "content-length": payload.length }
        : {}
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        let parsed = null;
        if (raw) {
          try { parsed = JSON.parse(raw); } catch { /* ignore malformed payloads */ }
        }
        resolve({ statusCode: res.statusCode || 0, body: parsed });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("alma approvals request timed out")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * AlmaApprovalBridge polls Alma's local handoff API for pending tool approvals and
 * feeds them into WorkIsland's existing pending-approval pipeline as agent events.
 *
 * It is deliberately standalone (not a hook adapter): Alma's hooks are fire-and-forget
 * and have no permission event, while approvals are exposed over an HTTP handoff API.
 * The coordinator pipes the emitted permissionRequested / permissionResolved events
 * through the same reducer as Claude/Codex/DSH, and routes Island resolutions back
 * here so they can be POSTed to Alma.
 */
class AlmaApprovalBridge extends EventEmitter {
  constructor(options = {}) {
    super();
    this.getConfig = options.getConfig || (() => ({ enabled: false, mode: "bridge" }));
    this.baseUrl = (options.baseUrl || "http://127.0.0.1:23001").replace(/\/$/, "");
    this.pollIntervalMs = Math.max(10, options.pollIntervalMs || 1500);
    this.request = options.request || requestJson;
    this.now = options.now || Date.now;
    this.onEvent = typeof options.onEvent === "function" ? options.onEvent : null;
    this.started = false;
    this.timer = null;
    this.inFlight = false;
    /** @type {Map<string, object>} requestId -> normalized approval + sessionId (shown as a card) */
    this.known = new Map();
    /** @type {Set<string>} requestIds we already answered; ignored until Alma removes them */
    this.resolved = new Set();
  }

  _emit(event) {
    this.emit("event", event);
    if (this.onEvent) this.onEvent(event);
  }

  _config() {
    try {
      const value = asObject(this.getConfig());
      return { enabled: value.enabled === true, mode: text(value.mode) || "bridge" };
    } catch {
      return { enabled: false, mode: "bridge" };
    }
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.sync();
  }

  /** Re-evaluate enable/mode after a settings change. */
  sync() {
    const config = this._config();
    const active = this.started && config.enabled && config.mode !== "native" && config.mode !== "none";
    if (active && !this.timer) {
      this.timer = setInterval(() => { void this.poll(); }, this.pollIntervalMs);
      this.timer.unref?.();
      void this.poll();
    } else if (!active && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.inFlight = false;
      this._clearKnown();
    }
  }

  stop() {
    this.started = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.inFlight = false;
    this._clearKnown();
  }

  _clearKnown() {
    for (const approval of this.known.values()) this._emitResolved(approval);
    this.known.clear();
    this.resolved.clear();
  }

  _emitPending(approval) {
    this._emit({
      type: "permissionRequested",
      sessionId: approval.sessionId,
      tool: "alma",
      timestamp: this.now(),
      // Unique per request so the agent-event dedup never collapses two approvals
      // that arrive in the same thread within a few seconds.
      turnId: approval.requestId,
      permissionRequest: {
        id: approval.requestId,
        sessionId: approval.sessionId,
        toolName: approval.toolName,
        toolInput: approval.toolInput,
        riskLevel: approval.riskLevel,
        approvalMode: "bridge",
        provider: "alma"
      }
    });
  }

  _emitResolved(approval) {
    this._emit({
      type: "permissionResolved",
      sessionId: approval.sessionId,
      tool: "alma",
      timestamp: this.now(),
      turnId: approval.requestId
    });
  }

  async poll() {
    if (this.inFlight) return;
    const config = this._config();
    if (!config.enabled || config.mode === "native" || config.mode === "none") return;
    this.inFlight = true;
    try {
      const response = await this.request({
        method: "GET",
        url: `${this.baseUrl}${APPROVALS_PATH}`
      });
      if (response.statusCode !== 200 || !Array.isArray(response.body)) return;
      const present = new Set();
      for (const raw of response.body) {
        const approval = normalizeApprovalRequest(raw);
        if (!approval.requestId) continue;
        present.add(approval.requestId);
        // Already answered but Alma still lists it transiently: don't re-surface.
        if (this.resolved.has(approval.requestId)) continue;
        if (this.known.has(approval.requestId)) continue;
        const entry = { ...approval, sessionId: sessionIdFor(approval) };
        this.known.set(approval.requestId, entry);
        if (config.mode === "trust") {
          // Full trust: answer allow_always immediately, without surfacing a card.
          void this.resolveById(approval.requestId, "allowAlways");
        } else {
          this._emitPending(entry);
        }
      }
      // Requests that vanished (answered inside Alma, timed out, or aborted) must
      // not leave a stale approval card in the Island.
      for (const [requestId, entry] of this.known) {
        if (!present.has(requestId)) {
          this.known.delete(requestId);
          this._emitResolved(entry);
        }
      }
      // Forget answered ids once Alma no longer reports them, so a genuinely new
      // request that reuses the id can be surfaced again.
      for (const requestId of this.resolved) {
        if (!present.has(requestId)) this.resolved.delete(requestId);
      }
    } catch {
      // Alma closed or not running — stay quiet, the next tick will retry.
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Resolve an approval by its Alma requestId. Returns true when Alma accepted
   * (or reported the request as already handled via 409).
   */
  async resolveById(requestId, action, reason) {
    const mapped = mapResolution(action, reason);
    if (!mapped || !text(requestId)) return false;
    // Refuse ids we never surfaced or already answered, so a stale card or a
    // repeated click cannot POST a decision Alma never asked about.
    const entry = this.known.get(requestId);
    if (!entry) return false;
    try {
      const response = await this.request({
        method: "POST",
        url: `${this.baseUrl}${APPROVALS_PATH}`,
        body: { requestId, response: mapped }
      });
      const handled = (response.statusCode >= 200 && response.statusCode < 300) || response.statusCode === 409;
      if (handled) {
        this.known.delete(requestId);
        this.resolved.add(requestId);
        if (entry) this._emitResolved(entry);
      }
      return handled;
    } catch {
      return false;
    }
  }
}

module.exports = {
  AlmaApprovalBridge,
  normalizeApprovalRequest,
  sessionIdFor,
  mapResolution
};
