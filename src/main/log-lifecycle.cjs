"use strict";

const SAFE_STREAM_ERROR_CODES = new Set(["EPIPE", "ENOSPC"]);
const DAILY_LOG_PATTERN = /^flux-desktop-\d{4}-\d{2}-\d{2}\.log$/;

function isSafeStreamError(error) {
  return Boolean(error?.code && SAFE_STREAM_ERROR_CODES.has(error.code));
}

function silenceStreamWriteErrors(stream) {
  if (!stream || typeof stream.on !== "function") return;
  stream.on("error", (error) => {
    if (!isSafeStreamError(error)) throw error;
  });
}

function formatDailyLogName(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `flux-desktop-${year}-${month}-${day}.log`;
}

function createLogLifecycle({ log, fs, path, now = () => new Date() }) {
  function rotate(closeOldHandle = false) {
    const nextName = formatDailyLogName(now());
    if (log.transports.file.fileName === nextName) return;
    log.transports.file.fileName = nextName;
    if (closeOldHandle) log.transports.file.getFile().clear();
  }

  function cleanOldLogs(retentionMs = 7 * 24 * 60 * 60 * 1000) {
    try {
      const logsDir = path.dirname(log.transports.file.getFile().path);
      const cutoff = now().getTime() - retentionMs;
      for (const file of fs.readdirSync(logsDir)) {
        if (!DAILY_LOG_PATTERN.test(file)) continue;
        const filePath = path.join(logsDir, file);
        if (fs.statSync(filePath).mtimeMs < cutoff) fs.unlinkSync(filePath);
      }
    } catch (error) {
      log.warn("[Logger] cleanup failed:", error);
    }
  }

  function millisecondsUntilMidnight() {
    const current = now();
    const midnight = new Date(current);
    midnight.setHours(24, 0, 0, 0);
    return midnight.getTime() - current.getTime();
  }

  function start() {
    setImmediate(cleanOldLogs);
    let timer;
    const schedule = () => {
      timer = setTimeout(() => {
        rotate(true);
        cleanOldLogs();
        schedule();
      }, millisecondsUntilMidnight());
    };
    schedule();
    return () => clearTimeout(timer);
  }

  return Object.freeze({ rotate, cleanOldLogs, start });
}

function configureLogTransport(log) {
  silenceStreamWriteErrors(process.stdout);
  silenceStreamWriteErrors(process.stderr);
  const transport = log.transports.console;
  if (transport && typeof transport.writeFn === "function") {
    const write = transport.writeFn.bind(transport);
    transport.writeFn = (...args) => {
      try {
        return write(...args);
      } catch (error) {
        if (isSafeStreamError(error)) return undefined;
        throw error;
      }
    };
  }
  log.transports.file.level = "info";
}

module.exports = {
  configureLogTransport,
  createLogLifecycle,
  formatDailyLogName,
  isSafeStreamError
};
