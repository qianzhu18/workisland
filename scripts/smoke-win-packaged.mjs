#!/usr/bin/env node
// Windows packaged-app smoke test: launches the packaged portable exe,
// tails the electron-log main.log for readiness / failure markers, and
// exits non-zero when the app fails to reach a ready state in time.
//
// Usage: node scripts/smoke-win-packaged.mjs <path-to-exe> [timeoutMs]

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const exe = process.argv[2];
const timeoutMs = Number(process.argv[3] || 90000);
if (!exe || !existsSync(exe)) {
  console.error("Usage: node scripts/smoke-win-packaged.mjs <exe> [timeoutMs]");
  process.exit(2);
}

const appData = process.env.APPDATA
  || path.join(process.env.USERPROFILE || "", "AppData", "Roaming");

// CI 中 npm run check 的单元测试会往真实的 userData/logs 写日志，
// 先清掉，避免陈旧内容伪造 ready / fail 信号。
for (const entry of (() => {
  try { return readdirSync(appData); } catch { return []; }
})()) {
  if (!/work.?island/i.test(entry)) continue;
  try { rmSync(path.join(appData, entry, "logs"), { recursive: true, force: true }); } catch {}
}

// Electron 可能使用 productName 或 package name 作为 userData 目录名，
// 甚至 portable 解包后名称不同：扫描 AppData 下所有 *ork*sland* 候选。
function findLogFiles() {
  const candidates = [];
  try {
    for (const entry of readdirSync(appData)) {
      if (!/work.?island/i.test(entry)) continue;
      const logsDir = path.join(appData, entry, "logs");
      try {
        for (const file of readdirSync(logsDir)) {
          if (file.endsWith(".log")) candidates.push(path.join(logsDir, file));
        }
      } catch {}
    }
  } catch {}
  return candidates;
}

// 应用使用按天轮转的 flux-desktop-YYYY-MM-DD.log；首启流程展示
// WelcomeWindow 而非 IslandWindow，因此 ready 判定只看 whenReady。
const READY_MARKERS = [
  "[main] app.whenReady() fired"
];
const FAIL_MARKERS = [
  "Uncaught exception",
  "Cannot find module",
  "A JavaScript error occurred in the main process"
];

let output = "";
const child = spawn(exe, [], {
  stdio: ["ignore", "pipe", "pipe"]
});
child.stdout.on("data", (d) => { output += d; });
child.stderr.on("data", (d) => { output += d; });
console.log(`[smoke] launched pid=${child.pid} exe=${exe}`);
console.log(`[smoke] scanning ${appData} for workisland log dirs`);

const result = await new Promise((resolve) => {
  let settled = false;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    clearInterval(poll);
    resolve(value);
  };
  const timer = setTimeout(() => finish({ status: "timeout" }), timeoutMs);
  const poll = setInterval(() => {
    for (const logFile of findLogFiles()) {
      let text = "";
      try {
        text = readFileSync(logFile, "utf8");
      } catch {
        continue;
      }
      if (FAIL_MARKERS.some((marker) => text.includes(marker))) {
        finish({ status: "failed", text, logFile });
      } else if (READY_MARKERS.every((marker) => text.includes(marker))) {
        finish({ status: "ready", text, logFile });
      }
    }
  }, 1000);
  child.on("exit", (code) => finish({ status: "exited", code }));
});

try { child.kill(); } catch {}
try {
  spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
} catch {}

console.log(`[smoke] result: ${result.status}${result.code !== undefined ? ` (exit ${result.code})` : ""}`);
if (result.status !== "ready") {
  console.error(`[smoke] app did not reach ready state (${result.status})`);
  if (result.text) {
    console.error(`[smoke] log tail (${result.logFile}):\n` + result.text.split(/\r?\n/).slice(-40).join("\n"));
  }
  if (output.trim()) {
    console.error("[smoke] process output:\n" + output.split(/\r?\n/).slice(-40).join("\n"));
  }
  if (!result.text && !output.trim()) {
    console.error("[smoke] no logs and no process output; app likely never started");
    console.error("[smoke] log candidates found: " + (findLogFiles().join(", ") || "(none)"));
  }
  process.exit(1);
}
console.log("[smoke] OK: app reached ready state");
console.log("[smoke] log tail:\n" + result.text.split(/\r?\n/).slice(-20).join("\n"));
process.exit(0);
