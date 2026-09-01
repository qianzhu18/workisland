import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const registered = new Map();
const electronId = require.resolve("electron");
require.cache[electronId] = {
  id: electronId,
  filename: electronId,
  loaded: true,
  exports: {
    globalShortcut: {
      register(accelerator, handler) {
        if (registered.has(accelerator)) return false;
        registered.set(accelerator, handler);
        return true;
      },
      unregister(accelerator) {
        registered.delete(accelerator);
      }
    }
  }
};

const { ShortcutService } = require("../src/main/shortcut-service.cjs");

function shortcutConfig() {
  return {
    modifiers: ["Ctrl"],
    bindings: {
      toggleIsland: { key: "I", enabled: true },
      collapsePanel: { key: "Esc", enabled: true },
      approve: { key: "Y", enabled: false },
      reject: { key: "N", enabled: false },
      allowAlways: { key: "A", enabled: false },
      jumpToTerminal: { key: "J", enabled: false },
      switchSession: { key: "S", enabled: true }
    }
  };
}

function createService() {
  registered.clear();
  return new ShortcutService({
    toggleIsland() {},
    collapsePanel() {},
    switchSessionUp() {},
    switchSessionDown() {},
    confirmSession() {}
  });
}

test("interactive terminal owns Escape and session navigation keys until it closes", () => {
  const service = createService();
  service.setConfig(shortcutConfig());
  service.setPanelExpanded(true);
  service.armConfirm();

  for (const key of ["Esc", "Up", "Down", "Return"]) {
    assert.equal(registered.has(key), true, `${key} should begin as an Island shortcut`);
  }

  service.setTerminalInteractive(true);

  for (const key of ["Esc", "Up", "Down", "Return"]) {
    assert.equal(registered.has(key), false, `${key} must be delivered to xterm`);
  }
  assert.equal(registered.has("Control+I"), true, "persistent Island toggle remains available");

  service.setTerminalInteractive(false);

  for (const key of ["Esc", "Up", "Down", "Return"]) {
    assert.equal(registered.has(key), true, `${key} should return after leaving the terminal`);
  }
});

test("collapsing the panel clears stale terminal-interactive state", () => {
  const service = createService();
  service.setConfig(shortcutConfig());
  service.setPanelExpanded(true);
  service.setTerminalInteractive(true);
  service.setPanelExpanded(false);

  service.setPanelExpanded(true);

  assert.equal(registered.has("Esc"), true);
  assert.equal(registered.has("Up"), true);
  assert.equal(registered.has("Down"), true);
});
