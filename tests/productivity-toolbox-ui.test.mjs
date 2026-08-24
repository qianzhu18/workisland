import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(`../src/renderer/island/components/${name}`, import.meta.url), "utf8");

test("toolbox switcher labels every user-visible module", () => {
  const source = read("ToolboxSwitcher.js");
  for (const label of ["Agent", "文件架", "剪贴板", "终端"]) assert.match(source, new RegExp(label));
  assert.match(source, /aria-pressed/);
});

test("shelf supports real drag input and reference-only removal", () => {
  const source = read("ShelfPanel.js");
  assert.match(source, /onDragOver/);
  assert.match(source, /addShelfFiles/);
  assert.match(source, /removeShelfItems/);
  assert.match(source, /移除引用/);
});

test("clipboard exposes search favorites replay and clear", () => {
  const source = read("ClipboardPanel.js");
  for (const term of ["搜索剪贴板", "replayClipboardEntry", "favoriteClipboardEntry", "clearClipboardHistory"]) assert.match(source, new RegExp(term));
});

test("terminal uses xterm and offers quick commands plus full shell", () => {
  const source = read("TerminalPanel.js");
  assert.match(source, /@xterm\/xterm/);
  assert.match(source, /进入完整终端/);
  assert.match(source, /runSavedTerminalCommand/);
  assert.match(source, /sendTerminalInput/);
});

test("Island panel receives every productivity setting from the renderer", () => {
  const source = read("IslandPanel.js");
  assert.match(source, /function IslandPanel\(\{[\s\S]*fileShelfEnabled[\s\S]*clipboardHistoryEnabled[\s\S]*terminalEnabled[\s\S]*terminalSavedCommands[\s\S]*requestedToolboxModule/);
});

test("collapsed Island accepts file drops and opens the file shelf", () => {
  const app = readFileSync(new URL("../src/renderer/island/app.js", import.meta.url), "utf8");
  assert.match(app, /onPillFileDrop/);
  assert.match(app, /addShelfFiles/);
  assert.match(app, /requestedToolboxModule/);
});
