import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createDefaultSettings } = require("../src/shared/settings.cjs");
const { DIAGNOSIS_SUBJECTS, diagnoseMcpSubject } = require("../src/main/mcp-diagnostics.cjs");

const EXPECTED_SUBJECTS = [
  "agent-not-visible",
  "session-disappeared",
  "media-not-visible",
  "performance-details-not-visible",
  "file-shelf-not-visible",
  "clipboard-not-visible",
  "terminal-not-visible",
  "usage-not-visible"
];

test("diagnostics expose an exact bounded subject list", () => {
  assert.deepEqual(DIAGNOSIS_SUBJECTS, EXPECTED_SUBJECTS);
  assert.throws(
    () => diagnoseMcpSubject("../../private", {}),
    (error) => error.code === "DIAGNOSIS_NOT_ALLOWED" && !error.message.includes("../../private")
  );
});

test("performance diagnosis explains the observed setting without changing it", () => {
  const settings = { ...createDefaultSettings(), performanceEnabled: false };
  const result = diagnoseMcpSubject("performance-details-not-visible", {
    settings,
    modules: { performance: false },
    sessions: [],
    integrations: []
  });
  assert.deepEqual(Object.keys(result).sort(), [
    "evidence", "nextSteps", "possibleReasons", "settingsSection", "status", "subject"
  ]);
  assert.equal(result.status, "disabled");
  assert.match(result.evidence.join(" "), /性能监视器.*关闭/);
  assert.equal(result.settingsSection, "general");
  assert.equal(settings.performanceEnabled, false);
});

test("agent diagnosis states WorkIsland observation limits and leaks no machine details", () => {
  const result = diagnoseMcpSubject("agent-not-visible", {
    settings: createDefaultSettings(),
    modules: {},
    sessions: [],
    integrations: [{ id: "codex", name: "Codex", enabled: true, installed: true, verifiedByEvent: false }]
  });
  assert.equal(result.status, "not-observed");
  assert.match(result.evidence.join(" "), /WorkIsland 当前没有观察到可见会话/);
  const serialized = JSON.stringify(result);
  for (const forbidden of ["/Users/", "pid", "prompt", "command", "terminalId", "stack"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
