import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  orderToolboxModules,
  reorderToolboxModules
} = await import("../src/renderer/island/components/productivity-toolbox-model.mjs");
const { mergeSettings, DEFAULT_SETTINGS } = require("../src/shared/settings.cjs");

test("exact toolbar slots persist and reject invalid preferences", () => {
  const slots = { pet: 'right:2', shelf: 'left:0', terminal: 'overflow', 'clear-sessions': 'right:1', usage: -1, unknown: 'left:1' };
  const merged = mergeSettings({ toolbarModuleSlots: slots });
  assert.deepEqual(merged.toolbarModuleSlots, { pet: 'right:2', shelf: 'left:0', terminal: 'overflow', 'clear-sessions': 'right:1' });
  assert.deepEqual(mergeSettings(JSON.parse(JSON.stringify(merged))).toolbarModuleSlots, merged.toolbarModuleSlots);
});

test("orderToolboxModules keeps default order when preference is empty", () => {
  assert.deepEqual(
    orderToolboxModules(["shelf", "clipboard", "terminal"], []),
    ["shelf", "clipboard", "terminal"]
  );
});

test("orderToolboxModules applies user order and appends unknown modules after", () => {
  assert.deepEqual(
    orderToolboxModules(["shelf", "clipboard", "terminal"], ["terminal", "clipboard"]),
    ["terminal", "clipboard", "shelf"]
  );
});

test("orderToolboxModules ignores ids not present among modules", () => {
  assert.deepEqual(
    orderToolboxModules(["clipboard", "terminal"], ["terminal", "shelf", "clipboard"]),
    ["terminal", "clipboard"]
  );
});

test("reorderToolboxModules moves a module left and right", () => {
  const modules = ["shelf", "clipboard", "terminal"];
  assert.deepEqual(reorderToolboxModules(modules, "terminal", "shelf"), ["terminal", "shelf", "clipboard"]);
  assert.deepEqual(reorderToolboxModules(modules, "shelf", "terminal"), ["clipboard", "terminal", "shelf"]);
});

test("reorderToolboxModules is a no-op for unknown or identical ids", () => {
  const modules = ["shelf", "clipboard", "terminal"];
  assert.equal(reorderToolboxModules(modules, "shelf", "shelf"), modules);
  assert.equal(reorderToolboxModules(modules, "nope", "shelf"), modules);
});

test("settings merge sanitizes toolboxModuleOrder", () => {
  const merged = mergeSettings({
    toolboxModuleOrder: ["terminal", "bogus", "terminal", "clipboard", 7, null]
  });
  assert.deepEqual(merged.toolboxModuleOrder, ["terminal", "clipboard"]);
  assert.deepEqual(DEFAULT_SETTINGS.toolboxModuleOrder, []);
  assert.deepEqual(mergeSettings({}).toolboxModuleOrder, []);
});

test("system utilities retain order, bank and overflow preferences across reload", () => {
  const merged = mergeSettings({ toolboxModuleOrder: ['performance','clear-sessions','pet','terminal'],
    toolbarHiddenModules: ['clear-sessions','pet','pet','unknown'],
    toolbarModuleSides: { performance: 'right', 'clear-sessions': 'left', terminal: 'left', pet: 'center', unknown: 'left' }
  });
  assert.deepEqual(merged.toolboxModuleOrder, ['performance','clear-sessions','pet','terminal']);
  assert.deepEqual(merged.toolbarHiddenModules, ['clear-sessions','pet']);
  assert.deepEqual(merged.toolbarModuleSides, { performance: 'right', 'clear-sessions': 'left', terminal: 'left' });
  assert.deepEqual(mergeSettings(merged).toolbarModuleSides, merged.toolbarModuleSides);
});
