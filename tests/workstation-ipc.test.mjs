import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { IPC } = require("../src/shared/ipc.cjs");

test("Island preload exposes narrow media and performance contracts", () => {
  const preload = readFileSync(new URL("../src/preload/island.js", import.meta.url), "utf8");
  for (const key of ["MEDIA_GET_STATE", "MEDIA_STATE_UPDATE", "MEDIA_COMMAND", "PERFORMANCE_GET_STATE", "PERFORMANCE_STATE_UPDATE", "PERFORMANCE_DETAILS_VISIBLE"]) {
    assert.equal(typeof IPC[key], "string", `${key} channel must exist`);
  }
  for (const method of ["getMediaState", "onMediaStateUpdate", "mediaCommand", "getPerformanceState", "onPerformanceUpdate", "setPerformanceDetailsVisible"]) {
    assert.match(preload, new RegExp(`${method}\\(`), `${method} must be exposed by preload`);
  }
});
