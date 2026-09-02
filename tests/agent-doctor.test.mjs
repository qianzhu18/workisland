import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const {
  AGENT_DOCTOR_STATUS,
  diagnoseReport,
  summarizeDiagnosis
} = require("../src/shared/agent-doctor.cjs");

test("healthy installed report classifies as ok", () => {
  const diagnosis = diagnoseReport({ agentId: "claude", installed: true, available: true, issues: [] });
  assert.equal(diagnosis.status, AGENT_DOCTOR_STATUS.OK);
  assert.equal(diagnosis.repairable, false);
  assert.deepEqual(diagnosis.reasons, []);
});

test("agent not present on machine classifies as not_installed and is not repairable", () => {
  const diagnosis = diagnoseReport({ agentId: "cursor", installed: false, available: false, issues: ["Cursor CLI not found"] });
  assert.equal(diagnosis.status, AGENT_DOCTOR_STATUS.NOT_INSTALLED);
  assert.equal(diagnosis.repairable, false);
});

test("agent present without hook classifies as hook_missing and repairable", () => {
  const diagnosis = diagnoseReport({ agentId: "claude", installed: false, available: true, issues: [] });
  assert.equal(diagnosis.status, AGENT_DOCTOR_STATUS.HOOK_MISSING);
  assert.equal(diagnosis.repairable, true);
});

test("stale hook command from traex classifies as hook_stale", () => {
  const diagnosis = diagnoseReport({
    agentId: "traex",
    installed: true,
    issues: ["Stale hook command: expected --source traex"]
  });
  assert.equal(diagnosis.status, AGENT_DOCTOR_STATUS.HOOK_STALE);
  assert.equal(diagnosis.repairable, true);
  assert.deepEqual(diagnosis.reasons, ["Stale hook command: expected --source traex"]);
});

test("missing hook sections classify as hook_missing", () => {
  for (const issue of [
    "No hooks section found in Claude settings",
    "Codex hooks.json not found",
    "ZCode Hook 尚未连接",
    "Flux plugin not registered in OpenCode config"
  ]) {
    const diagnosis = diagnoseReport({ agentId: "x", installed: true, issues: [issue] });
    assert.equal(diagnosis.status, AGENT_DOCTOR_STATUS.HOOK_MISSING, issue);
    assert.equal(diagnosis.repairable, true, issue);
  }
});

test("zcode hooks disabled classifies as hook_missing", () => {
  const diagnosis = diagnoseReport({ agentId: "zcode", installed: true, issues: ["ZCode hooks.enabled 未启用"] });
  assert.equal(diagnosis.status, AGENT_DOCTOR_STATUS.HOOK_MISSING);
  assert.equal(diagnosis.repairable, true);
});

test("dsh waiting for launch classifies as not_running and is not repairable", () => {
  const diagnosis = diagnoseReport({ agentId: "dsh", installed: false, available: true, issues: ["请先启动 DeepSeek Harness"] });
  assert.equal(diagnosis.status, AGENT_DOCTOR_STATUS.NOT_RUNNING);
  assert.equal(diagnosis.repairable, false);
});

test("unrecognized issues on an installed agent classify as hook_invalid but stay repairable", () => {
  const diagnosis = diagnoseReport({ agentId: "aiden", installed: true, issues: ["Unexpected extra entries"] });
  assert.equal(diagnosis.status, AGENT_DOCTOR_STATUS.HOOK_INVALID);
  assert.equal(diagnosis.repairable, true);
});

test("health check errors are surfaced as error and never repairable", () => {
  const diagnosis = diagnoseReport({ agentId: "codex", installed: false, issues: ["Health check error: EACCES"] });
  assert.equal(diagnosis.status, AGENT_DOCTOR_STATUS.ERROR);
  assert.equal(diagnosis.repairable, false);
});

test("summary counts statuses and collects repairable agent ids", () => {
  const summary = summarizeDiagnosis([
    { agentId: "claude", installed: true, issues: [] },
    { agentId: "traex", installed: true, issues: ["Stale hook command: expected --source traex"] },
    { agentId: "cursor", installed: false, available: false, issues: [] },
    { agentId: "codex", installed: false, available: true, issues: ["Codex hooks.json not found"] },
    { agentId: "dsh", installed: false, available: true, issues: ["请先启动 DeepSeek Harness"] },
    { agentId: "kimi", installed: true, issues: ["Health check error: EACCES"] }
  ]);
  assert.equal(summary.total, 6);
  assert.equal(summary.ok, 1);
  assert.equal(summary.repairable, 2);
  assert.equal(summary.notInstalled, 1);
  assert.equal(summary.blocked, 2);
  assert.deepEqual(summary.repairableAgentIds, ["traex", "codex"]);
});

test("summary handles empty or missing input", () => {
  assert.equal(summarizeDiagnosis([]).total, 0);
  assert.equal(summarizeDiagnosis(null).total, 0);
});

test("null and empty issues never crash diagnosis", () => {
  assert.equal(diagnoseReport({ agentId: "gemini", installed: true, issues: [null, ""] }).status, AGENT_DOCTOR_STATUS.OK);
  assert.equal(diagnoseReport(null).status, AGENT_DOCTOR_STATUS.HOOK_MISSING);
});
