"use strict";

// 跨 Agent 交接交付 — issue #126/#129（feature/zcode-codex-handoff M2）。
// 两级能力（EPIC-010「不虚报交接成功」）：
//   inject   Level A：新开 Terminal.app / iTerm2 窗口执行 launch.sh —— `codex "$(cat prompt.txt)"`
//            在项目目录以预提交的初始 prompt 启动交互会话。只在自己新建的窗口里注入，
//            绝不向既有/未知 pane 发送文本（「禁止向未知 pane 发送文本」安全规则）。
//   copy-open Level B：prompt 写入剪贴板 + 打开目标（ZCode 深链 / 终端目录），状态诚实标
//            delivered-无读取回执，不伪造「已接手」。
// 交付动作全部由用户在预览后的一次点击授权（#129：禁止历史 prompt 静默变成新 Agent 的指令）。

const fs = require("node:fs");
const path = require("node:path");
const util = require("node:util");
const childProcess = require("node:child_process");

const { renderHandoffMarkdown, renderHandoffPrompt } = require("./handoff-package.cjs");

const execFileAsyncDefault = util.promisify(childProcess.execFile);

// 交接包目录名 = 交接 id；log.json 与包目录同级
const LOG_FILE_NAME = "log.json";
// 交付后 30 分钟内在同目录启动的目标会话视为接手（太短会错过慢启动，太长会误关联无关会话）
const RECEIVE_LINK_WINDOW_MS = 30 * 60 * 1000;
const LOG_MAX_ENTRIES = 100;

// v1 交接目标能力表：codex 有 CLI 位置参数可自动注入；zcode 无独立 CLI 只能复制+深链。
// claude 同样支持位置参数（#131 fast-follow，暂不开）。
const HANDOFF_TARGETS = {
  codex: { level: "inject" },
  zcode: { level: "copy-open" }
};

function singleQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function escapeAppleScriptString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function defaultRunAppleScript(script) {
  return execFileAsyncDefault("/usr/bin/osascript", ["-e", script], { timeout: 5_000 }).then(({ stdout }) => stdout.trim());
}

async function defaultCodexAvailable() {
  try {
    await execFileAsyncDefault("codex", ["--version"], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

function defaultWriteClipboard(text) {
  const { clipboard } = require("electron");
  clipboard.writeText(text);
  return true;
}

function defaultOpenUrl(url) {
  return execFileAsyncDefault("open", [url], { timeout: 5_000 }).then(() => true);
}

function zcodeWorkspaceDeepLink(projectDir) {
  return `zcode://workspace/open?path=${encodeURIComponent(projectDir)}`;
}

function renderLaunchScript(pkg, packageDir) {
  return [
    "#!/bin/bash",
    "# WorkIsland 跨 Agent 交接启动器（自动生成，可安全重跑）",
    `cd ${singleQuote(pkg.projectDir)} || exit 1`,
    `exec codex "$(cat ${singleQuote(path.join(packageDir, "prompt.txt"))})"`,
    ""
  ].join("\n");
}

function createHandoffDelivery({
  handoffRoot,
  runAppleScript = defaultRunAppleScript,
  codexAvailable = defaultCodexAvailable,
  writeClipboard = defaultWriteClipboard,
  openUrl = defaultOpenUrl,
  logger = { info() {}, debug() {}, warn() {}, error() {} }
} = {}) {
  if (!handoffRoot) throw new Error("handoff-delivery: handoffRoot is required");

  function writePackage(pkg, { locale } = {}) {
    const packageDir = path.join(handoffRoot, pkg.id);
    fs.mkdirSync(packageDir, { recursive: true });
    const markdown = renderHandoffMarkdown(pkg, { packageDir });
    const prompt = renderHandoffPrompt(pkg, { packageDir, locale });
    fs.writeFileSync(path.join(packageDir, "HANDOFF.md"), markdown, "utf-8");
    fs.writeFileSync(path.join(packageDir, "prompt.txt"), prompt, "utf-8");
    return { packageDir, prompt };
  }

  function detectTerminalApp() {
    const home = process.env.HOME || "";
    const itermPaths = ["/Applications/iTerm.app", path.join(home, "Applications", "iTerm.app")];
    return itermPaths.some((p) => fs.existsSync(p)) ? "iterm2" : "terminal";
  }

  async function openTerminalWindow(command, { terminalApp = detectTerminalApp() } = {}) {
    const escaped = escapeAppleScriptString(command);
    if (terminalApp === "iterm2") {
      const script = `
  tell application "iTerm"
    activate
    create window with default profile command "${escaped}"
  end tell
  return "ok"`;
      await runAppleScript(script);
      return "iTerm2";
    }
    const script = `
  tell application "Terminal"
    activate
    do script "${escaped}"
  end tell
  return "ok"`;
    await runAppleScript(script);
    return "Terminal.app";
  }

  async function targetLevel(targetTool) {
    const target = HANDOFF_TARGETS[targetTool];
    if (!target) return null;
    if (target.level === "inject" && !(await codexAvailable())) {
      return { level: "copy-open", degradedReason: "codex-cli-not-found" };
    }
    return { level: target.level };
  }

  async function deliver(pkg, { targetTool, locale } = {}) {
    const target = await targetLevel(targetTool);
    if (!target) throw new Error(`handoff: unsupported target tool ${targetTool}`);
    const { packageDir, prompt } = writePackage(pkg, { locale });

    if (target.level === "inject") {
      const launchPath = path.join(packageDir, "launch.sh");
      fs.writeFileSync(launchPath, renderLaunchScript(pkg, packageDir), { encoding: "utf-8", mode: 0o755 });
      const terminal = await openTerminalWindow(`bash ${singleQuote(launchPath)}`);
      return {
        handoffId: pkg.id,
        targetTool,
        level: "inject",
        status: "delivered",
        terminal,
        packageDir
      };
    }

    // copy-open：ZCode 深链打开工作区；codex CLI 缺失降级时改开终端到项目目录
    const clipboardSet = (() => {
      try {
        return writeClipboard(prompt);
      } catch (error) {
        logger.warn("handoff: clipboard write failed", error?.message);
        return false;
      }
    })();
    if (targetTool === "zcode" && pkg.projectDir) {
      await openUrl(zcodeWorkspaceDeepLink(pkg.projectDir));
    } else if (pkg.projectDir) {
      await openTerminalWindow(`cd ${singleQuote(pkg.projectDir)}`);
    }
    return {
      handoffId: pkg.id,
      targetTool,
      level: "copy-open",
      status: "delivered",
      degradedReason: target.degradedReason || "",
      clipboardSet,
      packageDir
    };
  }

  return {
    deliver,
    targetLevel,
    writePackage,
    renderLaunchScript,
    detectTerminalApp,
    zcodeWorkspaceDeepLink,
    HANDOFF_TARGETS,
    LOG_FILE_NAME,
    RECEIVE_LINK_WINDOW_MS,
    LOG_MAX_ENTRIES
  };
}

// ── 交接日志：回执、去重与接手链接的单一数据源 ───────────────────────────────

function createHandoffLog({ logPath, receiveLinkWindowMs = RECEIVE_LINK_WINDOW_MS, maxEntries = LOG_MAX_ENTRIES, logger } = {}) {
  if (!logPath) throw new Error("handoff-log: logPath is required");
  const noop = { info() {}, debug() {}, warn() {}, error() {} };
  const log = logger ?? noop;

  function readEntries() {
    try {
      const raw = fs.readFileSync(logPath, "utf-8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.entries) ? parsed.entries : [];
    } catch {
      return [];
    }
  }

  function writeEntries(entries) {
    const trimmed = entries.slice(-maxEntries);
    const payload = JSON.stringify({ version: 1, entries: trimmed }, null, 2);
    const tmp = `${logPath}.tmp`;
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(tmp, payload, "utf-8");
    fs.renameSync(tmp, logPath);
    return trimmed;
  }

  function record({ pkg, targetTool, level, status, sourceCompletedAt }) {
    const entries = readEntries();
    const entry = {
      id: pkg.id,
      sourceTool: pkg.source.tool,
      sourceSessionId: pkg.source.sessionId,
      targetTool,
      projectDir: pkg.projectDir,
      packageDir: "",
      level,
      status,
      deliveredAt: Date.now(),
      sourceCompletedAt: sourceCompletedAt ?? 0,
      linkedSessionId: ""
    };
    entries.push(entry);
    writeEntries(entries);
    return entry;
  }

  function setPackageDir(id, packageDir) {
    const entries = readEntries();
    const entry = entries.find((e) => e.id === id);
    if (!entry) return false;
    entry.packageDir = packageDir;
    writeEntries(entries);
    return true;
  }

  function markLinked(id, targetSessionId) {
    const entries = readEntries();
    const entry = entries.find((e) => e.id === id);
    if (!entry || entry.linkedSessionId) return false;
    entry.linkedSessionId = targetSessionId;
    writeEntries(entries);
    log.info("[HandoffLog] linked %s -> session %s", id, targetSessionId);
    return true;
  }

  // 去重（#129 验收：同一任务重复点击不得重复交接）：同源+同目标，且源会话
  // 自上次交接后没有新的完成事件（sourceCompletedAt 未前进）→ 拒绝。
  function canDeliver({ sourceSessionId, targetTool, sourceCompletedAt }) {
    const entries = readEntries();
    const last = [...entries].reverse().find((e) => e.sourceSessionId === sourceSessionId && e.targetTool === targetTool);
    if (!last) return { ok: true };
    if ((sourceCompletedAt ?? 0) > (last.sourceCompletedAt ?? 0)) return { ok: true };
    return { ok: false, reason: "already-handed-off", lastDeliveredAt: last.deliveredAt };
  }

  // 接手链接：目标工具的新会话在交付后 N 分钟内出现在同一目录 → 反向标记。
  // 只认「晚于交付时间创建」的会话，源会话天然不满足（它在交付前就存在）。
  function findRecentForStart({ tool, workingDirectory, createdAt }) {
    if (!workingDirectory) return null;
    const now = createdAt || Date.now();
    const candidates = readEntries().filter(
      (entry) =>
        entry.targetTool === tool &&
        entry.projectDir === workingDirectory &&
        !entry.linkedSessionId &&
        entry.deliveredAt <= now &&
        now - entry.deliveredAt <= receiveLinkWindowMs
    );
    if (!candidates.length) return null;
    return candidates.sort((a, b) => b.deliveredAt - a.deliveredAt)[0];
  }

  function list() {
    return readEntries();
  }

  return { record, setPackageDir, markLinked, canDeliver, findRecentForStart, list };
}

module.exports = {
  createHandoffDelivery,
  createHandoffLog,
  renderLaunchScript,
  zcodeWorkspaceDeepLink,
  HANDOFF_TARGETS,
  RECEIVE_LINK_WINDOW_MS
};
