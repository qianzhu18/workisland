import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createDefaultSettings } = require("../src/shared/settings.cjs");
const { LocalControlAudit } = require("../src/main/local-control-audit.cjs");
const { LocalControlService } = require("../src/main/local-control-service.cjs");

test("visible sessions use opaque ids and omit all content and machine identifiers", async () => {
  const focused = [];
  const rawSession = {
    id: "raw-session-secret",
    tool: "codex",
    phase: "waitingForApproval",
    updatedAt: 1_799_999_999_000,
    latestUserPrompt: "deploy the secret project",
    latestAssistantText: "secret response",
    summary: "private summary",
    cwd: "/Users/person/private-project",
    transcriptPath: "/Users/person/.codex/secret.jsonl",
    pid: 4242,
    terminalId: "tty-secret",
    jumpTarget: { app: "Codex", pid: 4242, tty: "/dev/ttys007" },
    rawPayload: { token: "secret-token" }
  };
  const settings = { ...createDefaultSettings(), localAgentControlEnabled: true };
  const service = new LocalControlService({
    getSettings: () => settings,
    updateSettings: () => {},
    getInstalledPetIds: () => new Set(),
    getSessions: () => [rawSession],
    jumpToSession: async (id) => focused.push(id),
    audit: { append() {}, list: () => [] },
    now: () => 1_800_000_000_000,
    randomId: () => "session-public-1"
  });

  const result = await service.execute("control.listActiveSessions", {});
  assert.deepEqual(result.sessions, [{
    id: "session-public-1",
    agent: "codex",
    phase: "waitingForApproval",
    updatedAt: 1_799_999_999_000,
    requiresAttention: true,
    canFocus: true
  }]);
  const serialized = JSON.stringify(result);
  for (const secret of ["raw-session-secret", "deploy the secret", "private-project", "secret.jsonl", "4242", "tty-secret", "secret-token"]) {
    assert.equal(serialized.includes(secret), false, `response leaked ${secret}`);
  }

  await service.execute("control.focusSession", { id: "session-public-1" });
  assert.deepEqual(focused, ["raw-session-secret"]);
  await assert.rejects(
    service.execute("control.focusSession", { id: "raw-session-secret" }),
    (error) => error.code === "SESSION_UNAVAILABLE"
  );
});

test("integration summaries expose health and capabilities without paths or raw issues", async () => {
  const settings = { ...createDefaultSettings(), localAgentControlEnabled: true };
  const service = new LocalControlService({
    getSettings: () => settings,
    updateSettings: () => {},
    getSessions: () => [{ id: "live-codex", tool: "codex", phase: "running", updatedAt: 10 }],
    getIntegrationStatus: async () => [{
      agentId: "codex",
      label: "Codex",
      installed: true,
      connectionState: "configured",
      manifestPath: "/Users/person/.codex/config.toml",
      issues: ["bad path /Users/person/private"],
      capabilities: {
        liveStatus: true,
        toolActivity: true,
        completion: "native",
        approval: "observe",
        question: "observe",
        jump: "terminal",
        secretCapability: "/private/path"
      }
    }],
    audit: { append() {}, list: () => [] }
  });

  const result = await service.execute("control.listIntegrations");
  assert.deepEqual(result.integrations, [{
    id: "codex",
    name: "Codex",
    enabled: true,
    installed: true,
    verifiedByEvent: true,
    capabilities: {
      liveStatus: true,
      toolActivity: true,
      completion: "native",
      approval: "observe",
      question: "observe",
      jump: "terminal"
    }
  }]);
  const serialized = JSON.stringify(result);
  for (const secret of ["manifestPath", "config.toml", "issues", "/private/path", "secretCapability"]) {
    assert.equal(serialized.includes(secret), false, `response leaked ${secret}`);
  }
});

test("audit persistence keeps a bounded fixed-field record", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workisland-control-audit-"));
  const filePath = path.join(directory, "activity.json");
  const audit = new LocalControlAudit({ filePath, maxEntries: 2 });

  audit.append({ timestamp: 1, client: "Codex", tool: "get", result: "success", secret: "drop-me" });
  audit.append({ timestamp: 2, client: "Claude", tool: "set", keys: ["mediaEnabled"], result: "success", rawArguments: { secret: true } });
  audit.append({ timestamp: 3, client: "Cursor", tool: "set", keys: ["sound.volume"], result: "rejected" });

  const persisted = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.equal(persisted.length, 2);
  assert.deepEqual(persisted.map((entry) => entry.timestamp), [2, 3]);
  assert.equal(JSON.stringify(persisted).includes("drop-me"), false);
  assert.equal(JSON.stringify(persisted).includes("rawArguments"), false);
  assert.deepEqual(new LocalControlAudit({ filePath, maxEntries: 2 }).list(), persisted);
});
