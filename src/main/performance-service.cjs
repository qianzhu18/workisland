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

function parseJsonRows(output) {
  try {
    const parsed = JSON.parse(String(output || "[]"));
    return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch {
    return [];
  }
}

function windowsProcessIdentity(row = {}) {
  return `${Number(row.pid) || 0}|${String(row.name || "")}|${String(row.path || "")}|${String(row.startedAt || "")}`;
}

function parseWindowsProcessRows(output = "", { previousSamples = new Map(), elapsedMs = 0, cpuCount = 1, currentPid = process.pid } = {}) {
  return parseJsonRows(output).map((row) => {
    const pid = Number(row.pid);
    const cpuSeconds = Number(row.cpuSeconds) || 0;
    if (!Number.isInteger(pid) || pid <= 0) return null;
    const identity = windowsProcessIdentity(row);
    const previous = previousSamples.get(identity);
    const cpuPct = previous == null || elapsedMs <= 0
      ? 0
      : Math.max(0, Math.round(((cpuSeconds - previous) * 100_000 / elapsedMs / Math.max(1, cpuCount)) * 10) / 10);
    const memoryBytes = Math.max(0, Number(row.memoryBytes) || 0);
    const name = String(row.name || "Process").slice(0, 48);
    return {
      pid,
      uid: -1,
      cpuPct,
      memoryPct: 0,
      memoryBytes,
      name,
      protected: pid === currentPid || /^WorkIsland(?: Helper)?$/i.test(name),
      fingerprint: createHash("sha256").update(identity).digest("hex"),
      identity,
      cpuSeconds
    };
  }).filter(Boolean);
}

function windowsPowerShellPath(env = process.env) {
  return path.win32.join(env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

const WINDOWS_PROCESS_SAMPLE_SCRIPT = [
  "$rows=Get-Process -ErrorAction SilentlyContinue | ForEach-Object {",
  "  try { [pscustomobject]@{pid=$_.Id;name=$_.ProcessName;cpuSeconds=$_.CPU;memoryBytes=$_.WorkingSet64;path=$_.Path;startedAt=$_.StartTime.ToUniversalTime().ToString('o')} } catch {}",
  "}",
  "$rows | ConvertTo-Json -Compress"
].join("\n");

const WINDOWS_PROCESS_OWNER_SCRIPT = [
  "$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:WORKISLAND_TARGET_PID) -ErrorAction SilentlyContinue",
  "if($p){$o=Invoke-CimMethod -InputObject $p -MethodName GetOwner -ErrorAction SilentlyContinue;[pscustomobject]@{pid=$p.ProcessId;name=$p.Name;path=$p.ExecutablePath;startedAt=$p.CreationDate.ToUniversalTime().ToString('o');owner=$o.User}|ConvertTo-Json -Compress}"
].join("; ");

class PerformanceService extends EventEmitter {
  constructor({
    osApi = os,
    execFile = execFileDefault,
    intervalMs = 2e3,
    platform = process.platform,
    env = process.env,
    currentUid = typeof process.getuid === "function" ? process.getuid() : -1,
    currentUsername = os.userInfo().username,
    currentPid = process.pid,
    killProcess = (pid, signal) => process.kill(pid, signal)
  } = {}) {
    super();
    this.osApi = osApi;
    this.execFile = execFile;
    this.intervalMs = intervalMs;
    this.platform = platform;
    this.env = { ...env };
    this.currentUid = currentUid;
    this.currentUsername = currentUsername;
    this.currentPid = currentPid;
    this.killProcess = killProcess;
    this.enabled = true;
    this.detailsVisible = false;
    this.timer = null;
    this.previousCpus = osApi.cpus();
    this.previousWindowsProcesses = new Map();
    this.lastWindowsSampleAt = 0;
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
    if (targetPid === this.currentPid) return { ok: false, reason: "protected" };
    let stdout = "";
    try {
      if (this.platform === "win32") {
        ({ stdout } = await this.execFile(windowsPowerShellPath(this.env), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_PROCESS_OWNER_SCRIPT], {
          windowsHide: true,
          env: { ...this.env, WORKISLAND_TARGET_PID: String(targetPid) }
        }));
      } else {
        ({ stdout } = await this.execFile("/bin/ps", ["-p", String(targetPid), "-o", "uid=,command="]));
      }
    } catch (error) {
      if (error?.code === 1 || error?.code === "ESRCH") return { ok: false, reason: "ended" };
      return { ok: false, reason: "failed" };
    }
    if (this.platform === "win32") {
      const row = parseJsonRows(stdout)[0];
      if (!row) return { ok: false, reason: "ended" };
      if (String(row.owner || "").toLowerCase() !== String(this.currentUsername || "").toLowerCase()) return { ok: false, reason: "permission" };
      const name = String(row.name || "").replace(/\.exe$/i, "");
      if (/^WorkIsland(?: Helper)?$/i.test(name)) return { ok: false, reason: "protected" };
      const currentIdentity = windowsProcessIdentity({ pid: row.pid, name, path: row.path, startedAt: row.startedAt });
      const currentFingerprint = createHash("sha256").update(currentIdentity).digest("hex");
      if (!fingerprint || currentFingerprint !== fingerprint) return { ok: false, reason: "identity-changed" };
    } else {
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
    }
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
    if (this.platform !== "win32") try {
      const pressure = await this.execFile("/usr/bin/memory_pressure", []);
      memoryPressure = parseMemoryPressure(pressure.stdout);
    } catch {}
    if (this.platform !== "win32") try {
      const vm = await this.execFile("/usr/bin/vm_stat", []);
      memoryUsedBytes = parseVmStat(vm.stdout, memoryTotalBytes) ?? memoryUsedBytes;
    } catch {}
    if (this.detailsVisible) {
      try {
        if (this.platform === "win32") {
          const now = Date.now();
          const result = await this.execFile(windowsPowerShellPath(this.env), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_PROCESS_SAMPLE_SCRIPT], { windowsHide: true });
          processes = parseWindowsProcessRows(result.stdout, {
            previousSamples: this.previousWindowsProcesses,
            elapsedMs: this.lastWindowsSampleAt ? now - this.lastWindowsSampleAt : 0,
            cpuCount: cpus.length,
            currentPid: this.currentPid
          });
          this.previousWindowsProcesses = new Map(processes.map((row) => [row.identity, row.cpuSeconds]));
          this.lastWindowsSampleAt = now;
          processes = processes.map(({ identity, cpuSeconds, ...row }) => ({
            ...row,
            memoryPct: memoryTotalBytes ? Math.round(row.memoryBytes / memoryTotalBytes * 1e3) / 10 : 0
          }));
          const memoryPct = memoryTotalBytes ? memoryUsedBytes / memoryTotalBytes * 100 : 0;
          memoryPressure = memoryPct >= 90 ? "critical" : memoryPct >= 75 ? "warning" : "normal";
        } else {
          const result = await this.execFile("/bin/ps", ["-axo", "pid=,uid=,%cpu=,%mem=,rss=,command="]);
          processes = parseProcessRows(result.stdout, { currentUid: this.currentUid });
        }
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

module.exports = {
  calculateCpuUsage,
  parseMemoryPressure,
  parseProcessRows,
  parseVmStat,
  parseWindowsProcessRows,
  windowsProcessIdentity,
  PerformanceService
};
