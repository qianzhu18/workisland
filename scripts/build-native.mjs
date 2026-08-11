import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const root = resolve(new URL("..", import.meta.url).pathname);
if (process.platform !== "darwin") {
  console.log("Native panel module is macOS-only; skipping build.");
  process.exit(0);
}
const outDir = join(root, "resources/bin");
mkdirSync(outDir, { recursive: true });
const nodeInclude = join(process.execPath, "..", "..", "include", "node");
const require = createRequire(import.meta.url);
const electronInclude = join(require.resolve("electron"), "..", "..", "headers");
const include = existsSync(join(electronInclude, "include/node/node_api.h"))
  ? join(electronInclude, "include/node") : nodeInclude;
const buildDir = join(root, ".native-build");
mkdirSync(buildDir, { recursive: true });
const args = ["-std=c++17", "-fobjc-arc", "-dynamiclib", "-undefined", "dynamic_lookup",
  "-I", include, "-framework", "AppKit", "-framework", "CoreGraphics", "-framework", "Foundation",
  join(root, "native/panel-fix/src/panel_fix.mm"), "-o", join(buildDir, "panel_fix.node")];
execFileSync("clang++", args, { stdio: "inherit" });
copyFileSync(join(buildDir, "panel_fix.node"), join(outDir, "panel_fix.node"));
console.log(`Built ${join(outDir, "panel_fix.node")}`);
