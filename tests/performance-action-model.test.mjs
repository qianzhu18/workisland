import assert from "node:assert/strict";
import { test } from "node:test";
import { performanceActionMessage } from "../src/renderer/island/components/performance-action-model.mjs";

test("process action result codes have clear Chinese feedback", () => {
  assert.equal(performanceActionMessage({ ok: true, reason: "signaled" }), "已发送退出指令");
  assert.equal(performanceActionMessage({ ok: false, reason: "protected" }), "这是受保护的进程");
  assert.equal(performanceActionMessage({ ok: false, reason: "identity-changed" }), "进程已发生变化，请刷新后重试");
  assert.equal(performanceActionMessage({ ok: false, reason: "permission" }), "没有权限退出此进程");
  assert.equal(performanceActionMessage({ ok: false, reason: "ended" }), "进程已经结束");
});
