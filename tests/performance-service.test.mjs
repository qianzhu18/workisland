import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { calculateCpuUsage, parseMemoryPressure, parseProcessRows, parseVmStat, parseWindowsProcessRows, PerformanceService } = require("../src/main/performance-service.cjs");

test("performance helpers calculate bounded CPU and safe process rows", () => {
  const previous = [{ times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 } }];
  const current = [{ times: { user: 200, nice: 0, sys: 100, idle: 900, irq: 0 } }];
  assert.equal(calculateCpuUsage(previous, current), 75);
  assert.equal(parseMemoryPressure("System-wide memory free percentage: 42%"), "normal");
  assert.equal(parseMemoryPressure("System-wide memory free percentage: 7%"), "critical");
  assert.equal(parseVmStat("Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages active: 100.\nPages wired down: 25.\nPages occupied by compressor: 10.", 4_000_000), 2_211_840);
  const rows = parseProcessRows([
    "123 501 18.2 9.1 1048576 Safari Web Content --secret",
    "456 501 4.0 2.0 65536 node task.js",
    "789 0 99.0 4.0 32768 WindowServer -daemon"
  ].join("\n"), { currentUid: 501 });
  const row = rows[0];
  assert.deepEqual({ pid: row.pid, uid: row.uid, cpuPct: row.cpuPct, memoryPct: row.memoryPct, memoryBytes: row.memoryBytes, name: row.name },
    { pid: 123, uid: 501, cpuPct: 18.2, memoryPct: 9.1, memoryBytes: 1073741824, name: "Safari Web Content" });
  assert.deepEqual(rows.map((process) => process.pid), [123, 456], "foreign processes are excluded");
  assert.match(row.fingerprint, /^[a-f0-9]{64}$/);
});

test("process parsing keeps every current-user row and marks WorkIsland protected", () => {
  const lines = Array.from({ length: 7 }, (_, index) => `${100 + index} 501 ${20 - index}.0 ${index}.0 ${1024 + index} /Applications/App${index}.app/Contents/MacOS/App${index}`);
  lines.push("999 501 1.0 1.0 2048 /Applications/WorkIsland.app/Contents/MacOS/WorkIsland");

  const rows = parseProcessRows(lines.join("\n"), { currentUid: 501 });

  assert.equal(rows.length, 8);
  assert.equal(rows.at(-1).protected, true);
});

function processActionService({ command = "/Applications/Safari.app/Contents/MacOS/Safari", uid = 501, killError } = {}) {
  const signals = [];
  const service = new PerformanceService({
    platform: "darwin",
    currentUid: 501,
    killProcess(pid, signal) {
      if (killError) throw killError;
      signals.push([pid, signal]);
    },
    execFile: async (file, args) => {
      if (file === "/bin/ps" && args.includes("-p")) return { stdout: `${uid} ${command}\n` };
      return { stdout: "" };
    }
  });
  let refreshed = 0;
  service.sample = async () => { refreshed += 1; };
  return { service, signals, refreshed: () => refreshed };
}

test("performance service sends TERM and KILL only to the sampled owned process", async () => {
  const command = "/Applications/Safari.app/Contents/MacOS/Safari";
  const sampled = parseProcessRows(`321 501 50.0 2.0 4096 ${command}`, { currentUid: 501 })[0];
  const { service, signals, refreshed } = processActionService({ command });

  assert.deepEqual(await service.actOnProcess({ ...sampled, action: "terminate" }), { ok: true, reason: "signaled" });
  assert.deepEqual(await service.actOnProcess({ ...sampled, action: "force" }), { ok: true, reason: "signaled" });
  assert.deepEqual(signals, [[321, "SIGTERM"], [321, "SIGKILL"]]);
  assert.equal(refreshed(), 2);
});

test("performance service rejects protected, foreign, and changed processes", async () => {
  const normal = parseProcessRows("321 501 50.0 2.0 4096 /Applications/Safari.app/Contents/MacOS/Safari", { currentUid: 501 })[0];
  const workIsland = parseProcessRows("444 501 50.0 2.0 4096 /Applications/WorkIsland.app/Contents/MacOS/WorkIsland", { currentUid: 501 })[0];

  assert.equal((await processActionService().service.actOnProcess({ ...normal, pid: 1, action: "force" })).reason, "protected");
  assert.equal((await processActionService({ uid: 0 }).service.actOnProcess({ ...normal, action: "force" })).reason, "permission");
  assert.equal((await processActionService({ command: "/Applications/Other.app/Contents/MacOS/Other" }).service.actOnProcess({ ...normal, action: "force" })).reason, "identity-changed");
  assert.equal((await processActionService({ command: "/Applications/WorkIsland.app/Contents/MacOS/WorkIsland" }).service.actOnProcess({ ...workIsland, action: "force" })).reason, "protected");
});

test("performance service only samples process details while visible", async () => {
  let detailCalls = 0;
  const service = new PerformanceService({
    platform: "darwin",
    osApi: {
      cpus: () => [{ times: { user: 10, nice: 0, sys: 10, idle: 80, irq: 0 } }],
      totalmem: () => 100,
      freemem: () => 40
    },
    execFile: async (file) => {
      if (file.endsWith("ps")) detailCalls += 1;
      return { stdout: "" };
    }
  });
  await service.sample();
  assert.equal(detailCalls, 0);
  service.setDetailsVisible(true);
  await service.sample();
  assert.ok(detailCalls >= 1);
});

test("performance service republishes cached process details before refresh completes", async () => {
  let processSample = 0;
  let resolveRefresh;
  const refreshPending = new Promise((resolve) => { resolveRefresh = resolve; });
  const service = new PerformanceService({
    platform: "darwin",
    currentUid: 501,
    osApi: {
      cpus: () => [{ times: { user: 10, nice: 0, sys: 10, idle: 80, irq: 0 } }],
      totalmem: () => 100,
      freemem: () => 40
    },
    execFile: async (file) => {
      if (file !== "/bin/ps") return { stdout: "" };
      processSample += 1;
      if (processSample === 1) {
        return { stdout: "321 501 12.0 4.0 4096 /Applications/Safari.app/Contents/MacOS/Safari" };
      }
      await refreshPending;
      return { stdout: "654 501 8.0 3.0 2048 /Applications/Mail.app/Contents/MacOS/Mail" };
    }
  });

  service.detailsVisible = true;
  await service.sample();
  service.setDetailsVisible(false);
  await service.sample();
  assert.deepEqual(service.getSnapshot().processes, []);

  service.setDetailsVisible(true);
  assert.deepEqual(service.getSnapshot().processes.map((process) => process.pid), [321]);
  assert.equal(service.getSnapshot().processesLoading, true);

  resolveRefresh();
  await new Promise((resolve) => setImmediate(resolve));
});

test("performance service preserves cached process details when refresh fails", async () => {
  let failProcessRefresh = false;
  const service = new PerformanceService({
    platform: "darwin",
    currentUid: 501,
    osApi: {
      cpus: () => [{ times: { user: 10, nice: 0, sys: 10, idle: 80, irq: 0 } }],
      totalmem: () => 100,
      freemem: () => 40
    },
    execFile: async (file) => {
      if (file !== "/bin/ps") return { stdout: "" };
      if (failProcessRefresh) throw new Error("ps failed");
      return { stdout: "321 501 12.0 4.0 4096 /Applications/Safari.app/Contents/MacOS/Safari" };
    }
  });

  service.detailsVisible = true;
  await service.sample();
  failProcessRefresh = true;
  await service.sample();

  assert.deepEqual(service.getSnapshot().processes.map((process) => process.pid), [321]);
  assert.equal(service.getSnapshot().processesLoading, false);
});

test("a hidden sample finishing late does not cancel a newly opened detail load", async () => {
  let pressureCall = 0;
  let resolveHiddenPressure;
  let resolveVisibleProcesses;
  const hiddenPressurePending = new Promise((resolve) => { resolveHiddenPressure = resolve; });
  const visibleProcessesPending = new Promise((resolve) => { resolveVisibleProcesses = resolve; });
  const service = new PerformanceService({
    platform: "darwin",
    currentUid: 501,
    osApi: {
      cpus: () => [{ times: { user: 10, nice: 0, sys: 10, idle: 80, irq: 0 } }],
      totalmem: () => 100,
      freemem: () => 40
    },
    execFile: async (file) => {
      if (file === "/usr/bin/memory_pressure") {
        pressureCall += 1;
        if (pressureCall === 1) await hiddenPressurePending;
        return { stdout: "" };
      }
      if (file === "/bin/ps") {
        await visibleProcessesPending;
        return { stdout: "321 501 12.0 4.0 4096 /Applications/Safari.app/Contents/MacOS/Safari" };
      }
      return { stdout: "" };
    }
  });

  const hiddenSample = service.sample();
  service.setDetailsVisible(true);
  assert.equal(service.getSnapshot().processesLoading, true);

  resolveHiddenPressure();
  await hiddenSample;
  assert.equal(service.getSnapshot().processesLoading, true);

  resolveVisibleProcesses();
  await new Promise((resolve) => setImmediate(resolve));
});

test("Windows process rows calculate CPU deltas and protect WorkIsland", () => {
  const firstJson = JSON.stringify([
    { pid: 321, name: "Player", cpuSeconds: 10, memoryBytes: 1_000, path: "C:\\Player.exe", startedAt: "2026-01-01T00:00:00.000Z" },
    { pid: 999, name: "WorkIsland", cpuSeconds: 2, memoryBytes: 2_000, path: "C:\\WorkIsland.exe", startedAt: "2026-01-01T00:00:00.000Z" }
  ]);
  const first = parseWindowsProcessRows(firstJson, { currentPid: 999, cpuCount: 2 });
  const previousSamples = new Map(first.map((row) => [row.identity, row.cpuSeconds]));
  const second = parseWindowsProcessRows(firstJson.replace('"cpuSeconds":10', '"cpuSeconds":11'), {
    previousSamples, elapsedMs: 1_000, cpuCount: 2, currentPid: 999
  });
  assert.equal(second[0].cpuPct, 50);
  assert.equal(second[1].protected, true);
  assert.match(second[0].fingerprint, /^[a-f0-9]{64}$/);
});

test("Windows performance sampling uses PowerShell only when process details are visible", async () => {
  let calls = 0;
  const service = new PerformanceService({
    platform: "win32",
    currentPid: 999,
    osApi: {
      cpus: () => [{ times: { user: 10, nice: 0, sys: 10, idle: 80, irq: 0 } }],
      totalmem: () => 100,
      freemem: () => 40
    },
    execFile: async () => { calls += 1; return { stdout: "[]" }; }
  });
  await service.sample();
  assert.equal(calls, 0);
  service.detailsVisible = true;
  await service.sample();
  assert.equal(calls, 1);
});
