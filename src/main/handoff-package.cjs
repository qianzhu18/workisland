"use strict";

// 跨 Agent 交接包构建器 — issue #126/#129（feature/zcode-codex-handoff M1）。纯主进程模块，
// 点击「交接」时惰性构建：从会话状态 + 本地 transcript/sqlite 取对话首尾，Git 证据当场实拍。
// 不做后台预生成——闲置零成本，证据永远新鲜（EPIC-010「事实和总结分开」原则）。
//
// 数据面（2026-09-29 实机核验）：
//   claude  transcript_path 指向 ~/.claude/projects/.../*.jsonl：type=user（非 isMeta）行带
//           message.content；type=assistant 行 content 数组取 type:"text" 分片
//   codex   ~/.codex/sessions/**/rollout-*.jsonl：event_msg·user_message / agent_message，
//           老格式 response_item·message 双角色兜底；<environment_context> 等注入噪声过滤
//   zcode   ~/.zcode/cli/db/db.sqlite：用户提问在 message.data.metadata.inputIntent.text，
//           assistant 正文在 part 表 data JSON 的 type:"text" 分片（message 表本身不含正文，
//           rollout/model-io-* 是原始模型 IO 日志，含 system prompt，不可用）
//
// 解析独立于 session-search-service.cjs（索引器只收用户提问、已上线不动）；格式知识来自
// 同源的实机核验，噪声前缀保持一致避免两套口径漂移。

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const util = require("node:util");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");

const execFileAsync = util.promisify(childProcess.execFile);

const HANDOFF_SCHEMA_VERSION = 1;
// 首尾两段窗口读：大 transcript 只碰首 64KB（任务目标）与尾 256KB（最近对话），不整读
const HEAD_WINDOW_BYTES = 64 * 1024;
const TAIL_WINDOW_BYTES = 256 * 1024;
const TAIL_MAX_ENTRIES = 8; // 尾部最多保留的消息条数（user/assistant 混排）
const TAIL_ENTRY_CAP = 1500; // 单条消息截断
const LAST_MESSAGE_CAP = 2000; // 「最后状态」两字段的截断
const GOAL_CAP = 500;
const GIT_DIRTY_FILES_CAP = 10;
const ZCODE_SQL_TIMEOUT_MS = 5_000;
const ZCODE_TAIL_MESSAGE_LIMIT = 16; // message 表倒取条数（含无正文的中间步骤行）

// 与 session-search-service 的 CODEX_NOISE_PREFIXES 同口径
const CODEX_NOISE_PREFIXES = ["<environment_context>", "<user_instructions>", "<turn_context>", "# AGENTS"];

function clampText(value, cap = LAST_MESSAGE_CAP) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  return text.length > cap ? text.slice(0, cap) : text;
}

function isCodexNoise(text) {
  const trimmed = text.trimStart();
  return CODEX_NOISE_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

// ── 窗口读取：只读文件首尾两段，超大 transcript 也不整读 ─────────────────────

function readUtf8Windows(filePath, logger) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size === 0) return null;
  const whole = stat.size <= HEAD_WINDOW_BYTES + TAIL_WINDOW_BYTES;
  const fd = fs.openSync(filePath, "r");
  try {
    const readChunk = (start, length) => {
      const buffer = Buffer.alloc(length);
      const bytes = fs.readSync(fd, buffer, 0, length, start);
      return buffer.toString("utf-8", 0, bytes);
    };
    if (whole) {
      const content = readChunk(0, stat.size);
      return { head: content, tail: content };
    }
    const head = readChunk(0, HEAD_WINDOW_BYTES);
    const tailStart = stat.size - TAIL_WINDOW_BYTES;
    const tailRaw = readChunk(tailStart, TAIL_WINDOW_BYTES);
    // 从窗口中部起读会把第一行切一半：丢掉它（首段同理丢最后半行）
    return { head: head.slice(0, head.lastIndexOf("\n")), tail: tailRaw.slice(tailRaw.indexOf("\n") + 1) };
  } catch (error) {
    logger?.warn?.("handoff: read transcript windows failed", filePath, error?.message);
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function parseJsonLines(content) {
  const entries = [];
  for (const line of content.split("\n")) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry === "object") entries.push(entry);
    } catch {
      // 半行 / 非 JSON 行直接跳过
    }
  }
  return entries;
}

// ── claude 家族（claude / 其他 claude 兼容 transcript）：user + assistant 尾部 ──

function textFromClaudeContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const item of content) {
    if (item && item.type === "text" && typeof item.text === "string") parts.push(item.text);
  }
  return parts.join("\n");
}

function claudeEntryToMessage(entry) {
  const type = entry.type;
  if (type === "user") {
    if (entry.isMeta) return null;
    const text = textFromClaudeContent(entry.message && entry.message.content);
    return text ? { role: "user", text } : null;
  }
  if (type === "assistant") {
    const text = textFromClaudeContent(entry.message && entry.message.content);
    return text ? { role: "assistant", text } : null;
  }
  return null;
}

function extractClaudeConversation(headEntries, tailEntries) {
  // 首段：第一条真实用户提问 = 任务目标的最佳来源；ai-title 作兜底
  let firstUserPrompt = "";
  let title = "";
  for (const entry of headEntries) {
    if (!title && entry.type === "ai-title" && typeof entry.aiTitle === "string") title = entry.aiTitle;
    if (!firstUserPrompt) {
      const message = claudeEntryToMessage(entry);
      if (message?.role === "user") firstUserPrompt = message.text;
    }
    if (title && firstUserPrompt) break;
  }
  const tail = collectTail(tailEntries.map(claudeEntryToMessage).filter(Boolean));
  return { firstUserPrompt: clampText(firstUserPrompt, GOAL_CAP), title: clampText(title, 200), tail };
}

// ── codex rollout：user_message / agent_message + response_item 兜底 ──────────

function codexEntryToMessage(entry) {
  const type = entry.type;
  const payload = entry.payload && typeof entry.payload === "object" ? entry.payload : {};
  if (type === "event_msg") {
    if (payload.type === "user_message") {
      const raw = typeof payload.message === "string" ? payload.message : typeof payload.text === "string" ? payload.text : "";
      return raw && !isCodexNoise(raw) ? { role: "user", text: raw } : null;
    }
    if (payload.type === "agent_message" && typeof payload.message === "string" && payload.message) {
      return { role: "assistant", text: payload.message };
    }
    return null;
  }
  if (type === "response_item" && payload.type === "message") {
    const items = Array.isArray(payload.content) ? payload.content : [];
    const parts = [];
    for (const item of items) {
      if (item && typeof item.text === "string") parts.push(item.text);
    }
    const raw = parts.join("\n");
    if (!raw) return null;
    if (payload.role === "user") return isCodexNoise(raw) ? null : { role: "user", text: raw };
    if (payload.role === "assistant") return { role: "assistant", text: raw };
  }
  return null;
}

function extractCodexConversation(headEntries, tailEntries) {
  let firstUserPrompt = "";
  for (const entry of headEntries) {
    const message = codexEntryToMessage(entry);
    if (message?.role === "user") {
      firstUserPrompt = message.text;
      break;
    }
  }
  const tail = collectTail(tailEntries.map(codexEntryToMessage).filter(Boolean));
  return { firstUserPrompt: clampText(firstUserPrompt, GOAL_CAP), title: "", tail };
}

function collectTail(messages) {
  const tail = [];
  for (const message of messages) {
    const text = clampText(message.text, TAIL_ENTRY_CAP);
    if (text) tail.push({ role: message.role, text });
    if (tail.length >= TAIL_MAX_ENTRIES) break;
  }
  return tail;
}

// ── zcode：sqlite3 列表模式（JSON 恒为末列，竖杠回拼，同 usage-discovery 先例）──

function parseSqliteRows(stdout, columnCount) {
  const rows = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const fields = line.split("|");
    if (fields.length < columnCount) continue;
    rows.push([...fields.slice(0, columnCount - 1), fields.slice(columnCount - 1).join("|")]);
  }
  return rows;
}

function zcodeUserTextFromData(data) {
  const metadata = data.metadata && typeof data.metadata === "object" ? data.metadata : {};
  const intent = metadata.inputIntent && typeof metadata.inputIntent === "object" ? metadata.inputIntent : {};
  const conversationIntent =
    metadata.conversationInputIntent && typeof metadata.conversationInputIntent === "object" ? metadata.conversationInputIntent : {};
  const text =
    typeof intent.text === "string" && intent.text ? intent.text : typeof conversationIntent.text === "string" ? conversationIntent.text : "";
  return text || "";
}

function defaultRunSqlite(dbPath, sql) {
  return execFileAsync("sqlite3", [dbPath, sql], {
    encoding: "utf-8",
    timeout: ZCODE_SQL_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024
  }).then(({ stdout }) => stdout);
}

// 会话 id 只允许 UUID 形态字符：db 查询按字面拼 SQL，守一道注入
function assertSqliteId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("handoff: invalid sqlite session id");
  }
  return value;
}

async function zcodeConversationFromDb({ sessionId, runSqlite, logger }) {
  assertSqliteId(sessionId);
  // message 倒取（含无正文的中间 assistant 步骤行），parts 按 sequence 正序回填正文；
  // 首条用户提问单独正序取（长会话里它不在尾部窗口内）
  const messagesSql =
    `SELECT sequence, id, data FROM message WHERE session_id = '${sessionId}' ` +
    `ORDER BY sequence DESC LIMIT ${ZCODE_TAIL_MESSAGE_LIMIT}`;
  const partsSql =
    `SELECT message_id, data FROM part WHERE session_id = '${sessionId}' ` +
    `AND data LIKE '%"type":"text"%' ORDER BY sequence`;
  const firstUserSql =
    `SELECT data FROM message WHERE session_id = '${sessionId}' ` +
    `AND data LIKE '%"role":"user"%' ORDER BY sequence ASC LIMIT 1`;
  const [messagesOut, partsOut, firstUserOut] = await Promise.all([
    runSqlite(messagesSql),
    runSqlite(partsSql).catch(() => ""),
    runSqlite(firstUserSql).catch(() => "")
  ]);
  let firstUserPrompt = "";
  const firstRows = parseSqliteRows(firstUserOut, 1);
  if (firstRows.length) {
    try {
      firstUserPrompt = clampText(zcodeUserTextFromData(JSON.parse(firstRows[0][0])), GOAL_CAP);
    } catch {
      // 首条解析失败不阻断：goal 兜底链还有 session.title
    }
  }
  const textPartsByMessage = new Map();
  for (const row of parseSqliteRows(partsOut, 2)) {
    let data;
    try {
      data = JSON.parse(row[1]);
    } catch {
      continue;
    }
    if (!data || data.type !== "text" || typeof data.text !== "string" || !data.text) continue;
    const list = textPartsByMessage.get(row[0]) ?? [];
    list.push(data.text);
    textPartsByMessage.set(row[0], list);
  }
  const messages = [];
  for (const row of parseSqliteRows(messagesOut, 3)) {
    let data;
    try {
      data = JSON.parse(row[2]);
    } catch {
      continue;
    }
    if (!data || typeof data.role !== "string") continue;
    if (data.role === "user") {
      const text = zcodeUserTextFromData(data);
      if (text) messages.push({ role: "user", text });
    } else if (data.role === "assistant") {
      const text = (textPartsByMessage.get(row[1]) ?? []).join("\n").trim();
      if (text) messages.push({ role: "assistant", text });
    }
  }
  // SQL 倒取 → 反转回时间正序
  messages.reverse();
  return { firstUserPrompt, title: "", tail: messages };
}

// ── Git 证据：生成时实拍 ─────────────────────────────────────────────────────

async function defaultRunGit(args, options) {
  const { stdout } = await execFileAsync("git", args, { encoding: "utf-8", timeout: 5_000, ...options });
  return stdout;
}

async function gitEvidence(dir, { runGit = defaultRunGit, logger } = {}) {
  const evidence = { isRepo: false, branch: "", commit: "", dirtyCount: 0, dirtyFiles: [] };
  if (!dir || typeof dir !== "string") return evidence;
  try {
    const inside = (await runGit(["-C", dir, "rev-parse", "--is-inside-work-tree"])).trim();
    if (inside !== "true") return evidence;
    evidence.isRepo = true;
    const [branch, commit, porcelain] = await Promise.all([
      runGit(["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"]).catch(() => ""),
      runGit(["-C", dir, "rev-parse", "HEAD"]).catch(() => ""),
      runGit(["-C", dir, "status", "--porcelain"]).catch(() => "")
    ]);
    evidence.branch = branch.trim();
    evidence.commit = commit.trim().slice(0, 12);
    const lines = porcelain.split("\n").filter((line) => line.trim());
    evidence.dirtyCount = lines.length;
    evidence.dirtyFiles = lines.slice(0, GIT_DIRTY_FILES_CAP).map((line) => line.trim());
  } catch (error) {
    // git 未装 / 目录不存在：证据标非 repo，不阻断构建
    logger?.debug?.("handoff: git evidence failed", dir, error?.message);
  }
  return evidence;
}

// ── 包组装与渲染 ─────────────────────────────────────────────────────────────

function newHandoffId(now) {
  return `hof_${now.toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

function conversationFromTranscript(tool, transcriptPath, { logger }) {
  if (!transcriptPath || typeof transcriptPath !== "string") return null;
  const windows = readUtf8Windows(transcriptPath, logger);
  if (!windows) return null;
  if (tool === "codex") {
    return extractCodexConversation(parseJsonLines(windows.head), parseJsonLines(windows.tail));
  }
  // claude 及 claude 兼容 transcript（jsonl 行级 JSON）
  return extractClaudeConversation(parseJsonLines(windows.head), parseJsonLines(windows.tail));
}

async function buildHandoffPackage({ tool, session, transcriptPath }, deps) {
  const { homeDir = os.homedir(), runSqlite = defaultRunSqlite, logger } = deps ?? {};
  if (!session || typeof session !== "object") throw new Error("handoff: session is required");
  const now = Date.now();
  const projectDir = session.jumpTarget?.workingDirectory || "";

  const asyncParts = [];
  // zcode 的对话在 sqlite；claude/codex 的在 transcript 文件；都失败 → 降级为仅会话状态字段
  if (tool === "zcode") {
    asyncParts.push(zcodeConversationFromDb({ sessionId: session.id, runSqlite, logger }).catch(() => null));
  } else {
    asyncParts.push(Promise.resolve(conversationFromTranscript(tool, transcriptPath, { logger })));
  }
  asyncParts.push(gitEvidence(projectDir, { logger }));

  const [conversation, git] = await Promise.all(asyncParts);
  {
    const tail = conversation?.tail ?? [];
    const tailLastUser = [...tail].reverse().find((m) => m.role === "user")?.text ?? "";
    const tailLastAssistant = [...tail].reverse().find((m) => m.role === "assistant")?.text ?? "";
    const goal =
      clampText(session.title, GOAL_CAP) ||
      clampText(conversation?.firstUserPrompt, GOAL_CAP) ||
      clampText(session.latestUserPrompt, GOAL_CAP);
    const pkg = {
      id: newHandoffId(now),
      schemaVersion: HANDOFF_SCHEMA_VERSION,
      generatedAt: new Date(now).toISOString(),
      source: {
        tool,
        sessionId: session.id,
        title: clampText(session.title, 200),
        transcriptPath: transcriptPath || "",
        transcriptAvailable: !!(conversation && (conversation.firstUserPrompt || tail.length)),
        error: session.error || ""
      },
      projectDir,
      goal,
      lastUserPrompt: clampText(session.latestUserPrompt || tailLastUser),
      lastAssistantMessage: clampText(session.lastAssistantMessage || tailLastAssistant),
      tail,
      git
    };
    return pkg;
  }
}

function renderGitLine(git) {
  if (!git.isRepo) return "非 Git 仓库";
  const parts = [];
  if (git.branch) parts.push(git.branch);
  if (git.commit) parts.push(`@ ${git.commit}`);
  const dirty = git.dirtyCount > 0 ? `（${git.dirtyCount} 处未提交）` : "（工作区干净）";
  return parts.join(" ") + dirty;
}

function renderHandoffMarkdown(pkg, { packageDir } = {}) {
  const lines = [];
  lines.push(`# 交接包 ${pkg.id}`);
  lines.push("");
  lines.push(`- 来源：${pkg.source.tool} · ${pkg.source.title || pkg.source.sessionId}`);
  lines.push(`- 生成时间：${pkg.generatedAt}`);
  if (pkg.source.error) lines.push(`- 结束状态：${pkg.source.error}`);
  lines.push("");
  lines.push("## 任务目标");
  lines.push("");
  lines.push(pkg.goal || "（来源会话未提供目标，请参考对话尾部）");
  lines.push("");
  lines.push("## 工作位置（生成时实拍）");
  lines.push("");
  lines.push(`- 目录：${pkg.projectDir || "未知"}`);
  lines.push(`- Git：${renderGitLine(pkg.git)}`);
  if (pkg.git.dirtyFiles.length) {
    lines.push(`- 未提交改动（前 ${pkg.git.dirtyFiles.length} 条）：`);
    for (const file of pkg.git.dirtyFiles) lines.push(`  - ${file}`);
  }
  lines.push("");
  lines.push("## 最近状态");
  lines.push("");
  lines.push(`用户最后说：`);
  lines.push("");
  lines.push(pkg.lastUserPrompt || "（无）");
  lines.push("");
  lines.push(`上一个 Agent 最后回复：`);
  lines.push("");
  lines.push(pkg.lastAssistantMessage || "（无）");
  lines.push("");
  if (pkg.tail.length) {
    lines.push("## 对话尾部（原文，时间正序）");
    lines.push("");
    for (const message of pkg.tail) {
      lines.push(`**${message.role === "user" ? "用户" : "Agent"}**：${message.text}`);
      lines.push("");
    }
  }
  lines.push("## 原始记录");
  lines.push("");
  lines.push(`- transcript：${pkg.source.transcriptPath || "不可用"}`);
  if (packageDir) lines.push(`- 本交接包目录：${packageDir}`);
  lines.push("");
  return lines.join("\n");
}

function renderHandoffPrompt(pkg, { packageDir, locale = "zh", confirmFirst = true } = {}) {
  const markdownPath = packageDir ? `${packageDir}/HANDOFF.md` : "";
  if (locale === "en") {
    const confirm = confirmFirst
      ? "Restate in 3 lines or fewer: 1) the task goal; 2) current Git position and uncommitted changes; 3) your proposed next step. Wait for my confirmation before touching any files."
      : "Briefly restate the task goal and your next step, then continue.";
    return [
      `You are taking over a task handed off via WorkIsland. The previous agent (${pkg.source.tool}, "${pkg.source.title || pkg.source.sessionId}") stopped in this project:`,
      ``,
      `Project directory: ${pkg.projectDir}`,
      `Git: ${renderGitLine(pkg.git)}`,
      ...(markdownPath ? [`Handoff package (goal, recent conversation tail, Git evidence): ${markdownPath}`] : []),
      ``,
      `Read the handoff package first, then ${confirm}`
    ].join("\n");
  }
  const confirm = confirmFirst
    ? "然后用不超过 3 行复述：1) 任务目标；2) 当前 Git 位置与未提交改动；3) 你建议的下一步。在我确认之前不要修改任何文件。"
    : "然后简要复述任务目标与下一步，直接继续。";
  return [
    `你是从 WorkIsland 跨 Agent 交接接手的 Agent。上一个 Agent（${pkg.source.tool}，会话「${pkg.source.title || pkg.source.sessionId}」）在以下项目中停止：`,
    ``,
    `项目目录：${pkg.projectDir}`,
    `Git：${renderGitLine(pkg.git)}`,
    ...(markdownPath ? [`交接包（任务目标、最近对话尾部、Git 证据）已保存在本机：${markdownPath}`] : []),
    ``,
    `请先读取交接包，${confirm}`
  ].join("\n");
}

function createHandoffPackageBuilder(options = {}) {
  const deps = {
    homeDir: options.homeDir ?? os.homedir(),
    runSqlite: options.runSqlite ?? ((sql) => defaultRunSqlite(path.join(options.homeDir ?? os.homedir(), ".zcode", "cli", "db", "db.sqlite"), sql)),
    runGit: options.runGit ?? defaultRunGit,
    logger: options.logger ?? { info() {}, debug() {}, warn() {}, error() {} }
  };
  return {
    buildHandoffPackage: (input) => buildHandoffPackage(input, deps),
    gitEvidence: (dir) => gitEvidence(dir, deps),
    renderHandoffMarkdown,
    renderHandoffPrompt
  };
}

module.exports = {
  createHandoffPackageBuilder,
  buildHandoffPackage,
  gitEvidence,
  renderHandoffMarkdown,
  renderHandoffPrompt,
  // 供单测直接使用
  extractClaudeConversation,
  extractCodexConversation,
  claudeEntryToMessage,
  codexEntryToMessage,
  zcodeConversationFromDb,
  parseSqliteRows,
  readUtf8Windows
};
