import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { IPC } = require("../src/shared/ipc.cjs");
const preload = readFileSync(new URL("../src/preload/island.js", import.meta.url), "utf8");
const coordinator = readFileSync(new URL("../src/main/app-coordinator.cjs", import.meta.url), "utf8");
const handlers = readFileSync(new URL("../src/main/ipc-services.cjs", import.meta.url), "utf8");

test("productivity services expose narrow Island IPC contracts", () => {
  for (const key of [
    "SHELF_GET_STATE", "SHELF_STATE_UPDATE", "SHELF_ADD_PATHS", "SHELF_REMOVE", "SHELF_OPEN", "SHELF_REVEAL",
    "CLIPBOARD_HISTORY_GET_STATE", "CLIPBOARD_HISTORY_UPDATE", "CLIPBOARD_HISTORY_REPLAY", "CLIPBOARD_HISTORY_CLEAR",
    "TERMINAL_GET_STATE", "TERMINAL_STATUS_UPDATE", "TERMINAL_DATA", "TERMINAL_START", "TERMINAL_INPUT", "TERMINAL_RESIZE", "TERMINAL_STOP"
  ]) assert.equal(typeof IPC[key], "string", `${key} must exist`);

  for (const method of [
    "getShelfState", "addShelfFiles", "removeShelfItems", "openShelfItem", "revealShelfItem",
    "getClipboardHistory", "replayClipboardEntry", "clearClipboardHistory",
    "getTerminalState", "startTerminal", "sendTerminalInput", "resizeTerminal", "stopTerminal"
  ]) assert.match(preload, new RegExp(`${method}\\(`), `${method} must be exposed`);

  assert.match(coordinator, /new ShelfService/);
  assert.match(coordinator, /new ClipboardHistoryService/);
  assert.match(coordinator, /new TerminalService/);
  assert.match(handlers, /SHELF_ADD_PATHS/);
  assert.match(handlers, /CLIPBOARD_HISTORY_REPLAY/);
  assert.match(handlers, /TERMINAL_INPUT/);
});

test("renderer cannot request arbitrary shelf file deletion or arbitrary saved command execution", () => {
  assert.doesNotMatch(preload, /deleteShelfSource/);
  assert.doesNotMatch(preload, /runTerminalCommand\(command/);
});
