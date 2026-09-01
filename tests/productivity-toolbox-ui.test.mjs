import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(`../src/renderer/island/components/${name}`, import.meta.url), "utf8");

test("productivity modules live in the compact top action row", () => {
  const source = read("IslandPanel.js");
  for (const label of ["智能体主页", "文件架", "剪贴板", "终端"]) assert.match(source, new RegExp(label));
  assert.match(source, /toolbox-icon-button/);
  assert.match(source, /aria-pressed/);
  assert.doesNotMatch(source, /ToolboxSwitcher/);
  assert.doesNotMatch(source, /pillFirstRow\.tokenCount[\s\S]*TokenUsage/);
  assert.match(source, /function ShelfToolIcon/);
  assert.match(source, /function ClipboardToolIcon/);
  assert.match(source, /function TerminalToolIcon/);
  for (const glyph of ["▰", "▤", ">_"]) assert.doesNotMatch(source, new RegExp(glyph.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("collapsing a utility uses the configured reopen policy instead of pinning the panel", () => {
  const app = readFileSync(new URL("../src/renderer/island/app.js", import.meta.url), "utf8");
  assert.match(app, /toolboxReopenMode/);
  assert.match(app, /resolveToolboxReopenModule/);
  assert.doesNotMatch(app, /activeModule === "shelf" \|\| activeModule === "clipboard" \|\| activeModule === "terminal"/);
});

test("shelf supports real drag input and reference-only removal", () => {
  const source = read("ShelfPanel.js");
  assert.match(source, /onDragOver/);
  assert.match(source, /addShelfFiles/);
  assert.match(source, /removeShelfItems/);
  assert.match(source, /移除引用/);
  assert.match(source, /pasteShelfFromClipboard/);
  assert.match(source, /shareShelfItemsViaDefault/);
  assert.match(source, /metaKey/);
});

test("shelf presents an Atoll-style share zone and real file previews", () => {
  const source = read("ShelfPanel.js");
  assert.match(source, /shelf-share-zone/);
  assert.match(source, /拖到这里直接使用/);
  assert.match(source, /getShelfPreview/);
  assert.match(source, /shelf-item-preview/);
  assert.match(source, /"aria-label": label/);
  assert.match(source, /title: label/);
  for (const label of ["预览", "在 Finder 中显示", "系统分享", "移除引用"]) {
    assert.match(source, new RegExp(`label: "${label}"`));
  }
});

test("shelf supports native system sharing and Finder-style multi-selection", () => {
  const source = read("ShelfPanel.js");
  for (const term of [
    "系统分享", "copyShelfItems", "shareShelfItems", "selectedIds", "anchorIndex",
    "event.metaKey", "event.shiftKey", 'key === "a"',
    'key === "c"', "已选择"
  ]) assert.match(source, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(source, /startShelfDrag\(dragIds\)/);
  assert.match(source, /is-selected/);
  assert.match(source, /getShelfShareProviders/);
});

test("shelf drop zone executes and switches a persistent default quick-share service", () => {
  const source = read("ShelfPanel.js");
  const app = readFileSync(new URL("../src/renderer/island/app.js", import.meta.url), "utf8");
  for (const term of [
    "getShelfShareProviders", "setShelfQuickShareProvider", "shareShelfItemsViaDefault",
    "默认快速分享", "临时打开系统分享", "shelf-share-provider-menu"
  ]) assert.match(source, new RegExp(term));
  assert.match(app, /shareShelfItemsViaDefault/);
});

test("dragging files out of the shelf never acquires the Finder drop-in lock", () => {
  const source = read("ShelfPanel.js");
  assert.match(source, /startShelfDrag\(dragIds\)/);
  assert.doesNotMatch(source, /setFileDragActive/);
});

test("starting a native shelf drag cancels Chromium's competing HTML drag session", () => {
  const source = read("ShelfPanel.js");
  assert.match(source, /onDragStart:\s*\(event\)\s*=>\s*\{[\s\S]*?event\.preventDefault\(\);[\s\S]*?startShelfDrag\(dragIds\)/);
});

test("clipboard exposes search favorites replay and clear", () => {
  const source = read("ClipboardPanel.js");
  for (const term of ["搜索剪贴板", "replayClipboardEntry", "favoriteClipboardEntry", "clearClipboardHistory"]) assert.match(source, new RegExp(term));
  assert.match(source, /已复制/);
  assert.match(source, /"已复制" : "复制"/);
});

test("terminal uses xterm and offers quick commands plus full shell", () => {
  const source = read("TerminalPanel.js");
  assert.match(source, /@xterm\/xterm/);
  assert.match(source, /进入完整终端/);
  assert.match(source, /runSavedTerminalCommand/);
  assert.match(source, /sendTerminalInput/);
  assert.match(source, /setTerminalInteractive\?\.\(true\)/);
  assert.match(source, /setTerminalInteractive\?\.\(false\)/);
});

test("terminal quick commands come only from user settings", () => {
  const source = read("TerminalPanel.js");
  assert.doesNotMatch(source, /QUICK_COMMANDS/);
  assert.match(source, /尚未添加快捷命令/);
  assert.match(source, /前往设置添加/);
});

test("Island panel receives every productivity setting from the renderer", () => {
  const source = read("IslandPanel.js");
  assert.match(source, /function IslandPanel\(\{[\s\S]*fileShelfEnabled[\s\S]*clipboardHistoryEnabled[\s\S]*terminalEnabled[\s\S]*terminalSavedCommands[\s\S]*requestedToolboxModule/);
});

test("collapsed Island accepts file drops and opens the file shelf", () => {
  const app = readFileSync(new URL("../src/renderer/island/app.js", import.meta.url), "utf8");
  assert.match(app, /fileDropLatest/);
  assert.match(app, /addEventListener\("drop", onDrop, true\)/);
  assert.match(app, /setPillFileDragActive\(false\);[\s\S]*addShelfDrop/);
  assert.match(app, /dragExitTimer/);
  assert.match(app, /addShelfDrop/);
  assert.match(app, /workisland:shelf-drop-result/);
  assert.match(app, /requestedToolboxModule/);
});

test("shelf clears its drag border after the global drop receiver finishes", () => {
  const source = read("ShelfPanel.js");
  assert.match(source, /workisland:shelf-drop-result/);
  assert.match(source, /setDragging\(false\)/);
});
