import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "package.json",
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
  "src/shared/ipc.cjs",
  "src/shared/settings.cjs",
  "src/main/runtime-mode.cjs",
  "src/main/native-platform-service.cjs",
  "src/main/log-lifecycle.cjs",
  "src/main/session-policy.cjs",
  "src/main/external-url-policy.cjs",
  "src/main/update-service.cjs",
  "src/main/index.cjs",
  "src/preload/island.js",
  "src/preload/settings.js",
  "src/preload/pet.js",
  "src/preload/pet-panel.js",
  "src/renderer/island/renderer/island.html",
  "src/renderer/island/app.js",
  "src/renderer/island/app.css",
  "src/renderer/island/session-model.mjs",
  "src/renderer/island/components/IslandPanel.js",
  "src/renderer/island/components/IslandPanel.css",
  "src/renderer/island/assets/status/running.svg",
  "src/renderer/island/assets/status/approval.svg",
  "src/renderer/island/assets/status/complete.svg",
  "src/renderer/island/assets/status/error.svg",
  "src/renderer/island/assets/status/xiaoyu-keeper-sprites.svg",
  "src/renderer/island/renderer/settings.html",
  "src/renderer/settings-app.js",
  "src/renderer/settings-app.css",
  "src/renderer/debug-app.js",
  "src/renderer/debug-app.css",
  "src/renderer/assets/welcome-app.js",
  "src/renderer/assets/welcome-view.js",
  "src/renderer/assets/welcome.css",
  "src/renderer/island/renderer/pet.html",
  "src/renderer/island/renderer/pet-panel.html",
  "src/renderer/pet/app.js",
  "src/renderer/pet/app.css",
  "src/renderer/pet/model.mjs",
  "src/renderer/pet/panel-app.js",
  "src/renderer/pet/panel.css",
  "src/renderer/pet/orca.png",
  "native/panel-fix/binding.gyp",
  "native/panel-fix/src/panel_fix.mm",
  "resources/bin/flux-hooks",
  "resources/pet-sprites/orca.png",
  "resources/pet-sprites/qianxue.webp",
  "resources/icon.png",
  "resources/icon.icns",
  "resources/scripts/collect-logs.sh",
  "resources/scripts/collect-logs.ps1"
];

const missing = required.filter((file) => !existsSync(join(root, file)));
if (missing.length) {
  console.error(`Missing required files:\n${missing.map((file) => `- ${file}`).join("\n")}`);
  process.exit(1);
}

function collectJavaScript(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collectJavaScript(path, files);
    else if ([".js", ".cjs", ".mjs"].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

const targets = [
  ...collectJavaScript(join(root, "src")),
  ...collectJavaScript(join(root, "scripts"))
];

const forbiddenDependencies = ["@dp/", "@ies/", "@rdservices/", "@slardar/", "electron-updater"];
const packageJson = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(join(root, "package.json"), "utf8")));
if (packageJson.main !== "./src/main/index.cjs") {
  console.error("package.json must run from src/main/index.cjs.");
  process.exit(1);
}
if (packageJson.license !== "Apache-2.0" || !existsSync(join(root, "LICENSE")) || !existsSync(join(root, "NOTICE"))) {
  console.error("The source license metadata is incomplete.");
  process.exit(1);
}
if (packageJson.scripts?.["build:native"] !== "node ./scripts/build-native.mjs") {
  console.error("The reproducible native-module build command is missing.");
  process.exit(1);
}
const declaredDependencies = Object.keys(packageJson.dependencies || {});
const forbiddenDeclared = declaredDependencies.filter((name) => forbiddenDependencies.some((prefix) => name.startsWith(prefix)));
if (forbiddenDeclared.length) {
  console.error(`Out-of-scope dependencies remain in package.json: ${forbiddenDeclared.join(", ")}`);
  process.exit(1);
}

for (const file of targets) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "pipe" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    console.error(`Syntax check failed: ${file}`);
    process.exit(1);
  }
}

const settingsApp = readFileSync(join(root, "src/renderer/settings-app.js"), "utf8");
for (const unavailableFeature of ["feishuNotify", "remoteProfiles", "cloudAgentStatus"]) {
  if (settingsApp.includes(unavailableFeature)) {
    console.error(`Unavailable settings feature returned: ${unavailableFeature}`);
    process.exit(1);
  }
}
const islandPanelSource = readFileSync(join(root, "src/renderer/island/components/IslandPanel.js"), "utf8");
if (!islandPanelSource.includes("panel-pet-button") || !islandPanelSource.includes("打开或关闭桌宠")) {
  console.error("The island pet entry button is missing.");
  process.exit(1);
}
const hooksCliPath = join(root, "src/island/hooks-cli/index.cjs");
if (!existsSync(hooksCliPath)) {
  console.error("The local Agent hooks CLI is missing.");
  process.exit(1);
}
const islandAppSource = readFileSync(join(root, "src/renderer/island/app.js"), "utf8");
for (const removedDragEntry of ["PILL_DRAG_THRESHOLD_Y", "handlePillMouseDown", "dragPetMove"]) {
  if (islandAppSource.includes(removedDragEntry)) {
    console.error(`Removed pull-down pet entry returned: ${removedDragEntry}`);
    process.exit(1);
  }
}
for (const htmlFile of ["island.html", "pet.html", "pet-panel.html", "welcome.html"]) {
  const html = readFileSync(join(root, "src/renderer/island/renderer", htmlFile), "utf8");
  if (/assets\/welcome-[A-Za-z0-9]{6,}\.(?:js|css)/.test(html)) {
    console.error(`${htmlFile} still loads a hashed build entry.`);
    process.exit(1);
  }
}
const retiredRendererTerms = /mira|magibook|cloudAgent|remoteHosts|remoteLinkNotice|Remote-SSH|slardar/i;
for (const [name, source] of [["IslandPanel", islandPanelSource], ["island app", islandAppSource]]) {
  if (retiredRendererTerms.test(source)) {
    console.error(`Out-of-scope service code returned to the ${name} bundle.`);
    process.exit(1);
  }
}

const mainSource = readFileSync(join(root, "src/main/index.cjs"), "utf8");
const agentRegistrySource = readFileSync(join(root, "src/main/agent-registry.cjs"), "utf8");
if (!mainSource.includes('require("./agent-registry.cjs")') || !agentRegistrySource.includes("createLocalHookAdapterRegistry")) {
  console.error("The local Agent hook adapter registry is missing.");
  process.exit(1);
}
if (mainSource.split("\n").length > 3500) {
  console.error("src/main/index.cjs exceeded the 3500-line composition-root limit.");
  process.exit(1);
}
const auditedTargets = targets.filter((file) => file !== fileURLToPath(import.meta.url));
if (/com\.bytedance|ByteSans-Bold/.test(auditedTargets.map((file) => readFileSync(file, "utf8")).join("\n"))
  || existsSync(join(root, "src/renderer/pet/ByteSans-Bold.ttf"))) {
  console.error("Known proprietary branding or font references remain in source.");
  process.exit(1);
}

console.log(`Static check passed: ${targets.length} source/build files and ${required.length} runtime assets.`);
