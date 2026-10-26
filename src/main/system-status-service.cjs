"use strict";

const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");
const { DownloadMonitor } = require("./download-monitor.cjs");

const FEATURE_SETTINGS = Object.freeze({ battery: "systemBatteryEnabled", network: "systemNetworkEnabled", audio: "systemAudioEnabled", capture: "systemCaptureEnabled", downloads: "systemDownloadsEnabled", lockScreen: "systemLockScreenEnabled" });
const number = (value, max = 100000) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
const text = (value, limit = 160) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, limit) : "";
function emptyCapability(kind, enabled = true) {
  const base = { available: false, enabled };
  if (kind === "battery") return { ...base, present: false, percent: null, charging: false, externalConnected: false, chargingWatts: null, inputWatts: null, adapterWatts: null };
  if (kind === "network") return { ...base, connected: null, type: "unknown", name: "", expensive: false };
  if (kind === "audio") return { ...base, devices: [], activeDeviceId: null };
  if (kind === "downloads") return { ...base, active: false, items: [], speedBytesPerSecond: null, lastEvent: null, error: null };
  return { ...base, active: false };
}
function normalizeCapability(kind, value, enabled) {
  if (!enabled || !value || value.available !== true) return emptyCapability(kind, enabled);
  const base = { available: true, enabled: true };
  if (kind === "battery") return { ...base, present: value.present === true, percent: number(value.percent, 100), charging: value.charging === true, externalConnected: value.externalConnected === true,
    chargingWatts: value.charging === true && value.externalConnected === true ? number(value.chargingWatts, 1000) : null,
    inputWatts: value.externalConnected === true ? number(value.inputWatts, 1000) : null, adapterWatts: number(value.adapterWatts, 1000) };
  if (kind === "network") return { ...base, connected: typeof value.connected === "boolean" ? value.connected : null, type: ["wifi", "ethernet", "cellular", "other", "none"].includes(value.type) ? value.type : "unknown", name: text(value.name), expensive: value.expensive === true };
  if (kind === "audio") return { ...base, activeDeviceId: value.activeDeviceId == null ? null : text(String(value.activeDeviceId), 80),
    devices: (Array.isArray(value.devices) ? value.devices : []).slice(0, 32).map(device => ({ id: text(String(device.id), 80), name: text(device.name), transport: text(device.transport, 40), connected: device.connected !== false, batteryPercent: number(device.batteryPercent, 100) })) };
  if (kind === "downloads") return { ...base, active: value.active === true, items: (Array.isArray(value.items) ? value.items : []).slice(0, 32).map(item => ({ id: text(item.id), name: text(item.name), bytes: number(item.bytes, Number.MAX_SAFE_INTEGER), speedBytesPerSecond: number(item.speedBytesPerSecond, Number.MAX_SAFE_INTEGER) })), speedBytesPerSecond: number(value.speedBytesPerSecond, Number.MAX_SAFE_INTEGER),
    lastEvent: value.lastEvent && ["completed", "cancelled"].includes(value.lastEvent.kind) ? { id: text(value.lastEvent.id), kind: value.lastEvent.kind, name: text(value.lastEvent.name), at: number(value.lastEvent.at, Number.MAX_SAFE_INTEGER) } : null, error: text(value.error) || null };
  return { ...base, active: value.active === true };
}

class SystemStatusService extends EventEmitter {
  constructor({ helperPath, downloadsDirectory, settings = {}, platform = process.platform, spawnFn = spawn, downloadMonitor, logger = console } = {}) {
    super();
    this.helperPath = helperPath; this.platform = platform; this.spawnFn = spawnFn; this.logger = logger;
    this.settings = { ...settings }; this.running = false; this.child = null; this.generation = 0; this.retryTimer = null; this.retryCount = 0;
    this.monitor = downloadMonitor || new DownloadMonitor({ directory: downloadsDirectory });
    this.state = { ...Object.fromEntries(Object.keys(FEATURE_SETTINGS).map(kind => [kind, emptyCapability(kind, this.enabled(kind))])), locked: false, notice: null, nativeError: null };
    this.monitor.on("update", value => {
      if (!this.running) return;
      const lastId = this.state.downloads.lastEvent?.id;
      const wasActive = this.state.downloads.active;
      this.state.downloads = normalizeCapability("downloads", value, this.enabled("downloads"));
      if (this.state.downloads.lastEvent && this.state.downloads.lastEvent.id !== lastId) this.state.notice = { kind: `download-${value.lastEvent.kind}`, name: text(value.lastEvent.name), at: Date.now() };
      if (!wasActive && this.state.downloads.active) this.state.notice = { kind: "download-started", at: Date.now() };
      this.publish();
    });
  }
  enabled(kind) {
    if (this.platform !== "darwin") return false;
    return kind === "lockScreen" ? this.settings[FEATURE_SETTINGS[kind]] === true : this.settings[FEATURE_SETTINGS[kind]] !== false;
  }
  getSnapshot() { return structuredClone(this.state); }
  publish() { this.emit("update", this.getSnapshot()); }
  configure(settings) {
    this.settings = { ...this.settings, ...settings };
    for (const kind of Object.keys(FEATURE_SETTINGS)) {
      if (!this.enabled(kind)) this.state[kind] = emptyCapability(kind, false);
      else this.state[kind] = { ...this.state[kind], enabled: true };
    }
    this.monitor.setEnabled(this.running && this.enabled("downloads"));
    if (this.running && this.platform === "darwin" && !this.child) this.launch();
    this.sendConfiguration(); this.publish();
  }
  sendConfiguration() { this.send({ type: "configure", enabled: Object.fromEntries(Object.keys(FEATURE_SETTINGS).map(kind => [kind, this.enabled(kind)])), locale: this.settings.language === "en" ? "en" : "zh-CN" }); }
  send(payload) {
    if (!this.child?.stdin?.writable || this.child.stdin.writableLength > 65536) return false;
    try { return this.child.stdin.write(JSON.stringify(payload) + "\n"); } catch { return false; }
  }
  setMedia(state) {
    this.media = state;
    const payload = { type: "lockContent", title: this.settings.mediaEnabled !== false && state?.active ? text(state.title, 120) : "", subtitle: this.settings.mediaEnabled !== false && state?.active ? text(state.artist, 120) : "" };
    const key = JSON.stringify(payload);
    if (this.lastLockContent !== key && this.send(payload)) this.lastLockContent = key;
  }
  previewLockScreen() { return this.platform === "darwin" && !!this.child && this.state.lockScreen.available && this.send({ type: "previewLockScreen" }); }
  start() {
    if (this.running) return;
    this.running = true;
    this.monitor.setEnabled(this.enabled("downloads"));
    this.monitor.start();
    if (this.platform === "darwin") this.launch();
  }
  launch() {
    if (!this.running || this.child || !this.helperPath) return;
    clearTimeout(this.retryTimer); this.retryTimer = null;
    const generation = ++this.generation;
    let child;
    try { child = this.spawnFn(this.helperPath, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }); }
    catch (error) { this.fail(error.message); this.scheduleRetry(); return; }
    this.child = child;
    this.lastLockContent = null;
    const decoder = new StringDecoder("utf8"); let pending = ""; let failed = false;
    const fail = reason => {
      if (generation !== this.generation || failed) return;
      failed = true; this.child = null; ++this.generation;
      try { child.kill(); } catch {}
      this.fail(reason); this.scheduleRetry();
    };
    child.on("error", error => fail(error.message));
    child.stdin.on("error", error => fail(error.message));
    child.on("exit", () => fail("native-helper-exited"));
    child.stderr.on("data", () => {});
    child.stdout.on("data", chunk => {
      if (!this.running || generation !== this.generation) return;
      pending += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      let newline;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        if (Buffer.byteLength(line) > 65536) { fail("native-message-too-large"); return; }
        try {
          const message = JSON.parse(line);
          if (message?.type === "snapshot" && message.state && typeof message.state === "object") { this.acceptNative(message.state); this.retryCount = 0; }
        } catch { /* Ignore one malformed frame; never let helper output crash the app. */ }
      }
      if (Buffer.byteLength(pending) > 65536) fail("native-message-too-large");
    });
    this.sendConfiguration(); this.setMedia(this.media);
  }
  acceptNative(value) {
    const previous = this.state;
    const next = { ...previous, nativeError: null, locked: value.locked === true };
    for (const kind of ["battery", "network", "audio", "capture", "lockScreen"]) next[kind] = normalizeCapability(kind, value[kind], this.enabled(kind));
    let notice = null;
    if (previous.battery.available && next.battery.available && previous.battery.externalConnected !== next.battery.externalConnected) notice = { kind: next.battery.externalConnected ? "power-connected" : "power-disconnected" };
    if (previous.network.available && next.network.available && (previous.network.connected !== next.network.connected || previous.network.name !== next.network.name || previous.network.type !== next.network.type)) notice = { kind: next.network.connected ? "network-connected" : "network-disconnected", name: next.network.name };
    const previousAudio = previous.audio.devices.find(device => device.id === previous.audio.activeDeviceId);
    const nextAudio = next.audio.devices.find(device => device.id === next.audio.activeDeviceId);
    if (previous.audio.available && next.audio.available) {
      const before = previous.audio.devices.filter(device => device.transport === "bluetooth");
      const after = next.audio.devices.filter(device => device.transport === "bluetooth");
      const connected = after.find(device => !before.some(old => old.name === device.name));
      const disconnected = before.find(device => !after.some(current => current.name === device.name));
      if (connected) notice = { kind: "audio-connected", name: connected.name };
      else if (disconnected) notice = { kind: "audio-disconnected", name: disconnected.name };
    }
    if (previous.audio.available && next.audio.available && (previous.audio.activeDeviceId !== next.audio.activeDeviceId || previousAudio?.name !== nextAudio?.name)) notice = { kind: "audio-changed", name: nextAudio?.name || "" };
    if (previous.capture.available && next.capture.available && previous.capture.active !== next.capture.active) notice = { kind: next.capture.active ? "capture-started" : "capture-stopped" };
    if (notice) next.notice = { ...notice, at: Date.now() };
    this.state = next; this.publish();
  }
  fail(reason) {
    for (const kind of ["battery", "network", "audio", "capture", "lockScreen"]) this.state[kind] = emptyCapability(kind, this.enabled(kind));
    this.state.locked = false; this.state.nativeError = text(reason); this.publish();
  }
  scheduleRetry() {
    if (!this.running || this.retryTimer) return;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.retryCount++, 5));
    this.retryTimer = setTimeout(() => { this.retryTimer = null; this.launch(); }, delay); this.retryTimer.unref?.();
  }
  stop() {
    this.running = false; ++this.generation; clearTimeout(this.retryTimer); this.retryTimer = null;
    this.monitor.stop();
    const child = this.child; this.child = null;
    try { child?.stdin.end(); child?.kill(); } catch {}
    for (const kind of Object.keys(FEATURE_SETTINGS)) this.state[kind] = emptyCapability(kind, this.enabled(kind));
    this.state.locked = false; this.state.notice = null;
  }
}
module.exports = { SystemStatusService, FEATURE_SETTINGS, normalizeCapability };
