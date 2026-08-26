#!/usr/bin/env node
// Windows packaged-app smoke test: launches the packaged portable exe,
// tails the electron-log main.log for readiness / failure markers, and
// exits non-zero when the app fails to reach a ready state in time.
//
// Usage: node scripts/smoke-win-packaged.mjs <path-to-exe> [timeoutMs]

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const exe = process.argv[2];
const timeoutMs = Number(process.argv[3] || 90000);
if (!exe || !existsSync(exe)) {
  console.error("Usage: node scripts/smoke-win-packaged.mjs <exe> [timeoutMs]");
  process.exit(2);
}

const productName = "WorkIsland";
const userDataDir = path.join(
  process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming"),
  productName
);
const logFile = path.join(userDataDir, "logs", "main.log");

const READY_MARKERS = [
  "[main] app.whenReady() fired",
  "[main] IslandWindow created OK"
];
const FAIL_MARKERS = [
  "Uncaught exception",
  "Cannot find module",
  "A JavaScript error occurred in the main process"
];

const child = spawn(exe, [], { stdio: "ignore" });
console.log(`[smoke] launched pid=${child.pid} exe=${exe}`);
console.log(`[smoke] watching log file: ${logFile}`);

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
    let text = "";
    try {
      text = readFileSync(logFile, "utf8");
    } catch {
      return; // log not created yet
    }
    if (FAIL_MARKERS.some((marker) => text.includes(marker))) {
      finish({ status: "failed", text });
    } else if (READY_MARKERS.every((marker) => text.includes(marker))) {
      finish({ status: "ready", text });
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
    console.error("[smoke] log tail:\n" + result.text.split(/\r?\n/).slice(-40).join("\n"));
  } else {
    console.error(`[smoke] no log found at ${logFile}`);
  }
  process.exit(1);
}
console.log("[smoke] OK: app reached ready state");
console.log("[smoke] log tail:\n" + result.text.split(/\r?\n/).slice(-20).join("\n"));
process.exit(0);
