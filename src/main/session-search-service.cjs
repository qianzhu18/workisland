"use strict";

// 会话搜索索引器 — issue #115 / PRD-019 M1。纯主进程模块：增量扫描三家 Agent 的本地会话，
// 只抽取「用户提问 + 标题 + 项目路径」建索引（P0 不索引 AI 回复正文），供 M2 的搜索 UI 查询。
// 数据面 2026-09-07 实机核验：
//   claude ~/.claude/projects/<编码路径>/*.jsonl      行级 JSON：type=user 行带 message.content/cwd/timestamp，
//                                                     type=ai-title 行带 aiTitle；目录名把 `/` 和空格都编成 `-`，
//                                                     反解不可靠 → 项目路径必须读行内 cwd
//   codex  ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl  首行 session_meta(payload.id/cwd)，用户提问在
//                                                     event_msg·user_message；response_item 里的
//                                                     <environment_context> 等注入噪声必须过滤
//   zcode  ~/.zcode/cli/db/db.sqlite                  session 表（title/directory/time_updated）+ message 表
//                                                     （data JSON，用户提问在 metadata.inputIntent.text）；
//                                                     sqlite3 CLI 列表模式，同 usage-discovery 先例，零新依赖

const fs = require("node:fs");
const fsp = fs.promises;
const os = require("node:os");
const path = require("node:path");
const util = require("node:util");
const childProcess = require("node:child_process");

const execFileAsync = util.promisify(childProcess.execFile);

const INDEX_FORMAT_VERSION = 1;
const INDEX_FILE_NAME = "session-search-index.json";
const SCAN_WATCH_DEBOUNCE_MS = 2 * 60 * 1000; // fs.watch 抖动合并：会话文件写入频繁，节流到分钟级守护闲置 CPU
const SESSION_TEXT_CAP = 20_000; // 每会话收录的用户提问文本上限
const ZCODE_SQL_TIMEOUT_MS = 5_000;
const ZCODE_MESSAGE_CHUNK = 80; // message 表 IN 查询的会话分片大小
const SEARCH_DEFAULT_LIMIT = 30;
const SNIPPET_CONTEXT_CHARS = 80;

// codex 会把系统上下文当作 user 消息写进 rollout；命中它们只会污染搜索结果
const CODEX_NOISE_PREFIXES = ["<environment_context>", "<user_instructions>", "<turn_context>", "# AGENTS"];

function clampText(value, cap = SESSION_TEXT_CAP) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  return text.length > cap ? text.slice(0, cap) : text;
}

function toTimestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

// ── claude：逐行解析一种 transcript ──────────────────────────────────────────

function textFromClaudeContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const item of content) {
    // tool_result / image 等一律丢弃：P0 只检索用户亲口说的话
    if (item && item.type === "text" && typeof item.text === "string") parts.push(item.text);
  }
  return parts.join("\n");
}

function parseClaudeTranscript(lines) {
  let projectPath = "";
  let title = "";
  let updatedAtMs = 0;
  const texts = [];
  let sessionId = "";
  for (const line of lines) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    if (!sessionId && typeof entry.sessionId === "string") sessionId = entry.sessionId;
    const type = entry.type;
    if (type === "ai-title") {
      if (typeof entry.aiTitle === "string" && entry.aiTitle) title = entry.aiTitle;
      continue;
    }
    if (type === "summary") {
      if (!title && typeof entry.summary === "string") title = entry.summary;
      continue;
    }
    if (type !== "user" || entry.isMeta) continue;
    if (!projectPath && typeof entry.cwd === "string" && entry.cwd) projectPath = entry.cwd;
    const ts = toTimestampMs(entry.timestamp);
    if (ts > updatedAtMs) updatedAtMs = ts;
    const text = clampText(textFromClaudeContent(entry.message && entry.message.content), SESSION_TEXT_CAP);
    if (text) texts.push(text);
    if (texts.join("\n").length >= SESSION_TEXT_CAP) break;
  }
  return {
    id: sessionId,
    projectPath,
    title: clampText(title, 200),
    text: clampText(texts.join("\n")),
    updatedAt: updatedAtMs
  };
}

// ── codex：rollout 文件（session_meta + event_msg/response_item）────────────

function isCodexNoise(text) {
  const trimmed = text.trimStart();
  return CODEX_NOISE_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

function textFromCodexContentItems(items) {
  if (!Array.isArray(items)) return "";
  const parts = [];
  for (const item of items) {
    if (item && typeof item.text === "string") parts.push(item.text);
  }
  return parts.join("\n");
}

function parseCodexTranscript(lines) {
  let projectPath = "";
  let id = "";
  let updatedAtMs = 0;
  const texts = [];
  for (const line of lines) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const type = entry.type;
    const payload = entry.payload && typeof entry.payload === "object" ? entry.payload : {};
    if (type === "session_meta") {
      if (!id && typeof payload.id === "string") id = payload.id;
      if (!projectPath && typeof payload.cwd === "string") projectPath = payload.cwd;
      const ts = toTimestampMs(payload.timestamp);
      if (ts > updatedAtMs) updatedAtMs = ts;
      continue;
    }
    if (type === "event_msg" && payload.type === "user_message") {
      const raw = typeof payload.message === "string" ? payload.message : typeof payload.text === "string" ? payload.text : "";
      if (raw && !isCodexNoise(raw)) {
        texts.push(clampText(raw, SESSION_TEXT_CAP));
        const ts = toTimestampMs(entry.timestamp);
        if (ts > updatedAtMs) updatedAtMs = ts;
      }
      continue;
    }
    // 老格式兜底：response_item 里的 user message（content 为 input_text 数组）
    if (type === "response_item" && payload.type === "message" && payload.role === "user") {
      const raw = clampText(textFromCodexContentItems(payload.content), SESSION_TEXT_CAP);
      if (raw && !isCodexNoise(raw)) texts.push(raw);
    }
    if (texts.join("\n").length >= SESSION_TEXT_CAP) break;
  }
  return {
    id,
    projectPath,
    title: "",
    text: clampText(texts.join("\n")),
    updatedAt: updatedAtMs
  };
}

// ── zcode：sqlite3 列表模式行解析 + message.data JSON 抽取 ──────────────────

function parseSqliteRows(stdout, columnCount) {
  const rows = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const fields = line.split("|");
    if (fields.length < columnCount) continue;
    // 末列允许含竖杠（message.data 是 JSON），回拼保证完整
    rows.push(columnCount === 1 ? [line] : [...fields.slice(0, columnCount - 1), fields.slice(columnCount - 1).join("|")]);
  }
  return rows;
}

function zcodeUserTextFromData(dataJson) {
  let data;
  try {
    data = JSON.parse(dataJson);
  } catch {
    return "";
  }
  if (!data || data.role !== "user") return "";
  const metadata = data.metadata && typeof data.metadata === "object" ? data.metadata : {};
  const intent = metadata.inputIntent && typeof metadata.inputIntent === "object" ? metadata.inputIntent : {};
  const conversationIntent =
    metadata.conversationInputIntent && typeof metadata.conversationInputIntent === "object" ? metadata.conversationInputIntent : {};
  return clampText(typeof intent.text === "string" ? intent.text : typeof conversationIntent.text === "string" ? conversationIntent.text : "");
}

// ── 服务 ────────────────────────────────────────────────────────────────────

function defaultRunSqlite(dbPath, sql) {
  return execFileAsync("sqlite3", [dbPath, sql], {
    encoding: "utf-8",
    timeout: ZCODE_SQL_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024
  }).then(({ stdout }) => stdout);
}

const ZCODE_SESSIONS_SQL = [
  "SELECT id, REPLACE(REPLACE(title, char(124), '/'), char(10), ' '),",
  "       REPLACE(directory, char(124), '/'),",
  "       time_created, time_updated",
  "FROM session ORDER BY time_updated DESC"
].join(" ");

const ZCODE_MESSAGES_SQL = (sessionList) =>
  `SELECT session_id, data FROM message WHERE session_id IN (${sessionList.join(",")})`;

const OPENCODE_SESSIONS_SQL = [
  "SELECT id, REPLACE(REPLACE(title, char(124), '/'), char(10), ' '),",
  "       REPLACE(directory, char(124), '/'),",
  "       time_created, time_updated",
  "FROM session ORDER BY time_updated DESC"
].join(" ");

// 用户提问正文在 part 表（type:"text" 分片），且只取 role:"user" 消息的分片。
const OPENCODE_PARTS_SQL = (sessionList) =>
  `SELECT p.session_id, p.data FROM part p JOIN message m ON m.id = p.message_id ` +
  `WHERE p.session_id IN (${sessionList.join(",")}) AND p.data LIKE '%"type":"text"%' AND m.data LIKE '%"role":"user"%'`;

function createSessionSearchService({
  homeDir = os.homedir(),
  indexDir,
  logger = { info() {}, debug() {}, warn() {}, error() {} },
  runSqlite = defaultRunSqlite,
  watch = true,
  scanDebounceMs = SCAN_WATCH_DEBOUNCE_MS,
  persistDebounceMs = 3_000
} = {}) {
  const claudeRoot = path.join(homeDir, ".claude", "projects");
  const codexRoot = path.join(homeDir, ".codex", "sessions");
  const zcodeDbPath = path.join(homeDir, ".zcode", "cli", "db", "db.sqlite");
  // 千问办公（Qoder CLI）：~/.qoder/projects/<项目>/transcript/*.jsonl
  const qoderRoot = path.join(homeDir, ".qoder", "projects");
  // OpenCode / DuMate（百度搭子内嵌 OpenCode 运行时）：共享默认 XDG 数据目录
  const opencodeDbPath = path.join(homeDir, ".local", "share", "opencode", "opencode.db");
  const indexPath = path.join(indexDir, INDEX_FILE_NAME);

  const state = {
    started: false,
    scanning: false,
    lastScanAt: 0,
    lastError: "",
    records: new Map(), // key -> record
    fileCursors: new Map(), // transcriptPath -> { mtimeMs, size, key, source }
    zcodeMessageCursor: 0,
    opencodeMessageCursor: 0,
    stats: { claude: 0, codex: 0, zcode: 0 }
  };

  let watchers = [];
  let scanTimer = null;
  let persistTimer = null;
  let scanningChain = Promise.resolve();

  function pathsForRecord(record) {
    const haystackParts = [record.title, record.text, record.projectPath].filter(Boolean);
    return haystackParts.join("\n");
  }

  function upsertRecord(record) {
    if (!record.id && !record.transcriptPath) return;
    const key = record.key;
    const prev = state.records.get(key);
    // 增量文件重扫时保留较新的时间戳，避免乱序行回退
    const updatedAt = Math.max(record.updatedAt || 0, prev?.updatedAt || 0) || record.updatedAt || 0;
    state.records.set(key, { ...record, updatedAt });
  }

  // 写盘串行化：防抖写入与 persistNow 并发时共享同一个 .tmp 路径，
  // Windows 上并发 rename 会 EPERM/ENOENT——排队执行，绝不重叠。
  let writingChain = Promise.resolve();

  function writeIndex() {
    const run = writingChain.then(async () => {
      const payload = {
        version: INDEX_FORMAT_VERSION,
        savedAt: new Date().toISOString(),
        records: [...state.records.values()],
        fileCursors: [...state.fileCursors.entries()],
        zcodeMessageCursor: state.zcodeMessageCursor,
        opencodeMessageCursor: state.opencodeMessageCursor
      };
      await fsp.mkdir(indexDir, { recursive: true });
      const tmpPath = `${indexPath}.${process.pid}-${Date.now()}.tmp`;
      await fsp.writeFile(tmpPath, JSON.stringify(payload));
      await fsp.rename(tmpPath, indexPath);
    });
    writingChain = run.catch(() => {});
    return run;
  }

  function schedulePersist() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      writeIndex().catch((err) => {
        logger.warn?.("[SessionSearch] index persist failed:", err && err.message);
      });
    }, persistDebounceMs);
  }

  function persistNow() {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    return writeIndex();
  }

  async function loadPersisted() {
    let raw;
    try {
      raw = await fsp.readFile(indexPath, "utf-8");
    } catch (err) {
      // 首次启动没有索引文件属正常；其他读失败留痕，避免冷启动恢复被静默吞掉
      if (err && err.code !== "ENOENT") {
        logger.warn?.("[SessionSearch] index read failed, starting empty:", err.message);
      }
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed.version !== INDEX_FORMAT_VERSION || !Array.isArray(parsed.records)) return;
      for (const record of parsed.records) {
        if (record && record.key && record.tool) state.records.set(record.key, record);
      }
      for (const [filePath, cursor] of parsed.fileCursors || []) {
        if (filePath && cursor) state.fileCursors.set(filePath, cursor);
      }
      state.zcodeMessageCursor = Number(parsed.zcodeMessageCursor) || 0;
      state.opencodeMessageCursor = Number(parsed.opencodeMessageCursor) || 0;
    } catch (err) {
      logger.warn?.("[SessionSearch] index load failed, rebuilding:", err && err.message);
    }
  }

  function cursorMatches(filePath, stat) {
    const cursor = state.fileCursors.get(filePath);
    return !!cursor && cursor.mtimeMs === stat.mtimeMs && cursor.size === stat.size;
  }

  function recordKeyForFile(source, filePath, parsed) {
    const stem = path.basename(filePath, ".jsonl");
    return `${source}:${parsed.id || stem}`;
  }

  // 通用 JSONL 文件扫描：cursor 未变跳过，变了就整文件重解析并 upsert
  async function scanJsonlSource({ source, roots, parseTranscript }) {
    let seenPaths = new Set();
    let scanned = 0;
    const candidateFiles = [];
    for (const root of roots) {
      let rootEntries;
      try {
        rootEntries = await fsp.readdir(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const dirEntry of rootEntries) {
        if (source === "claude") {
          // claude：一级项目目录 → 文件
          if (!dirEntry.isDirectory()) continue;
          const projectDir = path.join(root, dirEntry.name);
          let files;
          try {
            files = await fsp.readdir(projectDir, { withFileTypes: true });
          } catch {
            continue;
          }
          for (const file of files) {
            if (file.isFile() && file.name.endsWith(".jsonl")) candidateFiles.push(path.join(projectDir, file.name));
          }
        } else if (source === "qoder") {
          // qoder：一级项目目录 → transcript/ → 文件
          if (!dirEntry.isDirectory()) continue;
          const transcriptDir = path.join(root, dirEntry.name, "transcript");
          let files;
          try {
            files = await fsp.readdir(transcriptDir, { withFileTypes: true });
          } catch {
            continue;
          }
          for (const file of files) {
            if (file.isFile() && file.name.endsWith(".jsonl")) candidateFiles.push(path.join(transcriptDir, file.name));
          }
        } else {
          // codex：YYYY/MM/DD 三层日期目录 → 文件
          if (!dirEntry.isDirectory()) continue;
          const yearDir = path.join(root, dirEntry.name);
          let monthEntries;
          try {
            monthEntries = await fsp.readdir(yearDir, { withFileTypes: true });
          } catch {
            continue;
          }
          for (const monthEntry of monthEntries) {
            if (!monthEntry.isDirectory()) continue;
            const monthDir = path.join(yearDir, monthEntry.name);
            let dayEntries;
            try {
              dayEntries = await fsp.readdir(monthDir, { withFileTypes: true });
            } catch {
              continue;
            }
            for (const dayEntry of dayEntries) {
              if (!dayEntry.isDirectory()) continue;
              const dayDir = path.join(monthDir, dayEntry.name);
              let files;
              try {
                files = await fsp.readdir(dayDir, { withFileTypes: true });
              } catch {
                continue;
              }
              for (const file of files) {
                if (file.isFile() && file.name.endsWith(".jsonl")) candidateFiles.push(path.join(dayDir, file.name));
              }
            }
          }
        }
      }
    }

    const changedFiles = [];
    for (const filePath of candidateFiles) {
      seenPaths.add(filePath);
      let stat;
      try {
        stat = await fsp.stat(filePath);
      } catch {
        continue;
      }
      if (cursorMatches(filePath, stat)) continue;
      changedFiles.push({ filePath, stat });
    }

    for (const { filePath, stat } of changedFiles) {
      let content;
      try {
        content = await fsp.readFile(filePath, "utf-8");
      } catch {
        continue;
      }
      const parsed = parseTranscript(content.split("\n"));
      const key = recordKeyForFile(source, filePath, parsed);
      if (parsed.text || parsed.title || parsed.projectPath) {
        upsertRecord({
          key,
          tool: source,
          id: parsed.id,
          projectPath: parsed.projectPath,
          title: parsed.title,
          text: parsed.text,
          updatedAt: parsed.updatedAt || Math.round(stat.mtimeMs),
          transcriptPath: filePath
        });
      }
      state.fileCursors.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, key, source });
      scanned += 1;
      // 让出事件循环：首次全量可能有上千文件，不能一口气吃完
      if (scanned % 20 === 0) await new Promise((resolve) => setImmediate(resolve));
    }

    // 文件已消失的会话：清记录清游标
    for (const [filePath, cursor] of state.fileCursors) {
      if (cursor.source === source && !seenPaths.has(filePath)) {
        if (cursor.key) state.records.delete(cursor.key);
        state.fileCursors.delete(filePath);
      }
    }

    return { files: candidateFiles.length, rescanned: scanned };
  }

  async function scanZcodeSource() {
    if (!fs.existsSync(zcodeDbPath)) return { files: 0, rescanned: 0, unavailable: true };
    let sessionsStdout;
    try {
      sessionsStdout = await runSqlite(zcodeDbPath, ZCODE_SESSIONS_SQL);
    } catch (err) {
      logger.debug?.("[SessionSearch] zcode scan unavailable:", err && err.message);
      return { files: 0, rescanned: 0, unavailable: true };
    }

    // 全量会话清单每轮都拉（几千行以内，成本低）：顺带完成「db 里已删除会话」的对账
    const sessionRows = parseSqliteRows(sessionsStdout, 5);
    const liveIds = new Set();
    const staleKeys = new Set();
    for (const [id, title, directory, timeCreated, timeUpdated] of sessionRows) {
      if (!id) continue;
      liveIds.add(id);
      staleKeys.add(`zcode:${id}`);
    }
    for (const [key, record] of state.records) {
      if (record.tool === "zcode" && !staleKeys.has(key)) state.records.delete(key);
    }

    // 只对新增/有更新的会话重新抽取用户提问
    const changedRows = sessionRows.filter((row) => {
      const id = row[0];
      const timeUpdated = Number(row[4]) || 0;
      const key = `zcode:${id}`;
      return !state.records.has(key) || timeUpdated > state.zcodeMessageCursor;
    });
    if (!changedRows.length) return { files: sessionRows.length, rescanned: 0 };

    let maxUpdated = state.zcodeMessageCursor;
    for (const row of changedRows) {
      const [id, title, directory, timeCreated, timeUpdated] = row;
      const updatedAt = Number(timeUpdated) || Number(timeCreated) || 0;
      if (updatedAt > maxUpdated) maxUpdated = updatedAt;
      const record = {
        key: `zcode:${id}`,
        tool: "zcode",
        id,
        projectPath: directory || "",
        title: clampText(title, 200),
        text: "",
        updatedAt,
        transcriptPath: ""
      };
      // title 本身就是首条用户消息（ZCode 自动生成），已经能撑起模糊检索；
      // 正文抽取失败不阻塞会话入库
      try {
        const quoted = `'${id.replace(/'/g, "''")}'`;
        const messagesStdout = await runSqlite(zcodeDbPath, ZCODE_MESSAGES_SQL([quoted]));
        const texts = [];
        for (const [, dataJson] of parseSqliteRows(messagesStdout, 2)) {
          const text = zcodeUserTextFromData(dataJson);
          if (text) texts.push(text);
          if (texts.join("\n").length >= SESSION_TEXT_CAP) break;
        }
        record.text = clampText(texts.join("\n"));
      } catch (err) {
        logger.debug?.("[SessionSearch] zcode message extract failed:", err && err.message);
      }
      upsertRecord(record);
      await new Promise((resolve) => setImmediate(resolve));
    }
    state.zcodeMessageCursor = maxUpdated;
    return { files: sessionRows.length, rescanned: changedRows.length };
  }

  async function scanOpencodeSource() {
    if (!fs.existsSync(opencodeDbPath)) return { files: 0, rescanned: 0, unavailable: true };
    let sessionsStdout;
    try {
      sessionsStdout = await runSqlite(opencodeDbPath, OPENCODE_SESSIONS_SQL);
    } catch (err) {
      logger.debug?.("[SessionSearch] opencode scan unavailable:", err && err.message);
      return { files: 0, rescanned: 0, unavailable: true };
    }

    // 全量会话清单每轮都拉：顺带完成「db 里已删除会话」的对账
    const sessionRows = parseSqliteRows(sessionsStdout, 5);
    const staleKeys = new Set();
    for (const [id] of sessionRows) {
      if (id) staleKeys.add(`opencode:${id}`);
    }
    for (const [key, record] of state.records) {
      if (record.tool === "opencode" && !staleKeys.has(key)) state.records.delete(key);
    }

    // 只对新增/有更新的会话重新抽取用户提问分片
    const changedRows = sessionRows.filter((row) => {
      const id = row[0];
      const timeUpdated = Number(row[4]) || 0;
      const key = `opencode:${id}`;
      return !!id && (!state.records.has(key) || timeUpdated > state.opencodeMessageCursor);
    });
    if (!changedRows.length) return { files: sessionRows.length, rescanned: 0 };

    let maxUpdated = state.opencodeMessageCursor;
    for (const row of changedRows) {
      const [id, title, directory, timeCreated, timeUpdated] = row;
      const updatedAt = Number(timeUpdated) || Number(timeCreated) || 0;
      if (updatedAt > maxUpdated) maxUpdated = updatedAt;
      const record = {
        key: `opencode:${id}`,
        tool: "opencode",
        id,
        projectPath: directory || "",
        title: clampText(title, 200),
        text: "",
        updatedAt,
        transcriptPath: ""
      };
      try {
        const quoted = `'${id.replace(/'/g, "''")}'`;
        const partsStdout = await runSqlite(opencodeDbPath, OPENCODE_PARTS_SQL([quoted]));
        const texts = [];
        for (const [, dataJson] of parseSqliteRows(partsStdout, 2)) {
          const text = opencodeUserTextFromData(dataJson);
          if (text) texts.push(text);
          if (texts.join("\n").length >= SESSION_TEXT_CAP) break;
        }
        record.text = clampText(texts.join("\n"));
      } catch (err) {
        logger.debug?.("[SessionSearch] opencode part extract failed:", err && err.message);
      }
      upsertRecord(record);
      await new Promise((resolve) => setImmediate(resolve));
    }
    state.opencodeMessageCursor = maxUpdated;
    return { files: sessionRows.length, rescanned: changedRows.length };
  }

  function refreshStats() {
    let claude = 0;
    let codex = 0;
    let zcode = 0;
    let qoder = 0;
    let opencode = 0;
    for (const record of state.records.values()) {
      if (record.tool === "claude") claude += 1;
      else if (record.tool === "codex") codex += 1;
      else if (record.tool === "zcode") zcode += 1;
      else if (record.tool === "qoder") qoder += 1;
      else if (record.tool === "opencode") opencode += 1;
    }
    state.stats = { claude, codex, zcode, qoder, opencode };
  }

  async function scan({ reason = "manual" } = {}) {
    if (state.scanning) return scanningChain;
    state.scanning = true;
    scanningChain = (async () => {
      const summary = {};
      try {
        summary.claude = await scanJsonlSource({
          source: "claude",
          roots: [claudeRoot],
          parseTranscript: parseClaudeTranscript
        });
      } catch (err) {
        logger.warn?.("[SessionSearch] claude scan failed:", err && err.message);
        summary.claude = { error: String(err && err.message) };
      }
      try {
        summary.codex = await scanJsonlSource({
          source: "codex",
          roots: [codexRoot],
          parseTranscript: parseCodexTranscript
        });
      } catch (err) {
        logger.warn?.("[SessionSearch] codex scan failed:", err && err.message);
        summary.codex = { error: String(err && err.message) };
      }
      try {
        summary.qoder = await scanJsonlSource({
          source: "qoder",
          roots: [qoderRoot],
          parseTranscript: parseQoderTranscript
        });
      } catch (err) {
        logger.warn?.("[SessionSearch] qoder scan failed:", err && err.message);
        summary.qoder = { error: String(err && err.message) };
      }
      try {
        summary.opencode = await scanOpencodeSource();
      } catch (err) {
        logger.warn?.("[SessionSearch] opencode scan failed:", err && err.message);
        summary.opencode = { error: String(err && err.message) };
      }
      try {
        summary.zcode = await scanZcodeSource();
      } catch (err) {
        logger.warn?.("[SessionSearch] zcode scan failed:", err && err.message);
        summary.zcode = { error: String(err && err.message) };
      }
      refreshStats();
      state.lastScanAt = Date.now();
      state.lastError = "";
      state.scanning = false;
      schedulePersist();
      logger.debug?.(`[SessionSearch] scan(${reason}):`, JSON.stringify(summary));
      return summary;
    })();
    return scanningChain;
  }

  function scheduleScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan({ reason: "watch" }).catch(() => {});
    }, scanDebounceMs);
  }

  function buildSnippet(haystack, lowerHaystack, keywords) {
    let anchor = -1;
    let matched = "";
    for (const keyword of keywords) {
      const index = lowerHaystack.indexOf(keyword);
      if (index < 0) continue;
      if (anchor < 0 || index < anchor) {
        anchor = index;
        matched = keyword;
      }
    }
    if (anchor < 0) {
      const head = haystack.slice(0, SNIPPET_CONTEXT_CHARS * 2).trim();
      return head ? `${head}${haystack.length > SNIPPET_CONTEXT_CHARS * 2 ? "…" : ""}` : "";
    }
    const start = Math.max(0, anchor - SNIPPET_CONTEXT_CHARS);
    const end = Math.min(haystack.length, anchor + matched.length + SNIPPET_CONTEXT_CHARS);
    return `${start > 0 ? "…" : ""}${haystack.slice(start, end).trim()}${end < haystack.length ? "…" : ""}`;
  }

  function search(query, { limit = SEARCH_DEFAULT_LIMIT } = {}) {
    const keywords = String(query || "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (!keywords.length) return [];
    const results = [];
    for (const record of state.records.values()) {
      const haystack = pathsForRecord(record);
      if (!haystack) continue;
      const lowerHaystack = haystack.toLowerCase();
      if (!keywords.every((keyword) => lowerHaystack.includes(keyword))) continue;
      results.push({
        tool: record.tool,
        id: record.id,
        projectPath: record.projectPath,
        title: record.title,
        updatedAt: record.updatedAt,
        transcriptPath: record.transcriptPath,
        snippet: buildSnippet(haystack, lowerHaystack, keywords)
      });
    }
    results.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return results.slice(0, Math.max(1, limit));
  }

  function getState() {
    return {
      started: state.started,
      scanning: state.scanning,
      lastScanAt: state.lastScanAt,
      lastError: state.lastError,
      stats: { ...state.stats },
      total: state.records.size
    };
  }

  async function start() {
    if (state.started) return;
    state.started = true;
    await loadPersisted();
    scan({ reason: "startup" }).catch((err) => {
      state.lastError = String(err && err.message);
    });
    if (!watch) return;
    // 三个数据源目录任一有写入就安排一轮节流扫描；zcode 的 db 文件由 sqlite 自管 wal，
    // 监听目录级变化足够，不监听 db 本身避免无谓唤醒
    for (const root of [claudeRoot, codexRoot]) {
      try {
        const watcher = fs.watch(root, { recursive: true }, () => scheduleScan());
        watcher.on("error", (err) => logger.debug?.("[SessionSearch] watcher error:", err && err.message));
        watchers.push(watcher);
      } catch (err) {
        logger.debug?.("[SessionSearch] watch unavailable:", err && err.message);
      }
    }
  }

  function dispose() {
    state.started = false;
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    for (const watcher of watchers) {
      try {
        watcher.close();
      } catch {}
    }
    watchers = [];
    // 尽力落一次盘：避免「扫描完还没到持久化去抖就被退出」丢掉整轮成果
    persistNow().catch(() => {});
  }

  return { start, dispose, scan, search, getState, persistNow, indexPath };
}

// 千问办公（Qoder CLI）：session_meta 与 user 行的 id/cwd 在顶层（非 payload）。
function parseQoderTranscript(lines) {
  let projectPath = "";
  let id = "";
  let updatedAtMs = 0;
  const texts = [];
  for (const line of lines) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const type = entry.type;
    if (type === "session_meta") {
      if (!id && typeof entry.sessionId === "string") id = entry.sessionId;
      if (!projectPath && typeof entry.cwd === "string" && entry.cwd) projectPath = entry.cwd;
      const ts = toTimestampMs(entry.timestamp);
      if (ts > updatedAtMs) updatedAtMs = ts;
      continue;
    }
    if (type !== "user") continue;
    const ts = toTimestampMs(entry.timestamp);
    if (ts > updatedAtMs) updatedAtMs = ts;
    const text = clampText(textFromClaudeContent(entry.message && entry.message.content), SESSION_TEXT_CAP);
    if (text) texts.push(text);
    if (texts.join("\n").length >= SESSION_TEXT_CAP) break;
  }
  return {
    id,
    projectPath,
    title: "",
    text: texts.join("\n"),
    updatedAt: updatedAtMs
  };
}

// OpenCode / DuMate：用户提问正文存放在 part 表的 {"type":"text","text":...} 分片。
function opencodeUserTextFromData(dataJson) {
  try {
    const parsed = JSON.parse(dataJson);
    if (parsed && parsed.type === "text" && typeof parsed.text === "string") return parsed.text;
  } catch {
    // 非 JSON 分片直接忽略
  }
  return "";
}

module.exports = {
  INDEX_FORMAT_VERSION,
  createSessionSearchService,
  parseClaudeTranscript,
  parseCodexTranscript,
  parseQoderTranscript,
  parseSqliteRows,
  zcodeUserTextFromData,
  opencodeUserTextFromData,
  textFromClaudeContent,
  isCodexNoise
};
