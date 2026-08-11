"use strict";

const electron = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const child_process = require("node:child_process");
const promises = require("node:fs/promises");
const { IPC } = require("../shared/ipc.cjs");
const { listPluginAgentMeta } = require("./agent-registry.cjs");
const { listCodexPets, resolveCodexPet } = require("./codex-pet.cjs");
const { previewSound, getUserSoundsDir } = require("./sound-service.cjs");
const path__namespace = path;

function createIpcServices({ performHapticFeedback, isAllowedExternalUrl }) {
  const CUSTOM_ICON_FILE = "custom-icon.png";
  const MAX_CUSTOM_ICON_BYTES = 10 * 1024 * 1024;
  function getBundledIconPath() {
    return path.join(__dirname, "../../resources/icon.png");
  }
  function getCustomIconPath() {
    return path.join(electron.app.getPath("userData"), CUSTOM_ICON_FILE);
  }
  function getCustomIconDataUrl() {
    try {
      const iconPath = getCustomIconPath();
      if (!fs.existsSync(iconPath)) return null;
      const image = electron.nativeImage.createFromPath(iconPath);
      return image.isEmpty() ? null : image.toDataURL();
    } catch {
      return null;
    }
  }
  function applyDockIcon(dataUrl) {
    if (process.platform !== "darwin" || !electron.app.dock) return;
    const image = dataUrl ? electron.nativeImage.createFromDataURL(dataUrl) : electron.nativeImage.createFromPath(getBundledIconPath());
    if (!image.isEmpty()) electron.app.dock.setIcon(image);
  }
  function broadcastCustomIcon(dataUrl) {
    for (const win of electron.BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.CUSTOM_ICON_CHANGED, dataUrl);
    }
  }
  async function selectCustomIcon(parentWindow) {
    const result = await electron.dialog.showOpenDialog(parentWindow, {
      title: "选择自定义 Icon",
      properties: ["openFile"],
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }]
    });
    if (result.canceled || result.filePaths.length === 0) return getCustomIconDataUrl();
    const sourcePath = result.filePaths[0];
    const stat = await promises.stat(sourcePath);
    if (stat.size > MAX_CUSTOM_ICON_BYTES) {
      throw new Error("Icon file is too large (maximum 10 MB)");
    }
    const source = electron.nativeImage.createFromPath(sourcePath);
    if (source.isEmpty()) throw new Error("Unable to read icon image");
    const size = source.getSize();
    const edge = Math.min(size.width, size.height);
    const square = source.crop({
      x: Math.floor((size.width - edge) / 2),
      y: Math.floor((size.height - edge) / 2),
      width: edge,
      height: edge
    }).resize({ width: 256, height: 256, quality: "best" });
    const targetPath = getCustomIconPath();
    await promises.mkdir(path.dirname(targetPath), { recursive: true });
    await promises.writeFile(targetPath, square.toPNG());
    const dataUrl = square.toDataURL();
    applyDockIcon(dataUrl);
    broadcastCustomIcon(dataUrl);
    return dataUrl;
  }
  async function resetCustomIcon() {
    try {
      await promises.unlink(getCustomIconPath());
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
    }
    applyDockIcon(null);
    broadcastCustomIcon(null);
    return null;
  }
  const DEFAULT_SPRITE = "orca.png";
  function getDefaultSpritesDir() {
    if (electron.app.isPackaged) {
      return path.resolve(process.resourcesPath, "pet-sprites");
    }
    return path.resolve(electron.app.getAppPath(), "resources", "pet-sprites");
  }
  function getUserSpritesDir() {
    return path.join(electron.app.getPath("userData"), "pet-sprites");
  }
  /**
   * 解析桌宠 sprite 文件路径。
   *
   * 支持三种格式：
   *   1. 默认（null/空）→ DEFAULT_SPRITE（orca.png）
   *   2. 文件名（xxx.png / xxx.webp）→ 在 user/default sprites 目录查找
   *   3. "codex:<pet-name>" → 解析 ~/.codex/pets/<pet-name>/spritesheet.webp
   *      （兼容 Codex V2 桌宠协议，pet.json 描述布局）
   */
  function resolveSpriteSelection(fileName) {
    const raw = fileName || DEFAULT_SPRITE;
    // Codex pet 协议：codex:<pet-name>
    if (raw.startsWith("codex:")) {
      const petName = raw.slice("codex:".length);
      const pet = resolveCodexPet(petName);
      return { filePath: pet.spritePath, protocol: "codex-v2", pet };
    }
    // 普通文件名：接受 .png 和 .webp
    const safe = path.basename(raw);
    if (safe !== raw || safe.includes("..")) {
      throw new Error("Invalid sprite filename");
    }
    const lower = safe.toLowerCase();
    if (!lower.endsWith(".png") && !lower.endsWith(".webp")) {
      throw new Error("Only .png and .webp are allowed");
    }
    const userPath = path.join(getUserSpritesDir(), safe);
    const filePath = fs.existsSync(userPath) ? userPath : path.join(getDefaultSpritesDir(), safe);
    return { filePath, protocol: "orca-v1" };
  }
  let spriteDirsInitialized = false;
  function initSpriteDirs() {
    if (spriteDirsInitialized) return;
    const userDir = getUserSpritesDir();
    const defaultDir = getDefaultSpritesDir();
    try {
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }
      const dest = path.join(userDir, DEFAULT_SPRITE);
      if (!fs.existsSync(dest)) {
        const src = path.join(defaultDir, DEFAULT_SPRITE);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
        }
      }
      spriteDirsInitialized = true;
    } catch (err) {
      spriteDirsInitialized = false;
      console.error("[SpriteService] failed to init user sprites dir:", err);
    }
  }
  function trackedOn(channel, handler) {
    electron.ipcMain.on(channel, handler);
  }
  function registerIpcHandlers(coordinator) {
    electron.ipcMain.handle(IPC.SETTINGS_GET, () => {
      return coordinator.getSettings();
    });
    electron.ipcMain.handle(IPC.GET_LOCALE, () => {
      return coordinator.getSettings().locale ?? "zh";
    });
    electron.ipcMain.handle(IPC.SET_LOCALE, (_event, { locale }) => {
      coordinator.updateSettings({ locale }, "settings");
    });
    electron.ipcMain.handle(IPC.SETTINGS_SET, (_event, partial) => {
      if (typeof partial?.petSprite === "string" && partial.petSprite.startsWith("codex:")) {
        resolveCodexPet(partial.petSprite.slice("codex:".length));
      }
      coordinator.updateSettings(partial, "settings");
    });
    electron.ipcMain.handle(IPC.SETTINGS_GET_CODEX_PETS, () => listCodexPets());
    electron.ipcMain.handle(IPC.SETTINGS_GET_CUSTOM_ICON, () => {
      return getCustomIconDataUrl();
    });
    electron.ipcMain.handle(IPC.SETTINGS_SELECT_CUSTOM_ICON, (event) => {
      return selectCustomIcon(electron.BrowserWindow.fromWebContents(event.sender) ?? void 0);
    });
    electron.ipcMain.handle(IPC.SETTINGS_RESET_CUSTOM_ICON, () => {
      return resetCustomIcon();
    });
    electron.ipcMain.handle(IPC.SETTINGS_GET_HOOK_STATUS, () => {
      return coordinator.getHookStatus();
    });
    electron.ipcMain.handle(IPC.PLUGIN_AGENT_META, () => {
      return listPluginAgentMeta();
    });
    electron.ipcMain.handle(IPC.SETTINGS_COPY_IMAGE_TO_CLIPBOARD, async (event, { rect }) => {
      if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
        throw new Error("Invalid clipboard capture rect");
      }
      const captureRect = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
      let image = await event.sender.capturePage(captureRect);
      if (image.isEmpty()) {
        const fullImage = await event.sender.capturePage();
        const ownerWindow = electron.BrowserWindow.fromWebContents(event.sender);
        const [contentWidth, contentHeight] = ownerWindow?.getContentSize() ?? [
          Math.max(captureRect.x + captureRect.width, 1),
          Math.max(captureRect.y + captureRect.height, 1)
        ];
        const fullSize = fullImage.getSize();
        const scaleX = fullSize.width / Math.max(contentWidth, 1);
        const scaleY = fullSize.height / Math.max(contentHeight, 1);
        image = fullImage.crop({
          x: Math.max(0, Math.round(captureRect.x * scaleX)),
          y: Math.max(0, Math.round(captureRect.y * scaleY)),
          width: Math.max(1, Math.round(captureRect.width * scaleX)),
          height: Math.max(1, Math.round(captureRect.height * scaleY))
        });
      }
      if (image.isEmpty()) {
        throw new Error("Clipboard image is empty");
      }
      electron.clipboard.writeImage(electron.nativeImage.createFromDataURL(image.toDataURL()));
    });
    electron.ipcMain.handle(IPC.SETTINGS_COPY_IMAGE_DATA_URL_TO_CLIPBOARD, (_event, { dataUrl }) => {
      if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
        throw new Error("Invalid clipboard image data URL");
      }
      const image = electron.nativeImage.createFromDataURL(dataUrl);
      if (image.isEmpty()) {
        throw new Error("Clipboard image data URL is empty");
      }
      electron.clipboard.writeImage(image);
    });
    electron.ipcMain.handle(IPC.SETTINGS_INSTALL_HOOK, (_event, { agentId }) => {
      return coordinator.installHook(agentId);
    });
    electron.ipcMain.handle(IPC.SETTINGS_UNINSTALL_HOOK, (_event, { agentId }) => {
      return coordinator.uninstallHook(agentId);
    });
    electron.ipcMain.handle(IPC.SETTINGS_UNINSTALL_ALL_HOOKS, () => {
      return coordinator.uninstallAllHooks();
    });
    electron.ipcMain.handle(IPC.USAGE_GET_QUOTA, () => {
      return coordinator.getClaudeQuota();
    });
    electron.ipcMain.handle(IPC.USAGE_GET_QUOTA_MAP, () => {
      return coordinator.getQuotaMap();
    });
    electron.ipcMain.handle(IPC.STATS_GET_SNAPSHOT, (_event, { timeRange }) => {
      return coordinator.getStatsSnapshot(timeRange);
    });
    electron.ipcMain.handle(IPC.WELCOME_GET_FIRST_LAUNCH_AT, () => {
      return coordinator.getSettings().firstLaunchAt;
    });
    trackedOn(IPC.SESSION_APPROVE, (_event, { sessionId, action }) => {
      coordinator.approveSession(sessionId, action);
    });
    trackedOn(IPC.SESSION_DENY, (_event, { sessionId }) => {
      coordinator.denySession(sessionId);
    });
    trackedOn(IPC.SESSION_ANSWER, (_event, { sessionId, answer }) => {
      coordinator.answerSession(sessionId, answer);
    });
    trackedOn(IPC.SESSION_CANCEL_QUESTION, (_event, { sessionId, cancel }) => {
      coordinator.cancelQuestion(sessionId, cancel);
    });
    trackedOn(IPC.SESSION_CONFIRM_PLAN, (_event, { sessionId, choice }) => {
      coordinator.confirmPlan(sessionId, choice);
    });
    trackedOn(IPC.SESSION_JUMP, (_event, { sessionId }) => {
      void coordinator.jumpToSession(sessionId).catch((err) => {
        console.error("[ipc] SESSION_JUMP failed:", sessionId, err);
      });
    });
    trackedOn(IPC.SESSION_DELETE, (_event, { sessionId }) => {
      coordinator.deleteSession(sessionId);
    });
    trackedOn(IPC.SESSION_DELETE_BATCH, (_event, { sessionIds }) => {
      coordinator.deleteSessions(sessionIds);
    });
    electron.ipcMain.on(IPC.SESSION_DISMISS_COMPLETION, (_event, { sessionId }) => {
      coordinator.dismissCompletion(sessionId);
    });
    electron.ipcMain.handle(IPC.SESSION_CONTINUE_VIA_TERMINAL_PROMPT, async (_event, { sessionId, text }) => {
      return coordinator.continueSessionViaTerminalPrompt(sessionId, text, { source: "island" });
    });
    electron.ipcMain.on(IPC.ISLAND_ENTER, () => {
    });
    electron.ipcMain.on(IPC.ISLAND_LEAVE, () => {
    });
    electron.ipcMain.on(IPC.ISLAND_SURFACE_DISMISSED, () => {
      coordinator.handleSurfaceDismissed();
    });
    electron.ipcMain.on(IPC.ISLAND_TOGGLE_SOUND, () => {
      coordinator.toggleSound();
    });
    electron.ipcMain.on(IPC.ISLAND_HAPTIC, () => {
      if (coordinator.getSettings().hapticFeedback) {
        performHapticFeedback();
      }
    });
    electron.ipcMain.on(IPC.ISLAND_OPEN_SETTINGS, () => {
      coordinator.openSettingsWindow();
    });
    electron.ipcMain.on(IPC.ISLAND_OPEN_SETTINGS_TAB, (_event, tab) => {
      coordinator.openSettingsTab(tab);
    });
    trackedOn(IPC.APP_QUIT, () => {
      electron.app.quit();
    });
    electron.ipcMain.on(IPC.APP_OPEN_EXTERNAL, (_event, url2) => {
      if (!isAllowedExternalUrl(url2)) {
        console.warn("[ipc] blocked unsafe external URL");
        return;
      }
      void electron.shell.openExternal(url2);
    });
    electron.ipcMain.on(IPC.SETTINGS_PREVIEW_SOUND, (_event, { filename, volume }) => {
      previewSound(filename, volume);
    });
    electron.ipcMain.on(IPC.SETTINGS_OPEN_SOUNDS_DIR, () => {
      electron.shell.openPath(getUserSoundsDir());
    });
    electron.ipcMain.on(IPC.PET_OPEN_SPRITES_DIR, () => {
      initSpriteDirs();
      electron.shell.openPath(getUserSpritesDir());
    });
    electron.ipcMain.handle(IPC.PET_GET_SPRITE_PATH, async (_event, fileName) => {
      initSpriteDirs();
      // The renderer may omit the argument; use the setting so custom files
      // and Codex V2 pets are actually reachable from the settings page.
      const configuredSprite = coordinator.getSettings()?.petSprite || DEFAULT_SPRITE;
      const selection = resolveSpriteSelection(fileName || configuredSprite);
      const filePath = selection.filePath;
      const { size } = await promises.stat(filePath);
      if (size > 10 * 1024 * 1024) {
        throw new Error("Sprite file too large");
      }
      const buf = await promises.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime = ext === ".webp" ? "image/webp" : "image/png";
      return {
        dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
        protocol: selection.protocol,
        pet: selection.pet
          ? {
              id: selection.pet.id,
              displayName: selection.pet.displayName,
              spriteVersionNumber: selection.pet.spriteVersionNumber
            }
          : null
      };
    });
    electron.ipcMain.handle(IPC.COLLECT_LOGS, async () => {
      const scriptPath = electron.app.isPackaged ? path__namespace.join(process.resourcesPath, "scripts", "collect-logs.sh") : path__namespace.join(electron.app.getAppPath(), "scripts", "collect-logs.sh");
      const desktopDir = electron.app.getPath("desktop");
      let outputDir = desktopDir;
      try {
        await promises.access(desktopDir, promises.constants.W_OK);
      } catch {
        outputDir = electron.app.getPath("temp");
      }
      const env = { ...process.env };
      const SAFE_PATH = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
      env.PATH = env.PATH ? `${env.PATH}:${SAFE_PATH}` : SAFE_PATH;
      const { stdout } = await new Promise((resolve, reject) => {
        child_process.execFile("/bin/bash", [scriptPath, "-o", outputDir], { timeout: 12e4, env, maxBuffer: 10 * 1024 * 1024 }, (err, stdout2, stderr) => {
          if (err) {
            const detail = (stderr || "") + (stdout2 ? `
  [stdout tail] ${stdout2.slice(-500)}` : "");
            reject(new Error(detail || err.message));
            return;
          }
          resolve({ stdout: stdout2, stderr });
        });
      });
      const match = stdout.match(/输出文件:\s*(.+\.zip)/);
      const zipPath = match ? match[1].trim() : "";
      if (zipPath) {
        electron.shell.showItemInFolder(zipPath);
      }
      return zipPath;
    });
  }
  return { registerIpcHandlers, getCustomIconDataUrl, applyDockIcon };
}

module.exports = { createIpcServices };
