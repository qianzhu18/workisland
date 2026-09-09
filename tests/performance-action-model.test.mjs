import assert from "node:assert/strict";
import { test } from "node:test";
import { performanceActionMessage } from "../src/renderer/island/components/performance-action-model.mjs";

test("process action result codes map to localizable feedback keys", () => {
  assert.equal(performanceActionMessage({ ok: true, reason: "signaled" }), "performance.action.signaled");
  assert.equal(performanceActionMessage({ ok: false, reason: "protected" }), "performance.action.protected");
  assert.equal(performanceActionMessage({ ok: false, reason: "identity-changed" }), "performance.action.identityChanged");
  assert.equal(performanceActionMessage({ ok: false, reason: "permission" }), "performance.action.permission");
  assert.equal(performanceActionMessage({ ok: false, reason: "ended" }), "performance.action.ended");
});
