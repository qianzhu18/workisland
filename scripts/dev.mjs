import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const require = createRequire(import.meta.url);
const { ENV } = require("../src/main/runtime-mode.cjs");

let electronBinary;
try {
  electronBinary = require("electron");
} catch {
  try {
    const toolRequire = createRequire(resolve(root, ".tools", "electron-shell", "package.json"));
    electronBinary = toolRequire("electron");
  } catch {
    console.error("Electron is not installed. Run: npm run setup:electron");
    process.exit(1);
  }
}

const userData = resolve(root, ".local-data");
const isolatedHome = resolve(root, ".local-home");
const logDir = resolve(root, ".local-logs");
mkdirSync(userData, { recursive: true });
mkdirSync(isolatedHome, { recursive: true });
mkdirSync(logDir, { recursive: true });

const childEnv = {
  ...process.env,
  [ENV.development]: "1",
  [ENV.userData]: userData,
  FLUX_HOOK_NODE: process.execPath,
  HOME: isolatedHome,
  USERPROFILE: isolatedHome,
  ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING ?? "1"
};
// Some agent shells set this globally. Electron must run as an app, not as Node.
delete childEnv.ELECTRON_RUN_AS_NODE;
const electronArgs = process.argv.slice(2);
const fullModeIndex = electronArgs.indexOf("--full");
if (fullModeIndex >= 0) {
  electronArgs.splice(fullModeIndex, 1);
  childEnv[ENV.integrated] = "1";
  childEnv.HOME = process.env.HOME;
  childEnv.USERPROFILE = process.env.USERPROFILE ?? process.env.HOME;
  console.warn("Integrated mode uses the real user home and may update local Agent hook configuration.");
}

const child = spawn(electronBinary, [root, ...electronArgs], {
  cwd: root,
  stdio: "inherit",
  env: childEnv,
  detached: process.platform !== "win32"
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(process.platform === "win32" ? signal : "SIGUSR1");
  });
}

child.on("error", (error) => {
  console.error(`Failed to start Electron: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Electron exited after ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
