import { chmodSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

function ensureNodePtyHelperExecutable(root, {
  platform = process.platform,
  arch = process.arch,
  pathExists = existsSync,
  chmod = chmodSync
} = {}) {
  if (platform !== "darwin" || !["arm64", "x64"].includes(arch)) return false;
  const helper = join(root, "node_modules", "node-pty", "prebuilds", `darwin-${arch}`, "spawn-helper");
  if (!pathExists(helper)) return false;
  chmod(helper, 0o755);
  return true;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const changed = ensureNodePtyHelperExecutable(process.cwd());
  if (changed) console.log("Prepared node-pty macOS spawn helper.");
}

export { ensureNodePtyHelperExecutable };
