import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatProcessMemory,
  preferredProcessMetric,
  sortProcessesByMetric
} from "../src/renderer/island/components/performance-process-model.mjs";

test("memory becomes the preferred process metric under memory pressure", () => {
  assert.equal(preferredProcessMetric({ cpuPct: 12, memoryPct: 60, memoryPressure: "normal" }), "cpu");
  assert.equal(preferredProcessMetric({ cpuPct: 12, memoryPct: 76, memoryPressure: "normal" }), "memory");
  assert.equal(preferredProcessMetric({ cpuPct: 90, memoryPct: 50, memoryPressure: "warning" }), "memory");
  assert.equal(preferredProcessMetric({ cpuPct: 90, memoryPct: 50, memoryPressure: "critical" }), "memory");
});

test("processes sort by the selected metric without mutating the sample", () => {
  const source = [
    { pid: 1, cpuPct: 80, memoryBytes: 100 },
    { pid: 2, cpuPct: 10, memoryBytes: 900 }
  ];

  assert.deepEqual(sortProcessesByMetric(source, "cpu").map((row) => row.pid), [1, 2]);
  assert.deepEqual(sortProcessesByMetric(source, "memory").map((row) => row.pid), [2, 1]);
  assert.deepEqual(source.map((row) => row.pid), [1, 2]);
});

test("resident memory uses compact human-readable units", () => {
  assert.equal(formatProcessMemory(0), "0 MB");
  assert.equal(formatProcessMemory(384 * 1024 * 1024), "384 MB");
  assert.equal(formatProcessMemory(1536 * 1024 * 1024), "1.5 GB");
});
