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
  const hosts = { 'com.apple.Terminal': 'terminal', 'com.googlecode.iterm2': 'iterm2', 'com.mitchellh.ghostty': 'ghostty', 'dev.warp.Warp-Stable': 'warp', 'com.github.wez.wezterm': 'wezterm', 'net.kovidgoyal.kitty': 'kitty', 'org.alacritty': 'alacritty' };
  const sessions = [], errors = [];
  const running = $.NSWorkspace.sharedWorkspace.runningApplications.js;
  for (const process of running) {
    const bundle = process.bundleIdentifier.js, host = hosts[bundle];
    if (!host) continue;
    const appPid = Number(process.processIdentifier);
    if (request.action !== 'list' && (request.target.host !== host || request.target.appPid !== appPid)) continue;
    if (['warp', 'wezterm', 'kitty', 'alacritty'].includes(host)) {
      if (request.action === 'list') { sessions.push({host, appPid, appOnly: true, title: String(process.localizedName.js || host)}); continue; }
      if (request.action === 'focus' && request.target.appOnly) return JSON.stringify({ok: Boolean(process.activateWithOptions($.NSApplicationActivateIgnoringOtherApps))});
      continue;
    }
    try {
      const app = Application(bundle);
      if (host === 'ghostty') {
        for (const window of app.windows()) for (const tab of window.tabs()) for (const terminal of tab.terminals()) {
          let tty = ''; try { tty = terminal.tty() || ''; } catch (_) {}
          const record = { host, appPid, windowId: window.id(), tabId: tab.id(), sessionId: terminal.id(), tty, title: terminal.name(), busy: null };
          if (request.action === 'list') { sessions.push(record); continue; }
          const target = request.target;
          if (record.windowId !== target.windowId || record.tabId !== target.tabId || record.sessionId !== target.sessionId || record.tty !== target.tty) continue;
          if (request.action === 'focus') { app.focus(terminal); return JSON.stringify({ ok: true }); }
        }
        continue;
      }
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
  if (!value || !["terminal", "iterm2", "ghostty", "warp", "wezterm", "kitty", "alacritty"].includes(value.host) || !Number.isSafeInteger(value.appPid) || value.appPid <= 0) return null;
  if (["warp", "wezterm", "kitty", "alacritty"].includes(value.host)) {
    if (value.appOnly !== true) return null;
    return { host: value.host, appPid: value.appPid, appOnly: true, title: typeof value.title === "string" ? value.title.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 160) : "", tty: "", busy: null };
  }
  const ghost = value.host === "ghostty";
  const validId = id => typeof id === "string" && id.length > 0 && id.length <= 160;
  if (ghost ? !validId(value.windowId) || !validId(value.tabId) || !validId(value.sessionId) : !Number.isSafeInteger(value.windowId)) return null;
  const tty = value.tty || "";
  if (typeof tty !== "string" || (tty && !/^\/dev\/[a-z0-9._-]{1,80}$/i.test(tty)) || (!ghost && !tty)) return null;
  if (value.host === "iterm2" && !validId(value.sessionId)) return null;
  return { host: value.host, appPid: value.appPid, windowId: value.windowId, tabId: ghost ? value.tabId : "", tty,
    sessionId: ghost || value.host === "iterm2" ? value.sessionId : "",
    title: typeof value.title === "string" ? value.title.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 160) : "",
    busy: typeof value.busy === "boolean" ? value.busy : null };
}
const identity = r => JSON.stringify([r.host, r.appPid, r.appOnly, r.windowId, r.tabId, r.tty, r.sessionId]);

class ExternalTerminalService {
  constructor({ platform = process.platform, runner = promisify(execFile) } = {}) {
    this.platform = platform; this.runner = runner; this.records = new Map();
    this.scanned = false; this.errors = []; this.inFlight = null; this.scanError = null;
  }
  snapshot() {
    return { available: this.platform === "darwin", scanned: this.scanned, errors: this.errors,
      sessions: [...this.records.values()].map(r => ({ id: r.id, source: "external", host: r.host, appOnly: Boolean(r.appOnly), title: r.title, tty: r.tty, busy: r.busy,
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
      this.errors = (Array.isArray(result.errors) ? result.errors : []).filter(e => ["terminal", "iterm2", "ghostty"].includes(e.host))
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
