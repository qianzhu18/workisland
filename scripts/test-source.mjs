import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { derivePetBubble, derivePetStatus, statusToIntervalMs, statusToRow } from "../src/renderer/pet/model.mjs";
import { canContinueSessionViaTerminalPrompt, isVisibleInIsland, sortVisibleSessions } from "../src/renderer/island/session-model.mjs";

const require = createRequire(import.meta.url);
const { IPC } = require("../src/shared/ipc.cjs");
const {
  DEFAULT_SETTINGS,
  createDefaultSettings,
  mergeSettings
} = require("../src/shared/settings.cjs");
const { resolveRuntimeMode } = require("../src/main/runtime-mode.cjs");
const { encodeLine, decodeLines, getSocketPath } = require("../src/main/bridge-protocol.cjs");
const { createWindowClasses } = require("../src/main/windows.cjs");
const {
  APPROVAL_MODE,
  CONFIGURABLE_APPROVAL_AGENTS,
  normalizeApprovalModes,
  resolveApprovalMode
} = require("../src/shared/approval-policy.cjs");
const { createHooksCliCommand, quoteShellArgument } = require("../src/main/hooks-cli-command.cjs");
const { SettingsRepository } = require("../src/main/settings-repository.cjs");
const { PetModeController } = require("../src/main/pet-mode-controller.cjs");
const { normalizeDisplayPreference } = require("../src/main/display-manager.cjs");
const { listCodexPets, resolveCodexPet } = require("../src/main/codex-pet.cjs");
const { buildPermissionDirective } = require("../src/main/permission-directives.cjs");
const { createNativePlatformService, DEFAULT_FULLSCREEN_STATE } = require("../src/main/native-platform-service.cjs");
const { formatDailyLogName, isSafeStreamError } = require("../src/main/log-lifecycle.cjs");
const { isAllowedExternalUrl } = require("../src/main/external-url-policy.cjs");
const mainSessionPolicy = require("../src/main/session-policy.cjs");

assert.equal(Object.keys(IPC).length, 87, "IPC contract changed; review both main and preload consumers");
assert.equal(new Set(Object.values(IPC)).size, Object.keys(IPC).length, "IPC channels must be unique");
assert.ok(Object.isFrozen(IPC), "IPC contract must be immutable");
assert.equal(IPC.PET_DRAG_TO_ISLAND, "pet:drag-to-island");
assert.equal(IPC.SETTINGS_GET_CUSTOM_ICON, "settings:get-custom-icon");
assert.equal(IPC.PET_TOGGLE, "pet:toggle");
assert.equal(IPC.SETTINGS_GET_CODEX_PETS, "settings:get-codex-pets");
assert.equal(normalizeDisplayPreference("active"), "auto", "legacy active display mode must migrate to auto");
assert.equal(normalizeDisplayPreference("primary"), "primary");
assert.equal(DEFAULT_SETTINGS.petSprite, "codex:qianxue", "pet sprite must default to the bundled Codex V2 pet");
assert.equal(mergeSettings({ petSprite: "orca.png" }).petSprite, "codex:qianxue", "legacy Orca default must migrate to Codex qianxue");
const nativePanelSource = readFileSync(new URL("../native/panel-fix/src/panel_fix.mm", import.meta.url), "utf8");
assert.match(nativePanelSource, /napi_typeof\(env, value, &type\)/, "native display IDs must accept numeric Electron IDs");
assert.match(nativePanelSource, /NSMaxY\(frame\) - NSMaxY\(visible\)/, "menu bar height must exclude the Dock area");
const islandAppSource = readFileSync(new URL("../src/renderer/island/app.js", import.meta.url), "utf8");
const islandPanelSource = readFileSync(new URL("../src/renderer/island/components/IslandPanel.js", import.meta.url), "utf8");
const islandPreloadSource = readFileSync(new URL("../src/preload/island.js", import.meta.url), "utf8");
const islandAppCssSource = readFileSync(new URL("../src/renderer/island/app.css", import.meta.url), "utf8");
const petAppSource = readFileSync(new URL("../src/renderer/pet/app.js", import.meta.url), "utf8");
const petIpcSource = readFileSync(new URL("../src/main/ipc-services.cjs", import.meta.url), "utf8");
assert.match(islandAppSource, /hoverToOpen/, "hover-to-open setting must reach Island runtime behavior");
assert.match(islandAppSource, /autoCollapseOnMouseLeave/, "mouse-leave collapse setting must reach Island runtime behavior");
assert.match(islandPanelSource, /showUsageQuota/, "usage quota visibility setting must reach the panel renderer");
assert.match(islandPreloadSource, /getPetSpritePath/, "Island preload must expose the current pet sprite");
assert.match(islandPanelSource, /PetButtonIcon/, "Island pet button must render the current pet logo");
assert.match(islandAppCssSource, /pet-button-icon/, "pet logo needs dedicated styling");
assert.match(petAppSource, /onSettingsChanged/, "pet renderer must react to live sprite setting changes");
assert.match(petAppSource, /CODEX_V2_CELL_WIDTH/, "pet renderer must use the Codex V2 cell geometry");
assert.match(petIpcSource, /SETTINGS_GET_CODEX_PETS/, "settings IPC must expose Codex pet discovery");

assert.equal(derivePetStatus([{ phase: "running" }]), "running");
assert.equal(derivePetStatus([{ phase: "completed" }, { phase: "waitingForApproval" }]), "attention");
assert.deepEqual(derivePetBubble("running", 1), { text: "WORKING", size: "md", color: "#1C1D1E" });
assert.equal(derivePetBubble("idle", 0), null);
assert.equal(statusToRow("drag"), 6);
assert.equal(statusToRow("running", { protocol: "codex-v2" }), 7);
assert.equal(statusToRow("complete", { protocol: "codex-v2" }), 8);
assert.equal(statusToRow("drag", { protocol: "codex-v2" }), 1);
assert.equal(statusToIntervalMs("running"), 120);

const visibleSession = { id: "visible", isHookManaged: true, latestUserPrompt: "hello", updatedAt: 2 };
assert.equal(isVisibleInIsland(visibleSession), true);
assert.equal(isVisibleInIsland({ parentSessionId: "parent", phase: "waitingForApproval" }), false);
assert.deepEqual(sortVisibleSessions([{ ...visibleSession, id: "old", updatedAt: 1 }, visibleSession]).map(({ id }) => id), ["visible", "old"]);
assert.equal(canContinueSessionViaTerminalPrompt({ phase: "completed", tool: "codex", jumpTarget: { app: "Terminal", tty: "/dev/ttys001" } }), true);
assert.equal(canContinueSessionViaTerminalPrompt({ phase: "completed", tool: "codex", jumpTarget: { app: "Terminal", tty: "/dev/ttys001", remote: true } }), false);
assert.equal(mainSessionPolicy.canContinueSessionViaTerminalPrompt({ phase: "completed", tool: "codex", jumpTarget: { app: "Terminal", tty: "/dev/ttys001", remote: true } }), false);

assert.equal(isAllowedExternalUrl("https://github.com/example/repo"), true);
assert.equal(isAllowedExternalUrl("http://localhost:3000/docs"), true);
assert.equal(isAllowedExternalUrl("file:///etc/passwd"), false);
assert.equal(isAllowedExternalUrl("javascript:alert(1)"), false);
assert.equal(isAllowedExternalUrl("x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"), true);
assert.equal(formatDailyLogName(new Date(2026, 7, 6)), "flux-desktop-2026-08-06.log");
assert.equal(isSafeStreamError({ code: "EPIPE" }), true);
assert.equal(isSafeStreamError({ code: "EACCES" }), false);

const nativeWarnings = [];
const unavailableNativePlatform = createNativePlatformService({
  addonPath: "/missing/panel_fix.node",
  platform: "linux",
  load: () => { throw new Error("must not load"); },
  logger: { warn: (...args) => nativeWarnings.push(args) }
});
assert.equal(unavailableNativePlatform.available, false);
assert.deepEqual(unavailableNativePlatform.getAllScreensInfo(), []);
assert.equal(unavailableNativePlatform.getScreenFullscreenState("display"), DEFAULT_FULLSCREEN_STATE);
assert.deepEqual(nativeWarnings, []);

const nativeCalls = [];
const availableNativePlatform = createNativePlatformService({
  addonPath: "/mock/panel_fix.node",
  platform: "darwin",
  load: () => ({
    fixPanel: (...args) => nativeCalls.push(args),
    getFrontmostAppDisplayId: () => "display-1",
    getScreenFullscreenState: () => { throw new Error("native failure"); }
  }),
  logger: { warn: (...args) => nativeWarnings.push(args) }
});
availableNativePlatform.fixPanel("handle", "display-1");
assert.equal(availableNativePlatform.available, true);
assert.equal(availableNativePlatform.getFrontmostAppDisplayId(), "display-1");
assert.deepEqual(availableNativePlatform.getScreenFullscreenState("display-1"), DEFAULT_FULLSCREEN_STATE);
assert.deepEqual(nativeCalls, [["handle", "display-1"]]);

const defaultsA = createDefaultSettings();
const defaultsB = createDefaultSettings();
defaultsA.sound.volume = 1;
assert.equal(defaultsB.sound.volume, 50, "default settings instances must not share nested state");
assert.equal(DEFAULT_SETTINGS.sound.volume, 50);
assert.deepEqual(CONFIGURABLE_APPROVAL_AGENTS, ["codex", "coco", "copilot-cli", "traex"]);
assert.ok(CONFIGURABLE_APPROVAL_AGENTS.every((agent) => DEFAULT_SETTINGS.approvalModes[agent] === "bridge"));
assert.equal(resolveApprovalMode({}, "codex"), APPROVAL_MODE.ISLAND);
assert.deepEqual(normalizeApprovalModes({ codex: "terminalNative", unknown: "bridge" }), {
  codex: "terminalNative",
  coco: "bridge",
  "copilot-cli": "bridge",
  traex: "bridge"
});
assert.equal(quoteShellArgument("it's"), `'it'"'"'s'`);
assert.equal(
  createHooksCliCommand({ appPath: "/tmp/Flux App", source: "codex", nodePath: "/usr/bin/node" }),
  `'/usr/bin/node' '/tmp/Flux App/src/island/hooks-cli/index.cjs' --source 'codex'`
);

const settingsTestDirectory = mkdtempSync(join(tmpdir(), "flux-settings-"));
try {
  const settingsPath = join(settingsTestDirectory, "settings.json");
  writeFileSync(settingsPath, JSON.stringify({ sound: { volume: 77 } }));
  const repository = new SettingsRepository(settingsPath, { saveDelayMs: 60_000 });
  const storedSettings = repository.load();
  assert.equal(storedSettings.sound.volume, 77);
  assert.equal(storedSettings.approvalModes.codex, "bridge");
  repository.scheduleSave({ ...storedSettings, locale: "zh" });
  repository.dispose();
  assert.equal(JSON.parse(readFileSync(settingsPath, "utf8")).locale, "zh");
} finally {
  rmSync(settingsTestDirectory, { recursive: true, force: true });
}

const codexPetTestDirectory = mkdtempSync(join(tmpdir(), "flux-codex-pets-"));
try {
  const codexHome = join(codexPetTestDirectory, ".codex");
  const petDirectory = join(codexHome, "pets", "qianxue");
  const legacyDirectory = join(codexHome, "pets", "legacy");
  mkdirSync(petDirectory, { recursive: true });
  mkdirSync(legacyDirectory, { recursive: true });
  writeFileSync(join(petDirectory, "spritesheet.webp"), "fake-webp");
  writeFileSync(join(petDirectory, "pet.json"), JSON.stringify({
    id: "qianxue",
    displayName: "千雪",
    description: "test pet",
    spriteVersionNumber: 2,
    spritesheetPath: "spritesheet.webp"
  }));
  writeFileSync(join(legacyDirectory, "pet.json"), JSON.stringify({
    id: "legacy",
    spriteVersionNumber: 1,
    spritesheetPath: "spritesheet.webp"
  }));
  assert.deepEqual(listCodexPets({ CODEX_HOME: codexHome }, "/tmp/test-home"), [{
    id: "qianxue",
    displayName: "千雪",
    description: "test pet",
    spriteVersionNumber: 2,
    value: "codex:qianxue"
  }]);
  assert.equal(resolveCodexPet("qianxue", { CODEX_HOME: codexHome }, "/tmp/test-home").spritePath, join(petDirectory, "spritesheet.webp"));
  assert.throws(() => resolveCodexPet("../qianxue", { CODEX_HOME: codexHome }, "/tmp/test-home"), /Invalid Codex pet id/);
} finally {
  rmSync(codexPetTestDirectory, { recursive: true, force: true });
}

let petReady;
const petEvents = [];
const petMessages = [];
let petDestroyed = false;
const petWindow = {
  isPanelOpen: false,
  setOnMove(callback) { this.onMove = callback; },
  send(channel, payload) { petMessages.push({ channel, payload }); },
  getCanvasBounds() { return { x: 10, y: 10, width: 20, height: 20 }; },
  destroy() { petDestroyed = true; }
};
const petMode = new PetModeController({
  registerReady(callback) { petReady = callback; },
  sessionUpdateChannel: IPC.PET_SESSION_UPDATE,
  getSessions: () => [{ id: "session-1" }],
  onModeChange: (from, to) => petEvents.push(`${from}:${to}`)
});
petMode.setIslandWindow({ getPillRect: () => ({ x: 0, y: 0, width: 40, height: 40 }) });
petMode.setWindowFactory(() => petWindow);
assert.equal(petMode.enter(10, 10), true);
assert.equal(petMode.enter(10, 10), false, "opening an existing pet must be idempotent");
petReady();
assert.deepEqual(petMessages, [{ channel: IPC.PET_SESSION_UPDATE, payload: [{ id: "session-1" }] }]);
assert.equal(petMode.tryReturnToIsland(), true);
assert.equal(petDestroyed, true);
assert.deepEqual(petEvents, ["island:pet", "pet:island"]);

assert.deepEqual(
  buildPermissionDirective({ tool: "codex" }, { action: "allowOnce" }),
  { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } }
);
assert.deepEqual(
  buildPermissionDirective({ tool: "coco" }, { action: "deny", message: "unsafe" }),
  { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", interrupt: true, message: "unsafe" } } }
);
assert.deepEqual(
  buildPermissionDirective({ tool: "copilot-cli" }, { action: "deny" }),
  { permissionDecision: "deny" }
);
assert.deepEqual(
  buildPermissionDirective({ tool: "traex" }, { action: "allowOnce" }),
  { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } }
);

const merged = mergeSettings({
  sound: { volume: 72 },
  hookToggles: { codex: false },
  shortcuts: {
    modifiers: [],
    bindings: { approve: { key: "K", enabled: false } }
  }
});
assert.equal(merged.sound.volume, 72);
assert.equal(merged.sound.enabled, true);
assert.equal(merged.hookToggles.codex, false);
assert.equal(merged.hookToggles.claude, true);
assert.deepEqual(merged.shortcuts.modifiers, ["Ctrl"]);
assert.deepEqual(merged.shortcuts.bindings.approve, { key: "K", enabled: false });
assert.deepEqual(merged.shortcuts.bindings.reject, { key: "N", enabled: true });

assert.deepEqual(resolveRuntimeMode({}), {
  isDevelopment: false,
  isIntegrated: false,
  localOnly: true,
  userDataPath: null
});
assert.deepEqual(resolveRuntimeMode({ FLUX_DEVELOPMENT: "1", FLUX_DEV_USER_DATA: "/tmp/flux" }), {
  isDevelopment: true,
  isIntegrated: false,
  localOnly: true,
  userDataPath: "/tmp/flux"
});
const integratedMode = resolveRuntimeMode({ FLUX_DEVELOPMENT: "1", FLUX_INTEGRATED: "1" });
assert.equal(integratedMode.isIntegrated, true);
assert.equal(integratedMode.localOnly, true);

const firstFrame = encodeLine({ type: "hello", hello: { protocolVersion: 1 } });
const secondFrame = encodeLine({ type: "response", response: { type: "acknowledged" } });
const partial = Buffer.concat([firstFrame, secondFrame.subarray(0, 8)]);
const decoded = decodeLines(partial);
assert.deepEqual(decoded.messages, [{ type: "hello", hello: { protocolVersion: 1 } }]);
assert.deepEqual(decoded.remainder, secondFrame.subarray(0, 8));
assert.equal(decodeLines(Buffer.concat([decoded.remainder, secondFrame.subarray(8)])).messages.length, 1);
assert.equal(getSocketPath({ FLUX_SOCKET_PATH: "/tmp/custom.sock" }, "/unused"), "/tmp/custom.sock");
assert.equal(getSocketPath({}, "/tmp/home"), "/tmp/home/.flux/run/bridge.sock");

const windowClasses = createWindowClasses({
  electron: {},
  path: {},
  utils: { is: { dev: false } },
  IPC,
  fixPanel() {},
  fixPetWindow() {},
  setWindowCornerRadius() {},
  log: { error() {}, warn() {} },
  isVisibleInIsland() { return true; },
  getIsQuitting() { return false; }
});
assert.deepEqual(Object.keys(windowClasses).sort(), [
  "DebugWindow",
  "IslandWindow",
  "PetPanelWindow",
  "PetWindow",
  "SettingsWindow",
  "WelcomeWindow"
]);

console.log("Source contract tests passed: IPC, settings, runtime, bridge, and window boundaries.");
