import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const {
  createHandoffDelivery,
  createHandoffLog,
  renderLaunchScript,
  zcodeWorkspaceDeepLink,
  HANDOFF_TARGETS
} = require("../src/main/handoff-delivery.cjs");
const { createSessionState } = require("../src/main/session-state.cjs");

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const basePkg = {
  id: "hof_test01_abc123",
  schemaVersion: 1,
  generatedAt: "2026-09-29T00:00:00.000Z",
  source: { tool: "zcode", sessionId: "sess-z1", title: "修复跳转", transcriptPath: "", transcriptAvailable: true, error: "" },
  projectDir: "/tmp/proj",
  goal: "修复搜索跳转",
  lastUserPrompt: "继续",
  lastAssistantMessage: "已完成一半",
  tail: [],
  git: { isRepo: true, branch: "main", commit: "abc123def456", dirtyCount: 2, dirtyFiles: ["?? b.txt", "M a.txt"] }
};

function makeDelivery(overrides = {}) {
  const captured = { scripts: [], clipboard: [], urls: [] };
  const delivery = createHandoffDelivery({
    handoffRoot: overrides.handoffRoot ?? tmpDir("handoff-deliver-"),
    runAppleScript: async (script) => {
      captured.scripts.push(script);
      return "ok";
    },
    codexAvailable: async () => overrides.codexAvailable ?? true,
    writeClipboard: (text) => {
      captured.clipboard.push(text);
      return true;
    },
    openUrl: async (url) => {
      captured.urls.push(url);
      return true;
    }
  });
  return { delivery, captured };
}

// ── 能力级别判定 ─────────────────────────────────────────────────────────────

test("targetLevel: codex injects when CLI present, degrades to copy-open when missing; zcode always copy-open", async () => {
  const { delivery } = makeDelivery({ codexAvailable: true });
  assert.deepEqual(await delivery.targetLevel("codex"), { level: "inject" });
  assert.deepEqual(await delivery.targetLevel("zcode"), { level: "copy-open" });
  assert.equal(await delivery.targetLevel("claude"), null);

  const degraded = makeDelivery({ codexAvailable: false });
  assert.deepEqual(await degraded.delivery.targetLevel("codex"), {
    level: "copy-open",
    degradedReason: "codex-cli-not-found"
  });
});

// ── Level A：自动注入 ────────────────────────────────────────────────────────

test("Level A deliver writes package files, launch.sh and opens a Terminal.app window", async () => {
  const { delivery, captured } = makeDelivery();
  const receipt = await delivery.deliver(basePkg, { targetTool: "codex" });

  assert.equal(receipt.level, "inject");
  assert.equal(receipt.status, "delivered");
  assert.equal(receipt.terminal, "Terminal.app");
  const packageDir = receipt.packageDir;
  assert.ok(fs.existsSync(path.join(packageDir, "HANDOFF.md")));
  const prompt = fs.readFileSync(path.join(packageDir, "prompt.txt"), "utf-8");
  assert.ok(prompt.includes("HANDOFF.md"));
  assert.ok(prompt.includes("在我确认之前不要修改任何文件"));

  const launch = fs.readFileSync(path.join(packageDir, "launch.sh"), "utf-8");
  assert.ok(launch.includes("cd '/tmp/proj'"));
  assert.ok(launch.includes(`exec codex "$(cat '${path.join(packageDir, "prompt.txt")}')"`));

  assert.equal(captured.scripts.length, 1);
  assert.ok(captured.scripts[0].includes('tell application "Terminal"'));
  assert.ok(captured.scripts[0].includes("do script "));
  // 只在自己新建的窗口执行，绝不向未知 pane 发送文本
  assert.ok(captured.scripts[0].includes("bash "));
});

test("renderLaunchScript single-quote escapes paths with spaces and quotes", () => {
  const nasty = "/tmp/it's a \"proj\" dir";
  const script = renderLaunchScript({ ...basePkg, projectDir: nasty }, "/tmp/pkgdir");
  assert.ok(script.includes(`cd '/tmp/it'\\''s a "proj" dir'`));
  // 引号恶意内容不会逃出 cd 参数
  assert.ok(script.includes("exec codex \"$(cat '/tmp/pkgdir/prompt.txt')\""));
});

// ── Level B：复制 + 打开 ─────────────────────────────────────────────────────

test("Level B deliver for zcode copies prompt and opens workspace deep link", async () => {
  const { delivery, captured } = makeDelivery();
  const receipt = await delivery.deliver(basePkg, { targetTool: "zcode", locale: "en" });

  assert.equal(receipt.level, "copy-open");
  assert.equal(receipt.status, "delivered");
  assert.equal(receipt.clipboardSet, true);
  assert.equal(receipt.degradedReason, "");
  assert.equal(captured.clipboard.length, 1);
  assert.ok(captured.clipboard[0].includes("Handoff package"));
  assert.deepEqual(captured.urls, [zcodeWorkspaceDeepLink("/tmp/proj")]);
  assert.equal(captured.urls[0], "zcode://workspace/open?path=%2Ftmp%2Fproj");
  assert.ok(fs.existsSync(path.join(receipt.packageDir, "HANDOFF.md")));
  // copy-open 不写 launch.sh：没有自动注入就不假装能注入
  assert.ok(!fs.existsSync(path.join(receipt.packageDir, "launch.sh")));
});

test("Level B degrade for codex opens a terminal at the project dir", async () => {
  const { delivery, captured } = makeDelivery({ codexAvailable: false });
  const receipt = await delivery.deliver(basePkg, { targetTool: "codex" });
  assert.equal(receipt.level, "copy-open");
  assert.equal(receipt.degradedReason, "codex-cli-not-found");
  assert.equal(captured.urls.length, 0);
  assert.equal(captured.scripts.length, 1);
  assert.ok(captured.scripts[0].includes("cd '/tmp/proj'"));
});

// ── 交接日志：回执 / 去重 / 接手链接 ────────────────────────────────────────

function makeLog() {
  const dir = tmpDir("handoff-log-");
  return createHandoffLog({ logPath: path.join(dir, "log.json") });
}

test("handoff log records receipts and persists across instances", () => {
  const logPath = path.join(tmpDir("handoff-log-"), "log.json");
  const log1 = createHandoffLog({ logPath });
  const entry = log1.record({ pkg: basePkg, targetTool: "codex", level: "inject", status: "delivered", sourceCompletedAt: 1000 });
  assert.equal(entry.id, basePkg.id);
  assert.equal(entry.targetTool, "codex");
  assert.equal(log1.setPackageDir(entry.id, "/tmp/pkgdir"), true);

  const log2 = createHandoffLog({ logPath });
  const listed = log2.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].packageDir, "/tmp/pkgdir");
});

test("canDeliver blocks duplicates until the source session completes again", () => {
  const log = makeLog();
  log.record({ pkg: basePkg, targetTool: "codex", level: "inject", status: "delivered", sourceCompletedAt: 1000 });

  // 同一完成时点重复点击 → 拒绝
  const blocked = log.canDeliver({ sourceSessionId: "sess-z1", targetTool: "codex", sourceCompletedAt: 1000 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "already-handed-off");

  // 更早的完成时点（陈旧状态）同样拒绝
  assert.equal(log.canDeliver({ sourceSessionId: "sess-z1", targetTool: "codex", sourceCompletedAt: 500 }).ok, false);

  // 新的完成事件（交接后源会话又跑了一轮）→ 放行
  assert.equal(log.canDeliver({ sourceSessionId: "sess-z1", targetTool: "codex", sourceCompletedAt: 2000 }).ok, true);

  // 换目标工具不受另一条记录影响
  assert.equal(log.canDeliver({ sourceSessionId: "sess-z1", targetTool: "zcode", sourceCompletedAt: 1000 }).ok, true);
  // 其他会话不受影响
  assert.equal(log.canDeliver({ sourceSessionId: "sess-other", targetTool: "codex", sourceCompletedAt: 1000 }).ok, true);
});

test("findRecentForStart matches window / tool / dir and markLinked is once-only", () => {
  const log = makeLog();
  const entry = log.record({ pkg: basePkg, targetTool: "codex", level: "inject", status: "delivered", sourceCompletedAt: 1000 });
  const deliveredAt = entry.deliveredAt;

  assert.equal(
    log.findRecentForStart({ tool: "codex", workingDirectory: "/tmp/proj", createdAt: deliveredAt + 60_000 })?.id,
    entry.id
  );
  // 交付前创建的会话不算（源会话天然不满足）
  assert.equal(log.findRecentForStart({ tool: "codex", workingDirectory: "/tmp/proj", createdAt: deliveredAt - 1000 }), null);
  // 超出 30 分钟窗口不再关联
  assert.equal(log.findRecentForStart({ tool: "codex", workingDirectory: "/tmp/proj", createdAt: deliveredAt + 31 * 60_000 }), null);
  // 工具不匹配（目标表里写的是 codex，来的是 zcode 会话）
  assert.equal(log.findRecentForStart({ tool: "zcode", workingDirectory: "/tmp/proj", createdAt: deliveredAt + 60_000 }), null);
  // 目录不匹配
  assert.equal(log.findRecentForStart({ tool: "codex", workingDirectory: "/tmp/other", createdAt: deliveredAt + 60_000 }), null);

  assert.equal(log.markLinked(entry.id, "new-codex-session"), true);
  assert.equal(log.markLinked(entry.id, "another-session"), false);
  assert.equal(log.findRecentForStart({ tool: "codex", workingDirectory: "/tmp/proj", createdAt: deliveredAt + 60_000 }), null);
});

// ── session-state：交接徽标与接手标记 ──────────────────────────────────────

test("session-state records handoff badge and receivedFrom link", () => {
  const state = createSessionState({ isVisibleInIsland: () => true });
  let current = state.createInitialState();
  const ts = Date.now();

  current = state.apply(current, { type: "sessionStarted", sessionId: "s1", tool: "zcode", timestamp: ts });
  current = state.apply(current, {
    type: "handoffRecorded",
    sessionId: "s1",
    tool: "zcode",
    timestamp: ts + 1000,
    targetTool: "codex",
    handoffId: "hof_x",
    level: "inject",
    status: "delivered"
  });
  assert.equal(state.getSession(current, "s1").handoff.targetTool, "codex");
  assert.equal(state.getSession(current, "s1").handoff.handoffId, "hof_x");

  // 目标会话启动后补挂接手标记
  current = state.apply(current, { type: "sessionStarted", sessionId: "s2", tool: "codex", timestamp: ts + 2000 });
  current = state.apply(current, {
    type: "handoffLinkAttached",
    sessionId: "s2",
    tool: "codex",
    timestamp: ts + 2500,
    receivedFrom: { tool: "zcode", sessionId: "s1", handoffId: "hof_x" }
  });
  assert.deepEqual(state.getSession(current, "s2").receivedFrom, { tool: "zcode", sessionId: "s1", handoffId: "hof_x" });

  // 接手标记跨 turn 存续（同一会话继续干仍是接手方）
  current = state.apply(current, { type: "sessionStarted", sessionId: "s2", tool: "codex", timestamp: ts + 9000 });
  assert.equal(state.getSession(current, "s2").receivedFrom.tool, "zcode");
  // handoffRecorded 的空事件 / handoffLinkAttached 无 receivedFrom 不炸
  current = state.apply(current, { type: "handoffLinkAttached", sessionId: "s2", tool: "codex", timestamp: ts + 9500 });
  assert.equal(state.getSession(current, "s2").receivedFrom.tool, "zcode");
});

// ── 目标能力表 ───────────────────────────────────────────────────────────────

test("v1 handoff targets are exactly codex(inject) and zcode(copy-open)", () => {
  assert.deepEqual(HANDOFF_TARGETS, { codex: { level: "inject" }, zcode: { level: "copy-open" } });
});
