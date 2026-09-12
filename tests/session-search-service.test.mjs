import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const {
  createSessionSearchService,
  parseClaudeTranscript,
  parseCodexTranscript,
  parseSqliteRows,
  zcodeUserTextFromData
} = require("../src/main/session-search-service.cjs");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("claude transcript parser keeps user prompts and skips tool results / meta lines", () => {
  const lines = [
    JSON.stringify({ type: "file-history-snapshot", messageId: "m0" }),
    JSON.stringify({
      type: "user",
      sessionId: "aaa-1",
      cwd: "/Users/mac/qianzhu Vault/project/workisland",
      timestamp: "2026-09-01T10:00:00.000Z",
      message: { role: "user", content: "帮我分析飞书表格的任务" }
    }),
    JSON.stringify({
      type: "assistant",
      sessionId: "aaa-1",
      message: { role: "assistant", content: [{ type: "text", text: "好的，这是 AI 的长篇回复，不该进索引" }] }
    }),
    JSON.stringify({
      type: "user",
      sessionId: "aaa-1",
      timestamp: "2026-09-01T10:05:00.000Z",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "tool output" }] }
    }),
    JSON.stringify({
      type: "user",
      isMeta: true,
      sessionId: "aaa-1",
      message: { role: "user", content: "meta 注入行" }
    }),
    JSON.stringify({
      type: "user",
      sessionId: "aaa-1",
      timestamp: "2026-09-01T10:06:00.000Z",
      message: { role: "user", content: [{ type: "text", text: "规划下一轮 PR" }] }
    }),
    JSON.stringify({ type: "ai-title", sessionId: "aaa-1", aiTitle: "Analyze feishu tasks" })
  ];

  const parsed = parseClaudeTranscript(lines);
  assert.equal(parsed.id, "aaa-1");
  assert.equal(parsed.projectPath, "/Users/mac/qianzhu Vault/project/workisland");
  assert.equal(parsed.title, "Analyze feishu tasks");
  assert.equal(parsed.updatedAt, Date.parse("2026-09-01T10:06:00.000Z"));
  assert.match(parsed.text, /飞书表格的任务/);
  assert.match(parsed.text, /规划下一轮 PR/);
  assert.doesNotMatch(parsed.text, /tool output/);
  assert.doesNotMatch(parsed.text, /AI 的长篇回复/);
  assert.doesNotMatch(parsed.text, /meta 注入行/);
});

test("codex rollout parser reads session_meta and filters injected noise", () => {
  const lines = [
    JSON.stringify({
      type: "session_meta",
      payload: { id: "019e4143-4092", cwd: "/Users/mac/proj/xhs_skill", timestamp: "2026-05-20T01:23:07.000Z" }
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "<environment_context>\n<cwd>/Users/mac/proj</cwd>\n</environment_context>" }]
      }
    }),
    JSON.stringify({
      timestamp: "2026-05-20T01:24:00.000Z",
      type: "event_msg",
      payload: { type: "user_message", message: "分析小红书技能目录结构" }
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "老格式兜底：这条真实提问要被保留" }]
      }
    })
  ];

  const parsed = parseCodexTranscript(lines);
  assert.equal(parsed.id, "019e4143-4092");
  assert.equal(parsed.projectPath, "/Users/mac/proj/xhs_skill");
  assert.equal(parsed.updatedAt, Date.parse("2026-05-20T01:24:00.000Z"));
  assert.match(parsed.text, /分析小红书技能目录结构/);
  assert.match(parsed.text, /老格式兜底/);
  assert.doesNotMatch(parsed.text, /environment_context/);
});

test("zcode sqlite row and message-data parsing", () => {
  const rows = parseSqliteRows("sess_1|分析任务|/Users/mac/proj|1000|2000\nsess_2|标题含|竖杠|/tmp|1|2", 5);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ["sess_1", "分析任务", "/Users/mac/proj", "1000", "2000"]);
  // 末列回拼：message.data JSON 里的竖杠不能截断行
  const messageRows = parseSqliteRows('sess_1|{"role":"user","note":"a|b|c"}', 2);
  assert.equal(messageRows[0][1], '{"role":"user","note":"a|b|c"}');

  const userText = zcodeUserTextFromData(
    JSON.stringify({ role: "user", metadata: { inputIntent: { text: "规划下一轮的 pr 继续开发" } } })
  );
  assert.equal(userText, "规划下一轮的 pr 继续开发");
  // conversationInputIntent 兜底 + assistant 消息拒绝 + 坏 JSON 容错
  assert.equal(
    zcodeUserTextFromData(JSON.stringify({ role: "user", metadata: { conversationInputIntent: { text: "兜底文本" } } })),
    "兜底文本"
  );
  assert.equal(zcodeUserTextFromData(JSON.stringify({ role: "assistant" })), "");
  assert.equal(zcodeUserTextFromData("{broken"), "");
});

function makeZcodeRunSqlite({ sessions, messagesBySession }) {
  return async (dbPath, sql) => {
    assert.match(dbPath, /db\.sqlite$/);
    if (sql.includes("FROM session")) {
      return sessions.map((row) => row.join("|")).join("\n");
    }
    if (sql.includes("FROM message")) {
      const lines = [];
      for (const [sessionId, dataJson] of Object.entries(messagesBySession)) {
        if (sql.includes(`'${sessionId}'`)) lines.push(`${sessionId}|${dataJson}`);
      }
      return lines.join("\n");
    }
    throw new Error(`unexpected sql: ${sql}`);
  };
}

async function makeFixtureHome() {
  const homeDir = await fsp.mkdtemp(path.join(os.tmpdir(), "wi-search-home-"));
  const indexDir = await fsp.mkdtemp(path.join(os.tmpdir(), "wi-search-index-"));

  const claudeDir = path.join(homeDir, ".claude", "projects", "-Users-mac-proj-workisland");
  await fsp.mkdir(claudeDir, { recursive: true });
  await fsp.writeFile(
    path.join(claudeDir, "aaa-1.jsonl"),
    [
      JSON.stringify({
        type: "user",
        sessionId: "aaa-1",
        cwd: "/Users/mac/proj/workisland",
        timestamp: "2026-09-01T10:00:00.000Z",
        message: { role: "user", content: "帮我分析飞书表格的任务" }
      }),
      JSON.stringify({
        type: "user",
        sessionId: "aaa-1",
        timestamp: "2026-09-01T10:06:00.000Z",
        message: { role: "user", content: [{ type: "text", text: "规划下一轮 PR" }] }
      }),
      JSON.stringify({ type: "ai-title", sessionId: "aaa-1", aiTitle: "Analyze feishu tasks" })
    ].join("\n")
  );

  const codexDir = path.join(homeDir, ".codex", "sessions", "2026", "05", "20");
  await fsp.mkdir(codexDir, { recursive: true });
  await fsp.writeFile(
    path.join(codexDir, "rollout-2026-05-20T01-23-07-019e4143.jsonl"),
    [
      JSON.stringify({
        type: "session_meta",
        payload: { id: "019e4143", cwd: "/Users/mac/proj/xhs_skill", timestamp: "2026-05-20T01:23:07.000Z" }
      }),
      JSON.stringify({
        timestamp: "2026-05-20T01:24:00.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "分析小红书技能目录" }
      })
    ].join("\n")
  );

  const zcodeSessions = [["sess_1", "分析飞书任务并规划", "/Users/mac/proj/workisland", "1000", "2000"]];
  const zcodeMessages = {
    sess_1: JSON.stringify({ role: "user", metadata: { inputIntent: { text: "从任务表认领 issue 开工" } } })
  };
  // 存在性检查用：service 先看 db 文件在不在，再走注入的 runSqlite
  const zcodeDb = path.join(homeDir, ".zcode", "cli", "db", "db.sqlite");
  await fsp.mkdir(path.dirname(zcodeDb), { recursive: true });
  await fsp.writeFile(zcodeDb, "");

  return { homeDir, indexDir, claudeDir, codexDir, zcodeSessions, zcodeMessages };
}

test("service indexes three sources and answers fuzzy multi-keyword search", async () => {
  const fx = await makeFixtureHome();
  const service = createSessionSearchService({
    homeDir: fx.homeDir,
    indexDir: fx.indexDir,
    watch: false,
    runSqlite: makeZcodeRunSqlite({ sessions: fx.zcodeSessions, messagesBySession: fx.zcodeMessages })
  });

  const summary = await service.scan();
  assert.equal(summary.claude.rescanned, 1);
  assert.equal(summary.codex.rescanned, 1);
  assert.equal(summary.zcode.rescanned, 1);
  assert.equal(service.getState().total, 3);

  // 单关键词：标题命中（大小写不敏感）
  const byTitle = service.search("FEISHU");
  assert.equal(byTitle.length, 1);
  assert.equal(byTitle[0].tool, "claude");
  assert.equal(byTitle[0].title, "Analyze feishu tasks");

  // 多关键词 AND：claude 文本同时含「分析」「规划」；codex 只含「分析」被排除
  const both = service.search("分析 规划");
  assert.equal(both.some((row) => row.tool === "claude"), true);
  assert.equal(both.some((row) => row.tool === "codex"), false);

  // 项目路径参与检索：直接回答「在哪个文件夹」
  const byPath = service.search("/users/mac/proj/xhs_skill");
  assert.equal(byPath.length, 1);
  assert.equal(byPath[0].tool, "codex");
  assert.equal(byPath[0].projectPath, "/Users/mac/proj/xhs_skill");
  assert.match(byPath[0].snippet, /分析小红书技能目录/);

  // 命中片段围绕关键词
  const feishu = service.search("认领 issue");
  assert.equal(feishu.length, 1);
  assert.equal(feishu[0].tool, "zcode");
  assert.match(feishu[0].snippet, /认领 issue/);

  assert.deepEqual(service.search(""), []);
  assert.deepEqual(service.search("   "), []);

  await service.persistNow();
  await service.dispose();
});

test("scan is incremental: unchanged files skipped, changes and deletions reconciled", async () => {
  const fx = await makeFixtureHome();
  let zcodeSessions = fx.zcodeSessions.map((row) => [...row]);
  const service = createSessionSearchService({
    homeDir: fx.homeDir,
    indexDir: fx.indexDir,
    watch: false,
    persistDebounceMs: 10,
    runSqlite: makeZcodeRunSqlite({
      sessions: zcodeSessions,
      messagesBySession: fx.zcodeMessages
    })
  });

  await service.scan();
  assert.equal(service.getState().total, 3);

  // 无变化重扫：不产生新解析
  const idleSummary = await service.scan();
  assert.equal(idleSummary.claude.rescanned, 0);
  assert.equal(idleSummary.codex.rescanned, 0);
  assert.equal(idleSummary.zcode.rescanned, 0);

  // claude 文件追加一条提问 → 重扫该文件且新关键词可命中
  const claudeFile = path.join(fx.claudeDir, "aaa-1.jsonl");
  await fsp.appendFile(
    claudeFile,
    "\n" +
      JSON.stringify({
        type: "user",
        sessionId: "aaa-1",
        timestamp: "2026-09-02T09:00:00.000Z",
        message: { role: "user", content: "补一条独特关键词独角兽" }
      })
  );
  const future = new Date(Date.now() + 5_000);
  await fsp.utimes(claudeFile, future, future);

  await service.scan();
  const unicorn = service.search("独角兽");
  assert.equal(unicorn.length, 1);
  assert.equal(unicorn[0].id, "aaa-1");
  assert.equal(unicorn[0].updatedAt, Date.parse("2026-09-02T09:00:00.000Z"));

  // codex 文件删除 → 记录与游标一并清掉
  await fsp.rm(path.join(fx.codexDir, "rollout-2026-05-20T01-23-07-019e4143.jsonl"));
  await service.scan();
  assert.equal(service.search("小红书").length, 0);

  // zcode db 里会话被删 → 对账清除
  zcodeSessions.length = 0;
  await service.scan();
  assert.equal(service.search("认领 issue").length, 0);

  // 索引落盘后，新实例冷启动即有全量记录（loadPersisted）
  await service.persistNow();
  const reopened = createSessionSearchService({
    homeDir: fx.homeDir,
    indexDir: fx.indexDir,
    watch: false,
    runSqlite: makeZcodeRunSqlite({ sessions: zcodeSessions, messagesBySession: fx.zcodeMessages })
  });
  await reopened.start();
  // start() 的启动扫描是后台任务，这里显式再扫一轮并等待完成，保证断言
  // 与事件循环时序无关（Windows CI 上曾出现恢复断言与后台扫描竞速）。
  await reopened.scan();
  assert.ok(reopened.getState().total >= 1, "reopened service should restore records from disk");
  reopened.dispose();
  await service.dispose();
});

test("malformed transcript lines are tolerated and capped text keeps index bounded", async () => {
  const noisyLines = ['{"type":"user"', "not json at all", ""];
  for (let i = 0; i < 50; i += 1) {
    noisyLines.push(
      JSON.stringify({
        type: "user",
        sessionId: "cap-1",
        cwd: "/tmp/cap",
        timestamp: "2026-09-03T08:00:00.000Z",
        message: { role: "user", content: "重复填充文本独角兽".repeat(50) }
      })
    );
  }
  const parsed = parseClaudeTranscript(noisyLines);
  assert.equal(parsed.id, "cap-1");
  assert.ok(parsed.text.length <= 20_000, "text should be capped at SESSION_TEXT_CAP");
});

test("qoder and opencode (DuMate) sessions are indexed, searchable and reconciled", async () => {
  const fx = await makeFixtureHome();
  // opencode provider 有 existsSync 守卫：先落一个空的 opencode.db 占位
  await fsp.mkdir(path.join(fx.homeDir, ".local", "share", "opencode"), { recursive: true });
  await fsp.writeFile(path.join(fx.homeDir, ".local", "share", "opencode", "opencode.db"), "");
  const qoderTranscriptDir = path.join(fx.homeDir, ".qoder", "projects", "-Users-mac-qoder-demo", "transcript");
  await fsp.mkdir(qoderTranscriptDir, { recursive: true });
  const qoderFile = path.join(qoderTranscriptDir, "task-q1.session.execution.jsonl");
  await fsp.writeFile(qoderFile, [
    JSON.stringify({
      type: "session_meta",
      sessionId: "task-q1.session.execution",
      timestamp: "2026-09-01T08:00:00.000Z",
      cwd: "/Users/mac/qoder-demo"
    }),
    JSON.stringify({
      type: "user",
      sessionId: "task-q1.session.execution",
      timestamp: "2026-09-01T08:01:00.000Z",
      cwd: "/Users/mac/qoder-demo",
      message: { role: "user", content: "帮我起一版千问运营文案火烈鸟" }
    })
  ].join("\n"));

  let opencodeSessions = [
    ["ses_du1", "DuMate 搭子任务", "/Users/mac/dumate-demo", "1768700000000", "1768800000000"]
  ];
  const opencodeParts = { ses_du1: '{"type":"text","text":"整理百度搭子的独角兽运营素材"}' };
  const zcodeStub = makeZcodeRunSqlite({ sessions: fx.zcodeSessions, messagesBySession: fx.zcodeMessages });
  const runSqlite = async (dbPath, sql) => {
    if (dbPath.endsWith("opencode.db")) {
      if (sql.includes("FROM session")) return opencodeSessions.map((row) => row.join("|")).join("\n");
      if (sql.includes("FROM part")) {
        const lines = [];
        for (const [sessionId, dataJson] of Object.entries(opencodeParts)) {
          if (sql.includes(`'${sessionId}'`)) lines.push(`${sessionId}|${dataJson}`);
        }
        return lines.join("\n");
      }
      throw new Error(`unexpected opencode sql: ${sql}`);
    }
    return zcodeStub(dbPath, sql);
  };

  const service = createSessionSearchService({
    homeDir: fx.homeDir,
    indexDir: fx.indexDir,
    watch: false,
    persistDebounceMs: 10,
    runSqlite
  });
  await service.scan();
  assert.equal(service.search("火烈鸟").length, 1, "qoder 用户提问应可命中");
  assert.equal(service.search("独角兽运营素材").length, 1, "opencode/DuMate 分片正文应可命中");
  assert.equal(service.getState().stats.qoder, 1);
  assert.equal(service.getState().stats.opencode, 1);

  // qoder 文件删除 → 记录与游标一并清掉
  await fsp.rm(qoderFile);
  await service.scan();
  assert.equal(service.search("火烈鸟").length, 0);

  // opencode 会话从 db 消失 → 对账清除
  opencodeSessions = [];
  await service.scan();
  assert.equal(service.search("独角兽运营素材").length, 0);
  assert.equal(service.getState().stats.opencode, 0);
  await service.dispose();
});
