import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { EventEmitter } from "node:events";

const require = createRequire(import.meta.url);
const { diagnoseReport } = require("../src/shared/agent-doctor.cjs");

// PR2 修复流程的纯逻辑验证：用最小 fake coordinator 复刻 repairHook /
// repairAllHooks / runStartupDoctor 的判定语义（与 app-coordinator 同源逻辑），
// 避免在单测里实例化 Electron AppCoordinator。

function createFakeCoordinator({ managers, settings = {} } = {}) {
  const audit = [];
  return {
    settings,
    audit,
    recordDoctorAudit(entry) {
      audit.push(entry);
      if (audit.length > 50) audit.splice(0, audit.length - 50);
    },
    getDoctorAudit() {
      return [...audit];
    },
    async repairHook(agentId) {
      const manager = managers.get(agentId);
      if (!manager) return { success: false, error: `未知的 agent: ${agentId}`, errorCode: "NOT_FOUND" };
      const before = await manager.checkHealth().catch(() => null);
      try {
        await manager.install({});
      } catch (err) {
        return { success: false, error: String(err) };
      }
      const after = await manager.checkHealth().catch(() => null);
      const remainingIssues = (after?.issues || []).filter(Boolean);
      const entry = {
        agentId,
        action: "repair",
        issuesBefore: (before?.issues || []).filter(Boolean),
        issuesAfter: remainingIssues,
        resolved: remainingIssues.length === 0
      };
      this.recordDoctorAudit(entry);
      return { success: true, resolved: entry.resolved };
    },
    async repairAllHooks() {
      const results = [];
      for (const agentId of managers.keys()) {
        const health = await managers.get(agentId).checkHealth().catch(() => null);
        const diagnosis = diagnoseReport({ ...health, agentId });
        if (!diagnosis.repairable) continue;
        results.push({ agentId, ...(await this.repairHook(agentId)) });
      }
      return results;
    },
    async runStartupDoctor() {
      if (settings.agentDoctorStartup === false) return null;
      const results = await this.repairAllHooks();
      const repaired = results.filter((r) => r.success);
      if (repaired.length) settings.doctorLastAutoRepair = { at: new Date().toISOString(), agents: repaired.map((r) => r.agentId) };
      return repaired;
    }
  };
}

function manager({ installed, issues, available = true, failInstall = false } = {}) {
  let state = { installed, issues: [...issues] };
  return {
    async checkHealth() { return { ...state, available }; },
    async install() {
      if (failInstall) throw new Error("EACCES: permission denied");
      state = { installed: true, issues: [] };
    }
  };
}

test("repairHook rewrites via install, rescans, and records an audit entry", async () => {
  const traex = manager({ installed: true, issues: ["Stale hook command: expected --source traex"] });
  const c = createFakeCoordinator({ managers: new Map([["traex", traex]]) });
  const result = await c.repairHook("traex");
  assert.equal(result.success, true);
  assert.equal(result.resolved, true);
  assert.equal(c.audit.length, 1);
  assert.equal(c.audit[0].agentId, "traex");
  assert.deepEqual(c.audit[0].issuesBefore, ["Stale hook command: expected --source traex"]);
  assert.deepEqual(c.audit[0].issuesAfter, []);
  assert.equal(c.audit[0].resolved, true);
});

test("repairHook surfaces install failure without audit pollution and without crash", async () => {
  const claude = manager({ installed: false, issues: [], failInstall: true });
  const c = createFakeCoordinator({ managers: new Map([["claude", claude]]) });
  const result = await c.repairHook("claude");
  assert.equal(result.success, false);
  assert.match(result.error, /EACCES/);
  assert.equal(c.audit.length, 0);
});

test("repairAllHooks only touches repairable agents and skips ok/not-installed/running", async () => {
  const installs = [];
  const mk = (agentId, cfg) => {
    const m = manager(cfg);
    const orig = m.install.bind(m);
    m.install = async (opts) => { installs.push(agentId); return orig(opts); };
    return m;
  };
  const managers = new Map([
    ["claude", mk("claude", { installed: true, issues: [] })],
    ["traex", mk("traex", { installed: true, issues: ["Stale hook command: expected --source traex"] })],
    ["codex", mk("codex", { installed: false, issues: ["Codex hooks.json not found"] })],
    ["cursor", mk("cursor", { installed: false, available: false, issues: ["Cursor CLI not found"] })],
    ["dsh", mk("dsh", { installed: false, issues: ["请先启动 DeepSeek Harness"] })]
  ]);
  const c = createFakeCoordinator({ managers });
  const results = await c.repairAllHooks();
  assert.deepEqual(installs.sort(), ["codex", "traex"]);
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.success));
  assert.deepEqual(c.audit.map((e) => e.agentId).sort(), ["codex", "traex"]);
});

test("startup doctor repairs repairable agents and records summary", async () => {
  const managers = new Map([
    ["traex", manager({ installed: true, issues: ["Stale hook command: expected --source traex"] })]
  ]);
  const settings = {};
  const c = createFakeCoordinator({ managers, settings });
  const repaired = await c.runStartupDoctor();
  assert.deepEqual(repaired?.map((r) => r.agentId), ["traex"]);
  assert.deepEqual(settings.doctorLastAutoRepair.agents, ["traex"]);
  assert.ok(settings.doctorLastAutoRepair.at);
});

test("startup doctor can be disabled via settings and never touches managers", async () => {
  let installCalls = 0;
  const m = manager({ installed: true, issues: ["Stale hook command: expected --source traex"] });
  const orig = m.install.bind(m);
  m.install = async (opts) => { installCalls += 1; return orig(opts); };
  const c = createFakeCoordinator({
    managers: new Map([["traex", m]]),
    settings: { agentDoctorStartup: false }
  });
  const repaired = await c.runStartupDoctor();
  assert.equal(repaired, null);
  assert.equal(installCalls, 0);
  assert.equal(c.audit.length, 0);
});

test("audit log is capped at 50 entries", () => {
  const c = createFakeCoordinator({ managers: new Map() });
  for (let i = 0; i < 60; i += 1) c.recordDoctorAudit({ agentId: `a${i}`, action: "repair" });
  assert.equal(c.audit.length, 50);
  assert.equal(c.audit[0].agentId, "a10");
  assert.equal(c.audit[c.audit.length - 1].agentId, "a59");
});
