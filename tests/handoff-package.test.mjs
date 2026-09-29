import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const {
  buildHandoffPackage,
  gitEvidence,
  renderHandoffMarkdown,
  renderHandoffPrompt,
  extractClaudeConversation,
  extractCodexConversation,
  claudeEntryToMessage,
  codexEntryToMessage,
  zcodeConversationFromDb,
  readUtf8Windows
} = require("../src/main/handoff-package.cjs");

function writeTmpTranscript(name, lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-pkg-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n"), "utf-8");
  return file;
}

// ── claude 家族解析 ──────────────────────────────────────────────────────────

test("claude tail keeps interleaved user/assistant text and skips meta / tool results", () => {
  const head = [
    { type: "ai-title", aiTitle: "Fix search jump" },
    { type: "user", message: { role: "user", content: "帮我修搜索跳转的 bug" } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "thinking", text: "内心独白不该出现" }, { type: "text", text: "我先看下跳转代码" }] } }
  ];
  const tail = [
    { type: "user", isMeta: true, message: { role: "user", content: "meta 注入行" } },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", content: "tool output" }] } },
    { type: "user", message: { role: "user", content: "改成直接跳转" } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "已完成，测试通过" }] } }
  ];

  const result = extractClaudeConversation(head, tail);
  assert.equal(result.title, "Fix search jump");
  assert.equal(result.firstUserPrompt, "帮我修搜索跳转的 bug");
  assert.deepEqual(
    result.tail.map((m) => m.role),
    ["user", "assistant"]
  );
  assert.equal(result.tail[0].text, "改成直接跳转");
  assert.equal(result.tail[1].text, "已完成，测试通过");
  assert.ok(!result.tail.some((m) => m.text.includes("tool output")));
  assert.ok(!result.tail.some((m) => m.text.includes("meta 注入行")));
  assert.ok(!result.tail.some((m) => m.text.includes("内心独白")));
});

test("claudeEntryToMessage handles string and array content", () => {
  assert.deepEqual(claudeEntryToMessage({ type: "user", message: { role: "user", content: "字符串内容" } }), {
    role: "user",
    text: "字符串内容"
  });
  assert.equal(claudeEntryToMessage({ type: "system" }), null);
  assert.equal(claudeEntryToMessage({ type: "user", message: { role: "user", content: "" } }), null);
});

// ── codex rollout 解析 ───────────────────────────────────────────────────────

test("codex tail reads user_message / agent_message and filters injected noise", () => {
  const head = [
    { type: "session_meta", payload: { id: "cx-1", cwd: "/tmp/proj" } },
    { type: "event_msg", payload: { type: "user_message", message: "分析技能目录结构" } }
  ];
  const tail = [
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>noise</environment_context>" }] } },
    { type: "event_msg", payload: { type: "user_message", message: "继续改第二处" } },
    { type: "event_msg", payload: { type: "agent_message", message: "两处都改完了，单测通过" } },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "老格式兜底回复" }] } }
  ];

  const result = extractCodexConversation(head, tail);
  assert.equal(result.firstUserPrompt, "分析技能目录结构");
  assert.deepEqual(
    result.tail.map((m) => m.role),
    ["user", "assistant", "assistant"]
  );
  assert.ok(!result.tail.some((m) => m.text.includes("environment_context")));
  assert.ok(result.tail.some((m) => m.text === "老格式兜底回复"));
});

test("codexEntryToMessage rejects noise and malformed payload", () => {
  assert.equal(codexEntryToMessage({ type: "event_msg", payload: { type: "user_message", message: "# AGENTS injected" } }), null);
  assert.equal(codexEntryToMessage({ type: "event_msg", payload: null }), null);
});

// ── 窗口读取 ─────────────────────────────────────────────────────────────────

test("readUtf8Windows returns whole content for small files, head+tail for large", () => {
  const small = writeTmpTranscript("small.jsonl", [{ type: "user", message: { role: "user", content: "小文件" } }]);
  const smallResult = readUtf8Windows(small);
  assert.ok(smallResult.head.includes("小文件"));
  assert.equal(smallResult.head, smallResult.tail);

  const bigLine = JSON.stringify({ type: "user", message: { role: "user", content: "x".repeat(200) } });
  const bigContent = Array.from({ length: 4000 }, (_, i) => JSON.stringify({ type: "user", message: { role: "user", content: `行${i}-${"y".repeat(100)}` } })).join("\n");
  const big = path.join(path.dirname(small), "big.jsonl");
  fs.writeFileSync(big, bigContent, "utf-8");
  const bigResult = readUtf8Windows(big);
  assert.ok(bigResult.head.includes("行0-"));
  assert.ok(!bigResult.head.includes("行3999-"));
  assert.ok(bigResult.tail.includes("行3999-"));
  assert.ok(!bigResult.tail.includes("行0-"));
  // 半行必须被丢弃：两端窗口内的每一行都应是合法 JSON
  for (const line of bigResult.tail.split("\n").filter(Boolean)) {
    assert.doesNotThrow(() => JSON.parse(line));
  }
  assert.equal(readUtf8Windows(path.join(path.dirname(small), "nope.jsonl")), null);
});

// ── zcode sqlite 尾部（runSqlite mock）──────────────────────────────────────

test("zcode tail assembles user intents and assistant text parts from db", async () => {
  const messages = [
    // 时间正序：u1 → a1(两个 text part) → u2 → a2
    { seq: 1, id: "msg_u1", data: { role: "user", metadata: { inputIntent: { text: "最初的任务目标" } } } },
    { seq: 2, id: "msg_a1", data: { role: "assistant", finish: "tool-calls" } },
    { seq: 3, id: "msg_u2", data: { role: "user", metadata: { inputIntent: { text: "把跳转改成直接跳" } } } },
    { seq: 4, id: "msg_a2", data: { role: "assistant", finish: "stop" } }
  ];
  const parts = [
    { messageId: "msg_a1", data: { type: "text", text: "第一段回复" } },
    { messageId: "msg_a1", data: { type: "text", text: "第二段回复" } },
    { messageId: "msg_a2", data: { type: "text", text: "已改完" } },
    { messageId: "msg_a2", data: { type: "reasoning", text: "推理不该出现" } }
  ];
  const runSqlite = async (sql) => {
    if (sql.includes("ORDER BY sequence ASC LIMIT 1")) {
      return messages[0].id && JSON.stringify(messages[0].data) + "\n";
    }
    if (sql.startsWith("SELECT sequence, id, data")) {
      // 真实 sqlite 按 sequence DESC 返回
      return messages.slice().reverse().map((m) => [m.seq, m.id, JSON.stringify(m.data)].join("|")).join("\n") + "\n";
    }
    if (sql.startsWith("SELECT message_id, data")) {
      return parts.map((p) => [p.messageId, JSON.stringify(p.data)].join("|")).join("\n") + "\n";
    }
    return "";
  };

  const result = await zcodeConversationFromDb({ sessionId: "sess-abc_123", runSqlite });
  assert.equal(result.firstUserPrompt, "最初的任务目标");
  assert.deepEqual(
    result.tail.map((m) => m.role),
    ["user", "assistant", "user", "assistant"]
  );
  assert.equal(result.tail[1].text, "第一段回复\n第二段回复");
  assert.equal(result.tail[3].text, "已改完");
  assert.ok(!result.tail.some((m) => m.text.includes("推理不该出现")));
});

test("zcode rejects session ids that are not sqlite-safe", async () => {
  await assert.rejects(
    zcodeConversationFromDb({ sessionId: "x'; DROP TABLE message;--", runSqlite: async () => "" }),
    /invalid sqlite session id/
  );
});

// ── Git 证据（真实 tmp 仓库）────────────────────────────────────────────────

function initTmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-git-"));
  const git = (args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf-8" });
  git(["init", "-q"]);
  git(["config", "user.email", "t@example.com"]);
  git(["config", "user.name", "t"]);
  fs.writeFileSync(path.join(dir, "a.txt"), "1", "utf-8");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  return { dir, git };
}

test("gitEvidence captures clean / dirty / non-repo states", async () => {
  const { dir, git } = initTmpRepo();
  const clean = await gitEvidence(dir);
  assert.equal(clean.isRepo, true);
  assert.ok(clean.branch.length > 0);
  assert.equal(clean.commit.length, 12);
  assert.equal(clean.dirtyCount, 0);

  fs.writeFileSync(path.join(dir, "b.txt"), "dirty", "utf-8");
  const dirty = await gitEvidence(dir);
  assert.equal(dirty.dirtyCount, 1);
  assert.deepEqual(dirty.dirtyFiles, ["?? b.txt"]);

  const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-norepo-"));
  const outside = await gitEvidence(nonRepo);
  assert.equal(outside.isRepo, false);
  assert.equal((await gitEvidence("")).isRepo, false);
});

// ── 包组装（集成）───────────────────────────────────────────────────────────

const fakeSession = {
  id: "sess-1",
  tool: "claude",
  title: "搜索跳转修复",
  latestUserPrompt: "改成直接跳转",
  lastAssistantMessage: "已完成",
  jumpTarget: { workingDirectory: "" },
  error: ""
};

test("buildHandoffPackage assembles from transcript + session state, degrades when transcript missing", async () => {
  const { dir } = initTmpRepo();
  const transcript = writeTmpTranscript("s.jsonl", [
    { type: "user", message: { role: "user", content: "修搜索跳转" } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "改好了" }] } }
  ]);
  const session = { ...fakeSession, jumpTarget: { workingDirectory: dir } };

  const pkg = await buildHandoffPackage({ tool: "claude", session, transcriptPath: transcript });
  assert.match(pkg.id, /^hof_[0-9a-z]+_[0-9a-f]+$/);
  assert.equal(pkg.projectDir, dir);
  assert.equal(pkg.goal, "搜索跳转修复"); // title 优先
  assert.equal(pkg.lastUserPrompt, "改成直接跳转");
  assert.equal(pkg.source.transcriptAvailable, true);
  assert.equal(pkg.git.isRepo, true);
  assert.ok(pkg.tail.length >= 2);

  // transcript 缺失 → 会话字段兜底，transcriptAvailable=false，不抛
  const degraded = await buildHandoffPackage({ tool: "claude", session, transcriptPath: "" });
  assert.equal(degraded.source.transcriptAvailable, false);
  assert.equal(degraded.lastAssistantMessage, "已完成");
  assert.deepEqual(degraded.tail, []);

  await assert.rejects(() => buildHandoffPackage({ tool: "claude", session: null, transcriptPath: "" }), /session is required/);
});

test("buildHandoffPackage zcode path reads sqlite via deps and goal falls back to first prompt", async () => {
  const runSqlite = async (sql) => {
    if (sql.includes("ORDER BY sequence ASC LIMIT 1")) {
      return JSON.stringify({ role: "user", metadata: { inputIntent: { text: "第一条任务目标" } } }) + "\n";
    }
    if (sql.startsWith("SELECT sequence, id, data")) {
      return [1, "m1", JSON.stringify({ role: "user", metadata: { inputIntent: { text: "第一条任务目标" } } })].join("|") + "\n";
    }
    return "";
  };
  const session = { ...fakeSession, id: "zsess-1", tool: "zcode", title: "" };
  const pkg = await buildHandoffPackage(
    { tool: "zcode", session, transcriptPath: "" },
    { runSqlite, runGit: async () => "" }
  );
  assert.equal(pkg.goal, "第一条任务目标");
  assert.equal(pkg.source.transcriptAvailable, true);
  assert.equal(pkg.git.isRepo, false);
});

// ── 渲染 ─────────────────────────────────────────────────────────────────────

test("renderHandoffMarkdown and prompt carry goal / git / package path", async () => {
  const transcript = writeTmpTranscript("r.jsonl", [
    { type: "user", message: { role: "user", content: "goal" } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "done" }] } }
  ]);
  const pkg = await buildHandoffPackage({ tool: "claude", session: fakeSession, transcriptPath: transcript });

  const markdown = renderHandoffMarkdown(pkg, { packageDir: "/tmp/pkg-dir" });
  assert.ok(markdown.includes("# 交接包"));
  assert.ok(markdown.includes("任务目标"));
  assert.ok(markdown.includes("搜索跳转修复"));
  assert.ok(markdown.includes("非 Git 仓库"));
  assert.ok(markdown.includes("/tmp/pkg-dir"));
  assert.ok(markdown.includes("**用户**：goal"));

  const promptZh = renderHandoffPrompt(pkg, { packageDir: "/tmp/pkg-dir" });
  assert.ok(promptZh.includes("/tmp/pkg-dir/HANDOFF.md"));
  assert.ok(promptZh.includes("在我确认之前不要修改任何文件"));
  assert.ok(promptZh.includes(fakeSession.id === "sess-1" ? "搜索跳转修复" : ""));

  const promptEn = renderHandoffPrompt(pkg, { packageDir: "/tmp/pkg-dir", locale: "en", confirmFirst: false });
  assert.ok(promptEn.includes("Handoff package"));
  assert.ok(promptEn.includes("then continue"));
  assert.ok(!promptEn.includes("不要修改任何文件"));
});
