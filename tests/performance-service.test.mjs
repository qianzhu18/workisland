import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { calculateCpuUsage, parseMemoryPressure, parseProcessRows, parseVmStat, PerformanceService } = require("../src/main/performance-service.cjs");

test("performance helpers calculate bounded CPU and safe process rows", () => {
  const previous = [{ times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 } }];
  const current = [{ times: { user: 200, nice: 0, sys: 100, idle: 900, irq: 0 } }];
  assert.equal(calculateCpuUsage(previous, current), 75);
  assert.equal(parseMemoryPressure("System-wide memory free percentage: 42%"), "normal");
  assert.equal(parseMemoryPressure("System-wide memory free percentage: 7%"), "critical");
  assert.equal(parseVmStat("Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages active: 100.\nPages wired down: 25.\nPages occupied by compressor: 10.", 4_000_000), 2_211_840);
  const row = parseProcessRows("123 18.2 9.1 Safari Web Content --secret\n456 4.0 2.0 node task.js")[0];
  assert.deepEqual({ pid: row.pid, cpuPct: row.cpuPct, memoryPct: row.memoryPct, name: row.name },
    { pid: 123, cpuPct: 18.2, memoryPct: 9.1, name: "Safari Web Content" });
  assert.match(row.fingerprint, /^[a-f0-9]{64}$/);
});

function processActionService({ command = "/Applications/Safari.app/Contents/MacOS/Safari", uid = 501, killError } = {}) {
  const signals = [];
  const service = new PerformanceService({
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
  const sampled = parseProcessRows(`321 50.0 2.0 ${command}`)[0];
  const { service, signals, refreshed } = processActionService({ command });

  assert.deepEqual(await service.actOnProcess({ ...sampled, action: "terminate" }), { ok: true, reason: "signaled" });
  assert.deepEqual(await service.actOnProcess({ ...sampled, action: "force" }), { ok: true, reason: "signaled" });
  assert.deepEqual(signals, [[321, "SIGTERM"], [321, "SIGKILL"]]);
  assert.equal(refreshed(), 2);
});

test("performance service rejects protected, foreign, and changed processes", async () => {
  const normal = parseProcessRows("321 50.0 2.0 /Applications/Safari.app/Contents/MacOS/Safari")[0];
  const workIsland = parseProcessRows("444 50.0 2.0 /Applications/WorkIsland.app/Contents/MacOS/WorkIsland")[0];

  assert.equal((await processActionService().service.actOnProcess({ ...normal, pid: 1, action: "force" })).reason, "protected");
  assert.equal((await processActionService({ uid: 0 }).service.actOnProcess({ ...normal, action: "force" })).reason, "permission");
  assert.equal((await processActionService({ command: "/Applications/Other.app/Contents/MacOS/Other" }).service.actOnProcess({ ...normal, action: "force" })).reason, "identity-changed");
  assert.equal((await processActionService({ command: "/Applications/WorkIsland.app/Contents/MacOS/WorkIsland" }).service.actOnProcess({ ...workIsland, action: "force" })).reason, "protected");
});

test("performance service only samples process details while visible", async () => {
  let detailCalls = 0;
  const service = new PerformanceService({
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
