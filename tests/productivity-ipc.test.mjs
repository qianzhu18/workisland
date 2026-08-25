import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { IPC } = require("../src/shared/ipc.cjs");
const preload = readFileSync(new URL("../src/preload/island.js", import.meta.url), "utf8");
const coordinator = readFileSync(new URL("../src/main/app-coordinator.cjs", import.meta.url), "utf8");
const handlers = readFileSync(new URL("../src/main/ipc-services.cjs", import.meta.url), "utf8");
const ipcSource = readFileSync(new URL("../src/shared/ipc.cjs", import.meta.url), "utf8");
const windowSource = readFileSync(new URL("../src/main/windows.cjs", import.meta.url), "utf8");
const islandSource = readFileSync(new URL("../src/renderer/island/app.js", import.meta.url), "utf8");
const nativeSource = readFileSync(new URL("../native/panel-fix/src/panel_fix.mm", import.meta.url), "utf8");
const preloadSource = preload;

test("productivity services expose narrow Island IPC contracts", () => {
  for (const key of [
    "SHELF_GET_STATE", "SHELF_STATE_UPDATE", "SHELF_GET_PREVIEW", "SHELF_ADD_PATHS", "SHELF_REMOVE", "SHELF_OPEN", "SHELF_REVEAL", "SHELF_PASTE_FROM_CLIPBOARD", "SHELF_COPY_ITEMS", "SHELF_SHARE_ITEMS", "SHELF_GET_SHARE_PROVIDERS", "SHELF_SET_QUICK_SHARE_PROVIDER", "SHELF_SHARE_VIA_DEFAULT", "SHELF_SHARE_AIRDROP", "SHELF_SHARE_DROP_BOUNDS",
    "CLIPBOARD_HISTORY_GET_STATE", "CLIPBOARD_HISTORY_UPDATE", "CLIPBOARD_HISTORY_REPLAY", "CLIPBOARD_HISTORY_CLEAR",
    "TERMINAL_GET_STATE", "TERMINAL_STATUS_UPDATE", "TERMINAL_DATA", "TERMINAL_START", "TERMINAL_INPUT", "TERMINAL_RESIZE", "TERMINAL_STOP"
  ]) assert.equal(typeof IPC[key], "string", `${key} must exist`);

  for (const method of [
    "getShelfState", "getShelfPreview", "addShelfFiles", "removeShelfItems", "openShelfItem", "revealShelfItem", "pasteShelfFromClipboard", "copyShelfItems", "shareShelfItems", "getShelfShareProviders", "setShelfQuickShareProvider", "shareShelfItemsViaDefault", "shareShelfItemViaAirDrop", "getAirDropIcon", "setShelfShareDropBounds",
    "getClipboardHistory", "replayClipboardEntry", "clearClipboardHistory",
    "getTerminalState", "startTerminal", "sendTerminalInput", "resizeTerminal", "stopTerminal"
  ]) assert.match(preload, new RegExp(`${method}\\(`), `${method} must be exposed`);
  assert.match(preload, /addShelfDrop\(/);
  assert.match(preload, /parseFileUriList/);

  assert.match(coordinator, /new ShelfService/);
  assert.match(coordinator, /new ClipboardHistoryService/);
  assert.match(coordinator, /new TerminalService/);
  assert.match(handlers, /SHELF_ADD_PATHS/);
  assert.match(handlers, /SHELF_PASTE_FROM_CLIPBOARD/);
  assert.match(handlers, /SHELF_COPY_ITEMS/);
  assert.match(handlers, /SHELF_SHARE_ITEMS/);
  assert.match(handlers, /SHELF_SHARE_AIRDROP/);
  assert.match(handlers, /createThumbnailFromPath/);
  assert.match(handlers, /CLIPBOARD_HISTORY_REPLAY/);
  assert.match(handlers, /TERMINAL_INPUT/);
});

test("macOS native bridge provides stable Finder artwork and selectable quick sharing", () => {
  for (const method of ["getFileIconDataUrl", "getShareProviders", "shareFilesViaProvider", "showFilesSharePicker", "copyFilesToPasteboard", "getAirDropIconDataUrl"]) {
    assert.match(nativeSource, new RegExp(method));
  }
  assert.match(nativeSource, /iconForFile:/);
  assert.match(nativeSource, /NSSharingServicePicker/);
  assert.match(nativeSource, /sharingServicesForItems:/);
  assert.match(nativeSource, /canPerformWithItems:/);
  assert.match(nativeSource, /writeObjects:/);
  assert.match(nativeSource, /NSSharingServiceNameSendViaAirDrop/);
  assert.match(handlers, /Notes: "备忘录"/);
  assert.match(handlers, /Shortcuts: "快捷指令"/);
  assert.match(handlers, /startDrag\(\{\s*files/);
  assert.doesNotMatch(handlers, /electron\.app\.getFileIcon/);
});

test("file dragging locks Island mouse input until the renderer reports completion", () => {
  assert.match(ipcSource, /ISLAND_FILE_DRAG_STATE/);
  assert.match(preloadSource, /setFileDragActive/);
  assert.match(windowSource, /fileDropInteraction\.shouldForwardMouseEventsOnLeave\(\)/);
  assert.match(islandSource, /setFileDragActive\?\.\(true\)/);
  assert.match(islandSource, /setFileDragActive\?\.\(false\)/);
});

test("Finder drops use a temporary native macOS drop target", () => {
  assert.match(nativeSource, /WorkIslandFileDropView/);
  assert.match(nativeSource, /performDragOperation:/);
  assert.match(nativeSource, /draggingLocation/);
  assert.match(nativeSource, /NSPasteboardURLReadingFileURLsOnlyKey/);
  assert.match(nativeSource, /setFileDropTarget/);
  assert.match(windowSource, /setFileDropTarget\(/);
  assert.match(ipcSource, /SHELF_NATIVE_DROP_RESULT/);
  assert.match(preloadSource, /onNativeShelfDropResult/);
  assert.match(islandSource, /onNativeShelfDropResult/);
  assert.match(windowSource, /SHELF_SHARE_DROP_BOUNDS/);
  assert.match(windowSource, /isShelfShareDrop/);
});

test("renderer cannot request arbitrary shelf file deletion or arbitrary saved command execution", () => {
  assert.doesNotMatch(preload, /deleteShelfSource/);
  assert.doesNotMatch(preload, /runTerminalCommand\(command/);
});
