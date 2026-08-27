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
const QUICK_SHARE_PROVIDER_TITLES = Object.freeze({
  Mail: "邮件",
  Messages: "信息",
  Notes: "备忘录",
  Freeform: "无边记",
  Simulator: "模拟器",
  Shortcuts: "快捷指令",
  "Add to Reading List": "加入阅读列表"
});

function createIpcServices({ performHapticFeedback, isAllowedExternalUrl, readPasteboardFileURLs = () => [], copyFilesToPasteboard = () => false, getFileIconDataUrl = () => null, getShareProviders = async () => [], shareFilesViaProvider = () => false, showFilesSharePicker = () => false, getAirDropIconDataUrl = () => null, shareFilesViaAirDrop = () => false, checkForUpdates = async () => ({ status: "unavailable" }) }) {
  const CUSTOM_ICON_FILE = "custom-icon.png";
  const MAX_CUSTOM_ICON_BYTES = 10 * 1024 * 1024;
  const shelfPreviewCache = new Map();
  async function getShelfPreview(coordinator, id) {
    const item = coordinator.getShelfItem(String(id || ""));
    if (!item?.path || !item.available) return null;
    if (shelfPreviewCache.has(item.id)) return shelfPreviewCache.get(item.id);
    const pending = (async () => {
      let image = null;
      if (item.type !== "directory" && typeof electron.nativeImage.createThumbnailFromPath === "function") {
        try {
          image = await electron.nativeImage.createThumbnailFromPath(item.path, { width: 112, height: 112 });
        } catch {}
      }
      if (!image || image.isEmpty()) {
        const dataUrl = getFileIconDataUrl(item.path);
        return typeof dataUrl === "string" && dataUrl.startsWith("data:image/png;base64,") && dataUrl.length <= 1024 * 1024
          ? dataUrl
          : null;
      }
      if (!image || image.isEmpty()) return null;
      const size = image.getSize();
      if (size.width > 112 || size.height > 112) image = image.resize({ width: 112, height: 112, quality: "best" });
      const dataUrl = image.toDataURL();
      return dataUrl.length <= 1024 * 1024 ? dataUrl : null;
    })();
    shelfPreviewCache.set(item.id, pending);
    return pending;
  }
  async function listShelfShareProviders() {
    try {
      const providers = await getShareProviders();
      return (Array.isArray(providers) ? providers : []).flatMap((provider) => {
        const id = typeof provider?.id === "string" ? provider.id.trim().slice(0, 160) : "";
        const nativeTitle = typeof provider?.title === "string" ? provider.title.trim().slice(0, 160) : id;
        const title = QUICK_SHARE_PROVIDER_TITLES[id] || QUICK_SHARE_PROVIDER_TITLES[nativeTitle] || nativeTitle;
        const iconDataUrl = typeof provider?.iconDataUrl === "string" && provider.iconDataUrl.startsWith("data:image/png;base64,") && provider.iconDataUrl.length <= 256 * 1024
          ? provider.iconDataUrl
          : "";
        return id && title ? [{ id, title, iconDataUrl }] : [];
      });
    } catch {
      return [];
    }
  }
  function sharePathsViaQuickProvider(coordinator, parentWindow, paths) {
    const availablePaths = [...new Set(Array.isArray(paths) ? paths : [])].filter((entry) => typeof entry === "string" && fs.existsSync(entry));
    if (availablePaths.length === 0) return { ok: false, providerId: "", fallback: false };
    const providerId = coordinator.getSettings().shelfQuickShareProvider || "AirDrop";
    if (providerId !== "__system__" && shareFilesViaProvider(availablePaths, providerId)) {
      return { ok: true, providerId, fallback: false };
    }
    const ok = Boolean(parentWindow && !parentWindow.isDestroyed() && showFilesSharePicker(parentWindow.getNativeWindowHandle(), availablePaths));
    return { ok, providerId, fallback: ok };
  }
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
  async function selectDirectory(parentWindow) {
    const result = await electron.dialog.showOpenDialog(parentWindow, {
      title: "选择终端默认目录",
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  }
  const DEFAULT_SPRITE = "codex:qianxue";
  const LEGACY_DEFAULT_SPRITE = "orca.png";
  const BUILT_IN_CODEX_PETS = Object.freeze({
    qianxue: Object.freeze({
      id: "qianxue",
      displayName: "千雪",
      description: "WorkIsland 内置 Codex V2 桌宠。",
      spriteVersionNumber: 2,
      spriteFile: "qianxue.webp",
      value: "codex:qianxue"
    }),
    "codex-buddy": Object.freeze({
      id: "codex-buddy",
      displayName: "宝剑 Skyler",
      description: "WorkIsland 内置 Codex V2 桌宠。",
      spriteVersionNumber: 2,
      spriteFile: "codex-buddy.webp",
      value: "codex:codex-buddy"
    })
  });
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
   *   1. 默认（null/空）→ DEFAULT_SPRITE（内置 codex:qianxue）
   *   2. 文件名（xxx.png / xxx.webp）→ 在 user/default sprites 目录查找
   *   3. "codex:<pet-name>" → 解析 ~/.codex/pets/<pet-name>/spritesheet.webp
   *      （兼容 Codex V2 桌宠协议，pet.json 描述布局）
   */
  function resolveSpriteSelection(fileName) {
    const raw = fileName || DEFAULT_SPRITE;
    // Codex pet 协议：codex:<pet-name>
    if (raw.startsWith("codex:")) {
      const petName = raw.slice("codex:".length);
      const builtInPet = BUILT_IN_CODEX_PETS[petName];
      if (builtInPet) {
        const filePath = path.join(getDefaultSpritesDir(), builtInPet.spriteFile);
        if (!fs.existsSync(filePath)) {
          throw new Error(`Bundled Codex pet spritesheet not found: ${filePath}`);
        }
        return {
          filePath,
          protocol: "codex-v2",
          pet: { ...builtInPet, spritePath: filePath }
        };
      }
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
      // Keep the legacy Orca asset available for custom/compatibility use.
      // The built-in Codex V2 pet is read directly from packaged resources.
      const dest = path.join(userDir, LEGACY_DEFAULT_SPRITE);
      if (!fs.existsSync(dest)) {
        const src = path.join(defaultDir, LEGACY_DEFAULT_SPRITE);
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
    electron.ipcMain.handle(IPC.SETTINGS_GET_TELEMETRY_STATUS, () => {
      return coordinator.getTelemetryStatus();
    });
    electron.ipcMain.handle(IPC.APP_CHECK_FOR_UPDATES, () => checkForUpdates({ force: true, notify: false }));
    electron.ipcMain.handle(IPC.GET_LOCALE, () => {
      return coordinator.getSettings().locale ?? "zh";
    });
    electron.ipcMain.handle(IPC.SET_LOCALE, (_event, { locale }) => {
      coordinator.updateSettings({ locale }, "settings");
    });
    electron.ipcMain.handle(IPC.SETTINGS_SET, (_event, partial) => {
      if (typeof partial?.petSprite === "string" && partial.petSprite.startsWith("codex:")) {
        // Validate both bundled and user-installed Codex V2 pets through the
        // same resolver used by the renderer, so the packaged default works
        // even when ~/.codex/pets/qianxue is absent.
        resolveSpriteSelection(partial.petSprite);
      }
      coordinator.updateSettings(partial, "settings");
    });
    electron.ipcMain.handle(IPC.SETTINGS_SELECT_DIRECTORY, (event) => {
      return selectDirectory(electron.BrowserWindow.fromWebContents(event.sender) ?? void 0);
    });
    electron.ipcMain.handle(IPC.SETTINGS_GET_CODEX_PETS, () => {
      const bundled = Object.values(BUILT_IN_CODEX_PETS).map(({ spriteFile, ...pet }) => pet);
      const discovered = listCodexPets().filter((pet) => !BUILT_IN_CODEX_PETS[pet.id]);
      return [...bundled, ...discovered];
    });
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
    electron.ipcMain.handle(IPC.USAGE_GET_SUMMARY, (_event, { days } = {}) => {
      return coordinator.getUsageSummary(days);
    });
    electron.ipcMain.handle(IPC.USAGE_GET_SESSION_INSIGHTS, (_event, { days } = {}) => {
      return coordinator.getSessionInsights(days);
    });
    // PRD-015 T7：导出 JSON（保存对话框 + 写文件，数据留在用户手里）
    electron.ipcMain.handle(IPC.USAGE_EXPORT_DATA, async () => {
      const data = coordinator.exportUsageData();
      const win = coordinator.islandWindow && !coordinator.islandWindow.isDestroyed() ? coordinator.islandWindow : undefined;
      const stamp = new Date(data.exportedAt).toISOString().slice(0, 10);
      const result = await electron.dialog.showSaveDialog(win, {
        title: "导出用量数据",
        defaultPath: `workisland-usage-${stamp}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }]
      });
      if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
      fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), "utf-8");
      return { ok: true, path: result.filePath };
    });
    electron.ipcMain.handle(IPC.USAGE_CLEAR_DATA, () => {
      return coordinator.clearUsageData();
    });
    electron.ipcMain.handle(IPC.MEDIA_GET_STATE, () => coordinator.getMediaState());
    electron.ipcMain.handle(IPC.MEDIA_COMMAND, (_event, command) => coordinator.sendMediaCommand(command));
    electron.ipcMain.handle(IPC.LYRICS_GET_STATE, () => coordinator.getLyricsState());
    electron.ipcMain.handle(IPC.LYRICS_CLEAR_CACHE, () => coordinator.clearLyricsCache());
    electron.ipcMain.handle(IPC.PERFORMANCE_GET_STATE, () => coordinator.getPerformanceState());
    electron.ipcMain.on(IPC.PERFORMANCE_DETAILS_VISIBLE, (_event, { visible }) => {
      coordinator.setPerformanceDetailsVisible(Boolean(visible));
    });
    electron.ipcMain.handle(IPC.PERFORMANCE_PROCESS_ACTION, (_event, request) => {
      return coordinator.actOnProcess(request);
    });
    electron.ipcMain.handle(IPC.SHELF_GET_STATE, () => coordinator.getShelfState());
    electron.ipcMain.handle(IPC.SHELF_GET_PREVIEW, (_event, { id } = {}) => getShelfPreview(coordinator, id));
    electron.ipcMain.handle(IPC.SHELF_ADD_PATHS, (_event, { paths } = {}) => coordinator.addShelfPaths(paths));
    electron.ipcMain.handle(IPC.SHELF_ADD_PAYLOAD, (_event, payload) => coordinator.addShelfPayload(payload));
    electron.ipcMain.handle(IPC.SHELF_REMOVE, (_event, { ids } = {}) => coordinator.removeShelfItems(ids));
    electron.ipcMain.handle(IPC.SHELF_CLEAR, () => coordinator.clearShelf());
    electron.ipcMain.handle(IPC.SHELF_OPEN, (_event, { id } = {}) => coordinator.openShelfItem(String(id || "")));
    electron.ipcMain.handle(IPC.SHELF_REVEAL, (_event, { id } = {}) => coordinator.revealShelfItem(String(id || "")));
    electron.ipcMain.handle(IPC.SHELF_QUICK_LOOK, (_event, { id } = {}) => coordinator.quickLookShelfItem(String(id || "")));
    const resolveShelfItems = (coordinator, ids) => [...new Set(Array.isArray(ids) ? ids : [])]
      .map((id) => coordinator.getShelfItem(String(id || "")))
      .filter(Boolean);
    electron.ipcMain.handle(IPC.SHELF_START_DRAG, async (event, { ids } = {}) => {
      const files = resolveShelfItems(coordinator, ids).filter((item) => item.path && item.available).map((item) => item.path);
      if (files.length === 0) return false;
      const iconDataUrl = getFileIconDataUrl(files[0]);
      let icon = typeof iconDataUrl === "string" ? electron.nativeImage.createFromDataURL(iconDataUrl) : electron.nativeImage.createEmpty();
      if (icon.isEmpty()) icon = electron.nativeImage.createFromPath(getBundledIconPath()).resize({ width: 32, height: 32 });
      else icon = icon.resize({ width: 32, height: 32, quality: "best" });
      event.sender.startDrag({ files, file: files[0], icon });
      return true;
    });
    electron.ipcMain.handle(IPC.SHELF_PASTE_FROM_CLIPBOARD, () => {
      const paths = readPasteboardFileURLs();
      if (Array.isArray(paths) && paths.length > 0) return coordinator.addShelfPaths(paths);
      const text = electron.clipboard.readText().trim();
      if (!text) return coordinator.getShelfState();
      return coordinator.addShelfPayload({ type: /^https?:\/\//i.test(text) ? "url" : "text", value: text });
    });
    electron.ipcMain.handle(IPC.SHELF_COPY_ITEMS, (_event, { ids } = {}) => {
      const items = resolveShelfItems(coordinator, ids);
      const paths = items.filter((item) => item.path && item.available).map((item) => item.path);
      if (paths.length > 0) return copyFilesToPasteboard(paths);
      const text = items.map((item) => item.value || item.path || "").filter(Boolean).join("\n");
      if (!text) return false;
      electron.clipboard.writeText(text);
      return true;
    });
    electron.ipcMain.handle(IPC.SHELF_SHARE_ITEMS, (event, { ids } = {}) => {
      const paths = resolveShelfItems(coordinator, ids).filter((item) => item.path && item.available).map((item) => item.path);
      if (paths.length === 0) return false;
      const parent = electron.BrowserWindow.fromWebContents(event.sender);
      return Boolean(parent && showFilesSharePicker(parent.getNativeWindowHandle(), paths));
    });
    electron.ipcMain.handle(IPC.SHELF_GET_SHARE_PROVIDERS, () => listShelfShareProviders());
    electron.ipcMain.handle(IPC.SHELF_SET_QUICK_SHARE_PROVIDER, async (_event, { providerId } = {}) => {
      const normalized = typeof providerId === "string" ? providerId.trim().slice(0, 160) : "";
      const providers = await listShelfShareProviders();
      if (!normalized || !providers.some((provider) => provider.id === normalized)) return false;
      coordinator.updateSettings({ shelfQuickShareProvider: normalized }, "island");
      return true;
    });
    electron.ipcMain.handle(IPC.SHELF_SHARE_VIA_DEFAULT, (event, { ids } = {}) => {
      const paths = resolveShelfItems(coordinator, ids).filter((item) => item.path && item.available).map((item) => item.path);
      return sharePathsViaQuickProvider(coordinator, electron.BrowserWindow.fromWebContents(event.sender), paths);
    });
    electron.ipcMain.handle(IPC.SHELF_GET_AIRDROP_ICON, () => getAirDropIconDataUrl());
    electron.ipcMain.handle(IPC.SHELF_SHARE_AIRDROP, (_event, { ids } = {}) => {
      const paths = resolveShelfItems(coordinator, ids).filter((item) => item.path && item.available).map((item) => item.path);
      return paths.length > 0 && shareFilesViaAirDrop(paths);
    });
    electron.ipcMain.handle(IPC.CLIPBOARD_HISTORY_GET_STATE, () => coordinator.getClipboardHistory());
    electron.ipcMain.handle(IPC.CLIPBOARD_HISTORY_REPLAY, (_event, { id } = {}) => coordinator.replayClipboardEntry(String(id || "")));
    electron.ipcMain.handle(IPC.CLIPBOARD_HISTORY_FAVORITE, (_event, { id, favorite } = {}) => coordinator.favoriteClipboardEntry(String(id || ""), Boolean(favorite)));
    electron.ipcMain.handle(IPC.CLIPBOARD_HISTORY_REMOVE, (_event, { ids } = {}) => coordinator.removeClipboardEntries(ids));
    electron.ipcMain.handle(IPC.CLIPBOARD_HISTORY_CLEAR, () => coordinator.clearClipboardHistory());
    electron.ipcMain.handle(IPC.TERMINAL_GET_STATE, () => coordinator.getTerminalState());
    electron.ipcMain.handle(IPC.TERMINAL_START, (_event, options) => coordinator.startTerminal(options));
    electron.ipcMain.handle(IPC.TERMINAL_INPUT, (_event, { data } = {}) => coordinator.sendTerminalInput(data));
    electron.ipcMain.handle(IPC.TERMINAL_RESIZE, (_event, size) => coordinator.resizeTerminal(size));
    electron.ipcMain.handle(IPC.TERMINAL_RESTART, (_event, options) => coordinator.restartTerminal(options));
    electron.ipcMain.handle(IPC.TERMINAL_STOP, () => coordinator.stopTerminal());
    electron.ipcMain.handle(IPC.TERMINAL_RUN_SAVED_COMMAND, (_event, { id } = {}) => coordinator.runSavedTerminalCommand(String(id || "")));
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
    electron.ipcMain.on(IPC.ISLAND_FOCUS_LOSS_HIDE, () => {
      coordinator.hideIslandForFocusLoss();
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
      const requested = fileName || configuredSprite;
      // echo:little 不是雪碧图文件，是渲染层的程序化模式标识。走文件解析必然
      // 失败并落进 Orca 兜底 —— 用户看到的就是「选了 Echo 却出来一条鱼」。
      if (requested === "echo:little") {
        return { echoMode: true };
      }
      const selection = resolveSpriteSelection(requested);
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
  return { registerIpcHandlers, getCustomIconDataUrl, applyDockIcon, sharePathsViaQuickProvider };
}

module.exports = { createIpcServices };
