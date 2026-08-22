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
  assert.deepEqual(parseProcessRows("123 18.2 9.1 Safari Web Content --secret\n456 4.0 2.0 node task.js").slice(0, 1), [
    { pid: 123, cpuPct: 18.2, memoryPct: 9.1, name: "Safari Web Content" }
  ]);
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
