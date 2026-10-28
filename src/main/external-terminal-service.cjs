"use strict";

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { randomUUID } = require("node:crypto");

// Metadata only. NSWorkspace avoids starting a terminal or asking for Automation
// permission until the user explicitly requests discovery of a running host.
const SCRIPT = String.raw`
ObjC.import('AppKit');
function run(argv) {
  const request = JSON.parse(argv[0]);
  const hosts = { 'com.apple.Terminal': 'terminal', 'com.googlecode.iterm2': 'iterm2' };
  const sessions = [], errors = [];
  const running = $.NSWorkspace.sharedWorkspace.runningApplications.js;
  for (const process of running) {
    const bundle = process.bundleIdentifier.js, host = hosts[bundle];
    if (!host) continue;
    const appPid = Number(process.processIdentifier);
    if (request.action !== 'list' && (request.target.host !== host || request.target.appPid !== appPid)) continue;
    try {
      const app = Application(bundle);
      for (const window of app.windows()) {
        for (const tab of window.tabs()) {
          const entries = host === 'terminal' ? [tab] : tab.sessions();
          for (const session of entries) {
            const record = { host, appPid, windowId: window.id(), tty: session.tty(),
              sessionId: host === 'iterm2' ? session.uniqueID() : '',
              title: host === 'iterm2' ? session.name() : (tab.customTitle() || window.name()),
              busy: host === 'terminal' ? Boolean(tab.busy()) : null };
            if (request.action === 'list') { sessions.push(record); continue; }
            const target = request.target;
            if (record.windowId !== target.windowId || record.tty !== target.tty || record.sessionId !== target.sessionId) continue;
            if (request.action === 'focus') {
              if (host === 'terminal') { tab.selected = true; window.frontmost = true; }
              else { app.select(window); app.select(tab); app.select(session); }
              app.activate();
              return JSON.stringify({ ok: true });
            }
            // Terminal.app has no supported close-tab command. Closing its
            // window can terminate sibling tabs; never use that as a fallback.
            if (request.action === 'close' && host === 'iterm2') {
              app.close(session);
              return JSON.stringify({ ok: true });
            }
          }
        }
      }
    } catch (error) {
      const reason = Number(error.errorNumber || error.number) === -1743 || /-1743|not authorized|not permitted/i.test(String(error)) ? 'automation-denied' : 'host-unavailable';
      if (request.action !== 'list') return JSON.stringify({ ok: false, reason });
      errors.push({ host, reason });
    }
  }
  return JSON.stringify(request.action === 'list' ? { sessions, errors } : { ok: false, reason: 'not-found' });
}`;

function normalizeRecord(value) {
  if (!value || !["terminal", "iterm2"].includes(value.host) || !Number.isSafeInteger(value.appPid) || value.appPid <= 0 || !Number.isSafeInteger(value.windowId)
    || typeof value.tty !== "string" || !/^\/dev\/[a-z0-9._-]{1,80}$/i.test(value.tty)) return null;
  if (value.host === "iterm2" && (typeof value.sessionId !== "string" || !value.sessionId || value.sessionId.length > 160)) return null;
  return { host: value.host, appPid: value.appPid, windowId: value.windowId, tty: value.tty,
    sessionId: value.host === "iterm2" ? value.sessionId : "",
    title: typeof value.title === "string" ? value.title.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 160) : "",
    busy: typeof value.busy === "boolean" ? value.busy : null };
}
const identity = r => JSON.stringify([r.host, r.appPid, r.windowId, r.tty, r.sessionId]);

class ExternalTerminalService {
  constructor({ platform = process.platform, runner = promisify(execFile) } = {}) {
    this.platform = platform; this.runner = runner; this.records = new Map();
    this.scanned = false; this.errors = []; this.inFlight = null; this.scanError = null;
  }
  snapshot() {
    return { available: this.platform === "darwin", scanned: this.scanned, errors: this.errors,
      sessions: [...this.records.values()].map(r => ({ id: r.id, source: "external", host: r.host, title: r.title, tty: r.tty, busy: r.busy,
        capabilities: { focus: true, close: r.host === "iterm2" } })) };
  }
  async execute(payload) {
    const { stdout } = await this.runner("/usr/bin/osascript", ["-l", "JavaScript", "-e", SCRIPT, JSON.stringify(payload)], { timeout: 7000, maxBuffer: 512 * 1024 });
    return JSON.parse(stdout);
  }
  async refresh() {
    if (this.platform !== "darwin") return this.snapshot();
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.scan().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
  async scan() {
    try {
      const result = await this.execute({ action: "list" });
      if (!Array.isArray(result.sessions)) throw new Error("Invalid terminal discovery response");
      const previous = new Map([...this.records.values()].map(r => [identity(r), r.id]));
      const next = new Map();
      for (const value of result.sessions.slice(0, 128)) {
        const record = normalizeRecord(value);
        if (!record) continue;
        const id = previous.get(identity(record)) || `external:${randomUUID()}`;
        next.set(id, { ...record, id });
      }
      this.records = next;
      this.errors = (Array.isArray(result.errors) ? result.errors : []).filter(e => ["terminal", "iterm2"].includes(e.host))
        .map(e => ({ host: e.host, reason: e.reason === "automation-denied" ? e.reason : "host-unavailable" }));
      this.scanError = null; this.scanned = true;
    } catch {
      // Preserve the known list on a transient failure, but do not act on it.
      this.scanError = "scan-failed";
      this.errors = [{ host: "system", reason: "scan-failed" }];
    }
    return this.snapshot();
  }
  focus(id) { return this.operate(id, "focus"); }
  close(id) { return this.operate(id, "close"); }
  async operate(id, action) {
    const known = this.records.get(id);
    if (!known) return { ok: false, reason: "not-found", state: this.snapshot() };
    if (action === "close" && known.host !== "iterm2") return { ok: false, reason: "close-in-host", state: this.snapshot() };
    await this.refresh();
    const current = this.records.get(id);
    const error = this.scanError || this.errors.find(e => e.host === known.host)?.reason;
    if (error || !current) return { ok: false, reason: error || "not-found", state: this.snapshot() };
    try {
      const result = await this.execute({ action, target: current });
      if (!result.ok) return { ok: false, reason: result.reason || "host-unavailable", state: this.snapshot() };
      if (action === "close") {
        await this.refresh();
        const verificationError = this.scanError || this.errors.find(e => e.host === known.host)?.reason;
        if (verificationError) return { ok: false, reason: verificationError, state: this.snapshot() };
        if (this.records.has(id)) return { ok: false, reason: "confirmation-pending", state: this.snapshot() };
      }
      return { ok: true, state: this.snapshot() };
    } catch (error) {
      return { ok: false, reason: /-1743/.test(String(error?.stderr || error)) ? "automation-denied" : "host-unavailable", state: this.snapshot() };
    }
  }
}

module.exports = { ExternalTerminalService };
