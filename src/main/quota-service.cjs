"use strict";

const electron = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const child_process = require("node:child_process");
const util = require("node:util");
const log = require("electron-log");
const { IPC } = require("../shared/ipc.cjs");

const CACHE_PATH = process.platform === "win32" ? path.join(os.tmpdir(), "flux-rl.json") : "/tmp/flux-rl.json";
function formatMinutes$1(minutes) {
  if (minutes <= 0) return "0m";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  const mins = minutes % 60;
  if (days > 0 && hours > 0) return `${days}d${hours}h`;
  if (days > 0) return `${days}d`;
  if (hours > 0 && mins > 0) return `${hours}h${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}
function formatRemaining$1(windowMinutes, usedPct) {
  const remaining = Math.round(windowMinutes * (1 - usedPct / 100));
  return formatMinutes$1(Math.max(0, remaining));
}
const NumberCompat = Number;
function isFiniteNumber(value) {
  return typeof value === "number" && NumberCompat.isFinite(value);
}
function toUnixSeconds(value) {
  if (value === void 0 || value === null) return void 0;
  const n = typeof value === "string" ? Number(value) : value;
  if (!isFiniteNumber(n) || n <= 0) return void 0;
  if (n >= 1e17) return Math.floor(n / 1e9);
  if (n >= 1e14) return Math.floor(n / 1e6);
  if (n >= 1e11) return Math.floor(n / 1e3);
  return Math.floor(n);
}
function formatRemainingFromReset(resetsAt) {
  const resetSec = toUnixSeconds(resetsAt);
  if (!resetSec) return null;
  const nowSec = Math.floor(Date.now() / 1e3);
  const remainingMin = Math.round((resetSec - nowSec) / 60);
  const res = formatMinutes$1(Math.max(0, remainingMin));
  return res === "0m" ? "-" : res;
}
function parseUsedPct(w) {
  const raw = w.used_percentage ?? w.utilization ?? 0;
  return Math.min(100, Math.max(0, raw));
}
function loadClaudeQuota() {
  let raw;
  let capturedAt;
  try {
    const text = fs.readFileSync(CACHE_PATH, "utf-8");
    raw = JSON.parse(text);
    capturedAt = fs.statSync(CACHE_PATH).mtimeMs;
  } catch {
    return null;
  }
  if (!raw.five_hour && !raw.seven_day) return null;
  const fiveHourPct = raw.five_hour ? parseUsedPct(raw.five_hour) : 0;
  const sevenDayPct = raw.seven_day ? parseUsedPct(raw.seven_day) : 0;
  return {
    daily: {
      total: "5h",
      usedPct: fiveHourPct,
      remaining: formatRemainingFromReset(raw.five_hour?.resets_at) ?? formatRemaining$1(300, fiveHourPct)
    },
    weekly: {
      total: "7d",
      usedPct: sevenDayPct,
      remaining: formatRemainingFromReset(raw.seven_day?.resets_at) ?? formatRemaining$1(10080, sevenDayPct)
    },
    capturedAt
  };
}
const SESSIONS_DIR = path.join(os.homedir(), ".codex", "sessions");
const MAX_AGE_MS = 24 * 60 * 60 * 1e3;
function formatMinutes(minutes) {
  if (minutes <= 0) return "0m";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  const mins = minutes % 60;
  if (days > 0 && hours > 0) return `${days}d${hours}h`;
  if (days > 0) return `${days}d`;
  if (hours > 0 && mins > 0) return `${hours}h${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}
function formatRemaining(resetsAt) {
  if (!resetsAt || resetsAt <= 0) return "-";
  const nowSec = Math.floor(Date.now() / 1e3);
  const remainingMin = Math.round((resetsAt - nowSec) / 60);
  const res = formatMinutes(Math.max(0, remainingMin));
  if (res === "0m") return "-";
  return res;
}
function toNumber(val) {
  if (val === void 0) return 0;
  const n = typeof val === "string" ? parseFloat(val) : val;
  return isNaN(n) ? 0 : n;
}
function collectRolloutFiles(dir) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...collectRolloutFiles(full));
      } else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
        try {
          const mtime = fs.statSync(full).mtimeMs;
          results.push({ path: full, mtime });
        } catch {
        }
      }
    }
  } catch {
  }
  return results;
}
function parseRateLimitsFromFile(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
  let lastLimits = null;
  let lastTimestamp = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed);
      if (event.type === "event_msg" && event.payload?.type === "token_count" && (event.payload.rate_limits?.primary || event.payload.rate_limits?.secondary)) {
        lastLimits = event.payload.rate_limits;
        if (event.timestamp) {
          const d = new Date(event.timestamp);
          if (!isNaN(d.getTime())) lastTimestamp = d.getTime();
        }
      }
    } catch {
    }
  }
  if (!lastLimits) return null;
  return { limits: lastLimits, capturedAt: lastTimestamp || Date.now() };
}
const DAILY_THRESHOLD_MINUTES = 720;
function buildQuotaPeriod(win) {
  const pct = Math.min(100, Math.max(0, toNumber(win.used_percent)));
  const minutes = Math.max(1, toNumber(win.window_minutes));
  const resetsAt = toNumber(win.resets_at) || void 0;
  return {
    total: formatMinutes(minutes),
    usedPct: pct,
    remaining: formatRemaining(resetsAt)
  };
}
const EMPTY_PERIOD = { total: "-", usedPct: 0, remaining: "-" };
function loadCodexQuota() {
  const now = Date.now();
  const files = collectRolloutFiles(SESSIONS_DIR).filter((f) => now - f.mtime <= MAX_AGE_MS).sort((a, b) => b.mtime - a.mtime);
  for (const file of files) {
    const result = parseRateLimitsFromFile(file.path);
    if (!result) continue;
    const { limits, capturedAt } = result;
    const windows = [];
    if (limits.primary) windows.push(limits.primary);
    if (limits.secondary) windows.push(limits.secondary);
    let daily = EMPTY_PERIOD;
    let weekly = EMPTY_PERIOD;
    for (const win of windows) {
      const minutes = toNumber(win.window_minutes);
      if (minutes <= DAILY_THRESHOLD_MINUTES) {
        daily = buildQuotaPeriod(win);
      } else {
        weekly = buildQuotaPeriod(win);
      }
    }
    return { daily, weekly, capturedAt };
  }
  return null;
}
function buildPeriodFromAppServer(win) {
  if (!win) return EMPTY_PERIOD;
  if (win.windowDurationMins == null) return EMPTY_PERIOD;
  const pct = Math.min(100, Math.max(0, toNumber(win.usedPercent)));
  const minutes = Math.max(1, toNumber(win.windowDurationMins));
  const resetsAt = toNumber(win.resetsAt ?? void 0) || void 0;
  return {
    total: formatMinutes(minutes),
    usedPct: pct,
    remaining: formatRemaining(resetsAt)
  };
}
function mapAppServerSnapshot(snapshot, capturedAtMs = Date.now()) {
  const windows = [snapshot.primary, snapshot.secondary].filter(
    (w) => w !== null
  );
  let daily = EMPTY_PERIOD;
  let weekly = EMPTY_PERIOD;
  for (const win of windows) {
    if (win.windowDurationMins == null) continue;
    const minutes = toNumber(win.windowDurationMins);
    if (minutes <= DAILY_THRESHOLD_MINUTES) {
      daily = buildPeriodFromAppServer(win);
    } else {
      weekly = buildPeriodFromAppServer(win);
    }
  }
  return { daily, weekly, capturedAt: capturedAtMs };
}
const DEFAULT_BUNDLED_PATH = "/Applications/Codex.app/Contents/Resources/codex";
const DEFAULT_REQUEST_TIMEOUT_MS = 5e3;
const execFileAsync$8 = util.promisify(child_process.execFile);
async function findCodexBinary() {
  if (fs.existsSync(DEFAULT_BUNDLED_PATH)) return DEFAULT_BUNDLED_PATH;
  try {
    const { stdout } = await execFileAsync$8("/usr/bin/env", ["which", "codex"], {
      encoding: "utf-8",
      timeout: 2e3
    });
    const trimmed = stdout.trim();
    if (trimmed && fs.existsSync(trimmed)) return trimmed;
  } catch {
  }
  return null;
}
class CodexAppServerClient {
  executablePath;
  clientName;
  clientVersion;
  process = null;
  stdoutBuffer = "";
  nextRequestId = 1;
  pending = /* @__PURE__ */ new Map();
  stopped = false;
  /** 收到 server 主动推送的 notification 时调用。 */
  onNotification = null;
  /** 子进程退出时调用，调用方负责降级。 */
  onExit = null;
  constructor(opts) {
    this.executablePath = opts.executablePath;
    this.clientName = opts.clientName;
    this.clientVersion = opts.clientVersion;
  }
  /**
   * spawn 子进程并完成 initialize handshake。
   * 任意一步失败会 reject，并保证子进程被清理。
   */
  async start() {
    if (this.process) return;
    this.stopped = false;
    const proc = child_process.spawn(this.executablePath, ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      // 关键：从环境里剔除 ELECTRON_RUN_AS_NODE，否则 codex 二进制如果是 Electron 打包
      // 形态会被当成 node 跑（Codex.app 实际是 Rust 二进制不受影响，但保险起见清掉）。
      env: stripElectronAsNode(process.env)
    });
    this.process = proc;
    proc.stdout.setEncoding("utf-8");
    proc.stdout.on("data", (chunk) => this.ingest(chunk));
    proc.stderr.setEncoding("utf-8");
    proc.stderr.on("data", (chunk) => {
      const trimmed = chunk.trim();
      if (trimmed) log.warn("[CodexAppServer] stderr: %s", trimmed.slice(0, 500));
    });
    proc.on("exit", (code) => this.handleExit(code));
    proc.on("error", (err) => {
      log.warn("[CodexAppServer] process error: %s", err.message);
      this.handleExit(null);
    });
    try {
      await this.sendRequest("initialize", {
        clientInfo: { name: this.clientName, title: this.clientName, version: this.clientVersion },
        capabilities: null
      });
    } catch (err) {
      this.stop();
      throw err;
    }
  }
  stop() {
    if (!this.process) return;
    this.stopped = true;
    const proc = this.process;
    this.process = null;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`CodexAppServer stopped while waiting for ${p.method} (id=${id})`));
    }
    this.pending.clear();
    try {
      proc.stdin.end();
    } catch {
    }
    if (!proc.killed) {
      try {
        proc.kill("SIGTERM");
      } catch {
      }
    }
  }
  isRunning() {
    return this.process !== null && !this.stopped;
  }
  /** 发一个 JSON-RPC request，返回 server 的 result。失败/超时/进程退出时 reject。 */
  sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.process || this.stopped) {
        reject(new Error("CodexAppServer not connected"));
        return;
      }
      const id = this.nextRequestId++;
      const body = { jsonrpc: "2.0", id, method };
      if (params !== void 0) body.params = params;
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`CodexAppServer request timed out: ${method} (id=${id})`));
        }
      }, DEFAULT_REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        resolve,
        reject,
        timer,
        method
      });
      try {
        this.process.stdin.write(JSON.stringify(body) + "\n");
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }
  // ─── 内部：stdout 解析 ────────────────────────────────────────────────
  ingest(chunk) {
    this.stdoutBuffer += chunk;
    let newlineIdx;
    while ((newlineIdx = this.stdoutBuffer.indexOf("\n")) >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIdx).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIdx + 1);
      if (!line) continue;
      this.dispatchLine(line);
    }
  }
  dispatchLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      log.warn("[CodexAppServer] non-JSON line dropped: %s", line.slice(0, 200));
      return;
    }
    if ("method" in msg && !("id" in msg)) {
      this.onNotification?.(msg.method, msg.params);
      return;
    }
    const idVal = msg.id;
    if (typeof idVal !== "number") return;
    const pending = this.pending.get(idVal);
    if (!pending) return;
    this.pending.delete(idVal);
    clearTimeout(pending.timer);
    if ("error" in msg && msg.error) {
      const err = msg.error;
      pending.reject(
        new Error(
          `CodexAppServer ${pending.method} failed: ${err.message ?? "unknown"} (code=${err.code ?? "?"})`
        )
      );
      return;
    }
    pending.resolve(msg.result);
  }
  handleExit(code) {
    if (this.stopped) return;
    this.stopped = true;
    this.process = null;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`CodexAppServer exited (code=${code}) while waiting for ${p.method} (id=${id})`));
    }
    this.pending.clear();
    log.info("[CodexAppServer] subprocess exited code=%s", String(code));
    this.onExit?.(code);
  }
}
function stripElectronAsNode(env) {
  if (!env.ELECTRON_RUN_AS_NODE) return env;
  const copy = { ...env };
  delete copy.ELECTRON_RUN_AS_NODE;
  return copy;
}
const CLAUDE_CACHE_PATH = process.platform === "win32" ? path.join(os.tmpdir(), "flux-rl.json") : "/tmp/flux-rl.json";
const CLAUDE_CACHE_DIR = process.platform === "win32" ? os.tmpdir() : "/tmp";
const CLAUDE_CACHE_FILENAME = "flux-rl.json";
const CODEX_SESSIONS_DIR = path.join(os.homedir(), ".codex", "sessions");
const DEBOUNCE_MS = 100;
const HEARTBEAT_INTERVAL_MS = 6e4;
function summarize(q) {
  if (!q) return "null";
  return `pri=${q.daily.total}:${q.daily.usedPct}%/${q.daily.remaining} sec=${q.weekly.total}:${q.weekly.usedPct}%/${q.weekly.remaining}`;
}
class QuotaService {
  quotaMap = {};
  islandWindow = null;
  claudeWatcher = null;
  // Claude 缓存文件首次启动时不存在；fall back 监听 /tmp 等待文件被 statusLine 创建。
  claudeDirWatcher = null;
  codexWatcher = null;
  claudeDebounce = null;
  codexDebounce = null;
  heartbeatTimer = null;
  // 同一份 quotaMap 反复 broadcast 没有意义（fs.watch 同一秒内能触发好几次）；
  // 用最近一次的 JSON 签名去重。
  lastBroadcastSig = "";
  codexSessionsDirMissingLogged = false;
  // ── codex app-server JSON-RPC 数据源 ────────────────────────────────────
  // 与 Codex.app UI 同源的实时 quota。可用时优先；不可用时降级到 jsonl fs.watch。
  codexClient = null;
  /** true 表示 codex 数据由 app-server 推送主导；false 表示走 jsonl fallback。 */
  codexAppServerActive = false;
  /** heartbeat 主动 pull 连续失败次数；达到阈值则视为 server 半挂起，主动降级。 */
  codexAppServerReadFailures = 0;
  static MAX_APP_SERVER_READ_FAILURES = 3;
  // 服务级 shutdown 标志。`tryStartCodexAppServer` 是 fire-and-forget 异步链
  // （findCodexBinary→client.start→sendRequest 累计可达 ~7s），若 stop() 在
  // await 过程中触发，stop 看到的 codexClient 仍是 null 直接放行，等 await
  // 恢复时把已 spawn 的子进程赋给 codexClient 就成了孤儿。所有关键 await
  // 点回来后必须先检查这个标志、必要时主动回收 client。
  stopped = false;
  start() {
    this.stopped = false;
    this.refreshClaude("initial");
    this.refreshCodex("initial");
    this.attachClaudeWatcher();
    this.attachCodexWatcher();
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_INTERVAL_MS);
    log.info(
      "[QuotaService] started — claude=%s codex=%s",
      summarize(this.quotaMap.claude),
      summarize(this.quotaMap.codex)
    );
    void this.tryStartCodexAppServer();
  }
  /**
   * 启动 codex app-server JSON-RPC 客户端，作为 Codex quota 的优先数据源。
   * 失败/未登录时静默降级到 jsonl fallback（已经在 start() 里 attach 好了）。
   */
  async tryStartCodexAppServer() {
    const bin = await findCodexBinary();
    if (this.stopped) {
      log.info("[QuotaService] aborted at findCodexBinary: service stopped");
      return;
    }
    if (!bin) {
      log.info("[QuotaService] codex binary not found, sticking to jsonl source");
      return;
    }
    const client = new CodexAppServerClient({
      executablePath: bin,
      clientName: "flux-desktop",
      clientVersion: electron.app.getVersion()
    });
    client.onNotification = (method, params) => {
      if (method !== "account/rateLimits/updated") return;
      const snap = params?.rateLimits;
      if (!snap) return;
      this.commit("codex", mapAppServerSnapshot(snap), "app-server:push");
    };
    client.onExit = (code) => {
      log.warn("[QuotaService] codex app-server exited (code=%s), falling back to jsonl", String(code));
      this.codexAppServerActive = false;
      this.codexClient = null;
      this.codexAppServerReadFailures = 0;
      this.refreshCodex("app-server-exit");
    };
    try {
      await client.start();
      if (this.stopped) {
        log.info("[QuotaService] aborted after client.start: service stopped, reclaiming subprocess");
        client.onNotification = null;
        client.onExit = null;
        client.stop();
        return;
      }
      const res = await client.sendRequest("account/rateLimits/read");
      if (this.stopped) {
        log.info("[QuotaService] aborted after rateLimits/read: service stopped, reclaiming subprocess");
        client.onNotification = null;
        client.onExit = null;
        client.stop();
        return;
      }
      const snap = res?.rateLimits;
      if (!snap) {
        log.warn("[QuotaService] account/rateLimits/read returned empty payload");
        client.onNotification = null;
        client.onExit = null;
        client.stop();
      } else {
        this.codexClient = client;
        this.codexAppServerActive = true;
        this.commit("codex", mapAppServerSnapshot(snap), "app-server:initial");
        log.info("[QuotaService] codex app-server connected -> %s", bin);
      }
    } catch (err) {
      log.warn(
        "[QuotaService] codex app-server unavailable (%s), staying on jsonl source",
        err.message
      );
      client.onNotification = null;
      client.onExit = null;
      client.stop();
    }
  }
  /**
   * 60s 心跳：补 fs.watch 漏掉的事件、给首次启动时父目录不存在的 watcher 一次重试机会、
   * 让 UsageQuota.remaining 倒计时（基于 Date.now() 现场算）能走动、给 app-server 主导
   * 路径定期主动 pull 一次兜底 notification 丢失。
   */
  heartbeat() {
    if (!this.codexWatcher) this.attachCodexWatcher();
    if (!this.claudeWatcher && !this.claudeDirWatcher) this.attachClaudeWatcher();
    this.refreshClaude("heartbeat");
    if (this.codexAppServerActive && this.codexClient?.isRunning()) {
      const client = this.codexClient;
      void client.sendRequest("account/rateLimits/read").then((res) => {
        this.codexAppServerReadFailures = 0;
        const snap = res?.rateLimits;
        if (snap) this.commit("codex", mapAppServerSnapshot(snap), "app-server:heartbeat");
      }).catch((err) => {
        this.codexAppServerReadFailures += 1;
        log.warn(
          "[QuotaService] heartbeat app-server pull failed (%d/%d): %s",
          this.codexAppServerReadFailures,
          QuotaService.MAX_APP_SERVER_READ_FAILURES,
          err.message
        );
        if (this.codexAppServerReadFailures >= QuotaService.MAX_APP_SERVER_READ_FAILURES && this.codexClient === client) {
          log.warn("[QuotaService] codex app-server unhealthy, falling back to jsonl");
          client.onNotification = null;
          client.onExit = null;
          client.stop();
          this.codexClient = null;
          this.codexAppServerActive = false;
          this.codexAppServerReadFailures = 0;
          this.refreshCodex("app-server-unhealthy");
        }
      });
    } else {
      this.refreshCodex("heartbeat");
    }
  }
  stop() {
    this.stopped = true;
    this.codexClient?.stop();
    this.codexClient = null;
    this.codexAppServerActive = false;
    this.claudeWatcher?.close();
    this.claudeWatcher = null;
    this.claudeDirWatcher?.close();
    this.claudeDirWatcher = null;
    this.codexWatcher?.close();
    this.codexWatcher = null;
    if (this.claudeDebounce) {
      clearTimeout(this.claudeDebounce);
      this.claudeDebounce = null;
    }
    if (this.codexDebounce) {
      clearTimeout(this.codexDebounce);
      this.codexDebounce = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    log.info("[QuotaService] stopped");
  }
  setIslandWindow(win) {
    this.islandWindow = win;
    if (Object.keys(this.quotaMap).length > 0) {
      log.info(
        "[QuotaService] island window ready — replay cached quotas (claude=%s codex=%s)",
        summarize(this.quotaMap.claude),
        summarize(this.quotaMap.codex)
      );
      this.broadcast("window-ready");
    }
  }
  getQuotaMap() {
    return { ...this.quotaMap };
  }
  getClaudeQuota() {
    return this.quotaMap.claude ?? null;
  }
  /** 尝试更新某 agent 的 quota；只在数值真变化时打 info 日志。 */
  commit(agent, next, reason) {
    if (!next) return;
    const prev = this.quotaMap[agent];
    const prevSig = summarize(prev);
    const nextSig = summarize(next);
    if (prevSig === nextSig) {
      this.quotaMap = { ...this.quotaMap, [agent]: next };
      return;
    }
    this.quotaMap = { ...this.quotaMap, [agent]: next };
    log.info(
      "[QuotaService] %s quota changed (%s): %s -> %s",
      agent,
      reason,
      prevSig,
      nextSig
    );
    this.broadcast(`${agent}:${reason}`);
  }
  // ── Claude: 监听 /tmp/flux-rl.json ──────────────────────────────────
  refreshClaude(reason) {
    this.commit("claude", loadClaudeQuota(), reason);
  }
  attachClaudeWatcher() {
    if (this.claudeWatcher) return;
    try {
      this.claudeWatcher = fs.watch(CLAUDE_CACHE_PATH, { persistent: false }, () => {
        this.scheduleClaudeRefresh();
      });
      this.claudeWatcher.on("error", (err) => {
        log.warn("[QuotaService] claude watcher error: %s", err.message);
        this.claudeWatcher?.close();
        this.claudeWatcher = null;
        this.attachClaudeDirWatcher();
      });
      log.info("[QuotaService] claude watcher attached -> %s", CLAUDE_CACHE_PATH);
    } catch (err) {
      const code = err.code;
      if (code === "ENOENT") {
        log.info(
          "[QuotaService] claude cache %s missing, watching parent dir for creation",
          CLAUDE_CACHE_PATH
        );
        this.attachClaudeDirWatcher();
      } else {
        log.warn(
          "[QuotaService] failed to watch %s: %s",
          CLAUDE_CACHE_PATH,
          err.message
        );
      }
    }
  }
  attachClaudeDirWatcher() {
    if (this.claudeDirWatcher) return;
    try {
      this.claudeDirWatcher = fs.watch(
        CLAUDE_CACHE_DIR,
        { persistent: false },
        (_event, filename) => {
          if (filename !== CLAUDE_CACHE_FILENAME) return;
          this.claudeDirWatcher?.close();
          this.claudeDirWatcher = null;
          this.attachClaudeWatcher();
          this.scheduleClaudeRefresh();
        }
      );
    } catch (err) {
      log.warn(
        "[QuotaService] failed to watch %s: %s",
        CLAUDE_CACHE_DIR,
        err.message
      );
    }
  }
  scheduleClaudeRefresh() {
    if (this.claudeDebounce) clearTimeout(this.claudeDebounce);
    this.claudeDebounce = setTimeout(() => {
      this.claudeDebounce = null;
      this.refreshClaude("fs-event");
    }, DEBOUNCE_MS);
  }
  // ── Codex: 监听 ~/.codex/sessions 子树 ───────────────────────────────
  refreshCodex(reason) {
    this.commit("codex", loadCodexQuota(), reason);
  }
  attachCodexWatcher() {
    if (this.codexWatcher) return;
    try {
      this.codexWatcher = fs.watch(
        CODEX_SESSIONS_DIR,
        { persistent: false, recursive: true },
        (_event, filename) => {
          if (!filename) return;
          if (!filename.endsWith(".jsonl")) return;
          if (!filename.includes("rollout-")) return;
          this.scheduleCodexRefresh();
        }
      );
      this.codexWatcher.on("error", (err) => {
        log.warn("[QuotaService] codex watcher error: %s", err.message);
        this.codexWatcher?.close();
        this.codexWatcher = null;
      });
      this.codexSessionsDirMissingLogged = false;
      log.info("[QuotaService] codex watcher attached -> %s (recursive)", CODEX_SESSIONS_DIR);
    } catch (err) {
      const code = err.code;
      if (code === "ENOENT") {
        if (!this.codexSessionsDirMissingLogged) {
          log.info("[QuotaService] codex sessions dir missing, skip watcher: %s", CODEX_SESSIONS_DIR);
          this.codexSessionsDirMissingLogged = true;
        }
        return;
      }
      log.warn(
        "[QuotaService] failed to watch %s: %s",
        CODEX_SESSIONS_DIR,
        err.message
      );
    }
  }
  scheduleCodexRefresh() {
    if (this.codexAppServerActive) return;
    if (this.codexDebounce) clearTimeout(this.codexDebounce);
    this.codexDebounce = setTimeout(() => {
      this.codexDebounce = null;
      this.refreshCodex("fs-event");
    }, DEBOUNCE_MS);
  }
  broadcast(reason) {
    const sig = `${summarize(this.quotaMap.claude)}|${summarize(this.quotaMap.codex)}`;
    if (sig === this.lastBroadcastSig) return;
    if (!this.islandWindow || this.islandWindow.isDestroyed()) {
      log.info("[QuotaService] broadcast skipped (no island window) reason=%s", reason);
      return;
    }
    this.islandWindow.webContents.send(IPC.ISLAND_QUOTA_UPDATE, this.quotaMap);
    this.lastBroadcastSig = sig;
    log.info(
      "[QuotaService] broadcast IPC reason=%s claude=%s codex=%s",
      reason,
      summarize(this.quotaMap.claude),
      summarize(this.quotaMap.codex)
    );
  }
}
module.exports = { QuotaService };
