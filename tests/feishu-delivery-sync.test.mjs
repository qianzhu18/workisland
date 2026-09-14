import test from "node:test";
import assert from "node:assert/strict";

import { taskMatchesPullRequest, updateForPullRequest } from "../scripts/sync-feishu-delivery.mjs";

test("extracts a pending-acceptance update only for merged pull requests", () => {
  assert.deepEqual(updateForPullRequest({
    pull_request: { number: 120, merged: true, base: { ref: "main" } },
  }), {
    pullRequestNumber: 120,
    status: "待验收",
    summary: "GitHub PR #120 已合入 main，等待验收证据回填。",
  });
  assert.equal(updateForPullRequest({ pull_request: { number: 120, merged: false } }), null);
});

test("finds a task by an explicit GitHub PR reference without depending on Feishu record ids", () => {
  assert.equal(taskMatchesPullRequest({
    fields: { "任务": "PR 1：搜索索引器 rebase 与合入判断（#120）" },
  }, 120), true);
  assert.equal(taskMatchesPullRequest({
    fields: { "任务": "会话搜索 UI、隐私控制与回源（#127）" },
  }, 120), false);
});
