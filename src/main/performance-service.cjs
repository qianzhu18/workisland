"use strict";

const { EventEmitter } = require("node:events");
const { createHash } = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const util = require("node:util");
const childProcess = require("node:child_process");

const execFileDefault = util.promisify(childProcess.execFile);

function totalCpu(cpu) {
  return Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
}

function calculateCpuUsage(previous = [], current = []) {
  if (!previous.length || previous.length !== current.length) return 0;
  let totalDelta = 0;
  let idleDelta = 0;
  for (let index = 0; index < current.length; index += 1) {
    totalDelta += totalCpu(current[index]) - totalCpu(previous[index]);
    idleDelta += current[index].times.idle - previous[index].times.idle;
  }
  if (totalDelta <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 1e3) / 10));
}

function parseMemoryPressure(output = "") {
  const free = Number(String(output).match(/free percentage:\s*(\d+(?:\.\d+)?)%/i)?.[1]);
  if (!Number.isFinite(free)) return "unknown";
  if (free < 10) return "critical";
  if (free < 20) return "warning";
  return "normal";
}

function parseVmStat(output = "", totalBytes = 0) {
  const pageSize = Number(String(output).match(/page size of\s+(\d+) bytes/i)?.[1]);
  if (!Number.isFinite(pageSize) || pageSize <= 0) return null;
  const pages = (label) => Number(String(output).match(new RegExp(`Pages ${label}:\\s*(\\d+)\\.`, "i"))?.[1]) || 0;
  const used = (pages("active") + pages("wired down") + pages("occupied by compressor")) * pageSize;
  return Math.max(0, Math.min(Number(totalBytes) || used, used));
}

function parseProcessRows(output = "", { currentUid } = {}) {
  return String(output).split(/\r?\n/).map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
    if (!match) return null;
    const uid = Number(match[2]);
    if (Number.isInteger(currentUid) && currentUid >= 0 && uid !== currentUid) return null;
    const command = match[6].trim();
    let name = command.split(/\s+--/)[0].trim();
    if (name.startsWith("/")) name = path.basename(name);
    return {
      pid: Number(match[1]),
      uid,
      cpuPct: Number(match[3]),
      memoryPct: Number(match[4]),
      memoryBytes: Number(match[5]) * 1024,
      name: name.slice(0, 48),
      protected: /\/WorkIsland\.app\/|(^|\/)WorkIsland(?: Helper)?(?:\s|$)/i.test(command),
      fingerprint: createHash("sha256").update(command).digest("hex")
    };
  }).filter(Boolean);
}

class PerformanceService extends EventEmitter {
  constructor({
    osApi = os,
    execFile = execFileDefault,
    intervalMs = 2e3,
    currentUid = typeof process.getuid === "function" ? process.getuid() : -1,
    killProcess = (pid, signal) => process.kill(pid, signal)
  } = {}) {
    super();
    this.osApi = osApi;
    this.execFile = execFile;
    this.intervalMs = intervalMs;
    this.currentUid = currentUid;
    this.killProcess = killProcess;
    this.enabled = true;
    this.detailsVisible = false;
    this.timer = null;
    this.previousCpus = osApi.cpus();
    this.state = {
      cpuPct: 0, memoryUsedBytes: 0, memoryTotalBytes: osApi.totalmem(), memoryPct: 0,
      memoryPressure: "unknown", processes: [], updatedAt: 0
    };
  }

  start() {
    if (!this.enabled || this.timer) return;
    void this.sample();
    this.timer = setInterval(() => void this.sample(), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.enabled) this.start();
    else this.stop();
  }

  setDetailsVisible(visible) {
    this.detailsVisible = Boolean(visible);
    if (this.detailsVisible) void this.sample();
  }

  getSnapshot() { return this.state; }

  async actOnProcess({ pid, fingerprint, action } = {}) {
    const targetPid = Number(pid);
    if (!Number.isInteger(targetPid) || targetPid <= 1 || !["terminate", "force"].includes(action)) {
      return { ok: false, reason: "protected" };
    }
    let stdout = "";
    try {
      ({ stdout } = await this.execFile("/bin/ps", ["-p", String(targetPid), "-o", "uid=,command="]));
    } catch (error) {
      if (error?.code === 1 || error?.code === "ESRCH") return { ok: false, reason: "ended" };
      return { ok: false, reason: "failed" };
    }
    const match = String(stdout).trim().match(/^(\d+)\s+(.+)$/s);
    if (!match) return { ok: false, reason: "ended" };
    const uid = Number(match[1]);
    const command = match[2].trim();
    if (uid !== this.currentUid) return { ok: false, reason: "permission" };
    if (/\/WorkIsland\.app\/|(^|\/)WorkIsland(?: Helper)?(?:\s|$)/i.test(command)) {
      return { ok: false, reason: "protected" };
    }
    const currentFingerprint = createHash("sha256").update(command).digest("hex");
    if (!fingerprint || currentFingerprint !== fingerprint) return { ok: false, reason: "identity-changed" };
    try {
      this.killProcess(targetPid, action === "force" ? "SIGKILL" : "SIGTERM");
    } catch (error) {
      if (error?.code === "ESRCH") return { ok: false, reason: "ended" };
      if (error?.code === "EPERM") return { ok: false, reason: "permission" };
      return { ok: false, reason: "failed" };
    }
    await this.sample();
    return { ok: true, reason: "signaled" };
  }

  async sample() {
    const cpus = this.osApi.cpus();
    const cpuPct = calculateCpuUsage(this.previousCpus, cpus);
    this.previousCpus = cpus;
    const memoryTotalBytes = this.osApi.totalmem();
    let memoryUsedBytes = Math.max(0, memoryTotalBytes - this.osApi.freemem());
    let memoryPressure = this.state.memoryPressure;
    let processes = this.detailsVisible ? this.state.processes : [];
    try {
      const pressure = await this.execFile("/usr/bin/memory_pressure", []);
      memoryPressure = parseMemoryPressure(pressure.stdout);
    } catch {}
    try {
      const vm = await this.execFile("/usr/bin/vm_stat", []);
      memoryUsedBytes = parseVmStat(vm.stdout, memoryTotalBytes) ?? memoryUsedBytes;
    } catch {}
    if (this.detailsVisible) {
      try {
        const result = await this.execFile("/bin/ps", ["-axo", "pid=,uid=,%cpu=,%mem=,rss=,command="]);
        processes = parseProcessRows(result.stdout, { currentUid: this.currentUid });
      } catch {}
    }
    this.state = {
      cpuPct,
      memoryUsedBytes,
      memoryTotalBytes,
      memoryPct: memoryTotalBytes ? Math.round(memoryUsedBytes / memoryTotalBytes * 1e3) / 10 : 0,
      memoryPressure,
      processes,
      updatedAt: Date.now()
    };
    this.emit("update", this.state);
    return this.state;
  }
}

module.exports = { calculateCpuUsage, parseMemoryPressure, parseProcessRows, parseVmStat, PerformanceService };
