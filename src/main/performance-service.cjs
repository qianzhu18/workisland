"use strict";

const { EventEmitter } = require("node:events");
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

function parseProcessRows(output = "") {
  return String(output).split(/\r?\n/).map((line) => {
    const match = line.trim().match(/^(\d+)\s+([\d.]+)\s+([\d.]+)\s+(.+)$/);
    if (!match) return null;
    let name = match[4].split(/\s+--/)[0].trim();
    if (name.startsWith("/")) name = path.basename(name);
    return { pid: Number(match[1]), cpuPct: Number(match[2]), memoryPct: Number(match[3]), name: name.slice(0, 48) };
  }).filter(Boolean).sort((a, b) => b.cpuPct - a.cpuPct).slice(0, 5);
}

class PerformanceService extends EventEmitter {
  constructor({ osApi = os, execFile = execFileDefault, intervalMs = 2e3 } = {}) {
    super();
    this.osApi = osApi;
    this.execFile = execFile;
    this.intervalMs = intervalMs;
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
        const result = await this.execFile("/bin/ps", ["-axo", "pid=,%cpu=,%mem=,command="]);
        processes = parseProcessRows(result.stdout);
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
