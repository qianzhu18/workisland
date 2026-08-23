import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const issues = [];

if (!["darwin", "win32"].includes(process.platform)) issues.push("WorkIsland desktop currently supports macOS and Windows.");
if (process.platform === "darwin" && process.arch !== "arm64") issues.push("The bundled macOS native window module currently requires Apple Silicon.");
if (process.platform === "win32" && !["x64", "arm64"].includes(process.arch)) issues.push("Windows builds require x64 or arm64.");
try {
  require.resolve("electron");
} catch {
  try {
    const toolRequire = createRequire(join(root, ".tools", "electron-shell", "package.json"));
    toolRequire.resolve("electron");
  } catch {
    issues.push("Electron 43.3.0 is not installed; run npm run setup:electron.");
  }
}

console.log(`Node ${process.version} on ${process.platform}/${process.arch}`);
if (issues.length) {
  console.log("Development environment needs attention:");
  for (const issue of issues) console.log(`- ${issue}`);
  process.exitCode = 1;
} else {
  console.log("Development environment is ready.");
}
