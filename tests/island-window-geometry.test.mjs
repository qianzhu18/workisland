import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { createWindowClasses } = require("../src/main/windows.cjs");

function createIslandWindow(screenInfo) {
  const calls = [];
  class FakeBrowserWindow {
    isDestroyed() { return false; }
    getSize() { return [740, 750]; }
    getNativeWindowHandle() { return Buffer.alloc(8); }
    setSize(...args) { calls.push(["setSize", ...args]); }
    setOpacity(...args) { calls.push(["setOpacity", ...args]); }
    setIgnoreMouseEvents(...args) { calls.push(["setIgnoreMouseEvents", ...args]); }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    loadFile() {}
    show() {}
    on() {}
    webContents = {
      on() {},
      send() {}
    };
  }
  const ipcMain = { on() {}, removeListener() {} };
  const { IslandWindow } = createWindowClasses({
    electron: { BrowserWindow: FakeBrowserWindow, ipcMain, screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }) } },
    path: { join: () => "" },
    utils: { is: { dev: false } },
    IPC: {},
    fixPanel() {},
    fixPetWindow() {},
    setWindowCornerRadius() {},
    setFileDropTarget() {},
    log: { debug() {}, warn() {}, error() {} },
    isVisibleInIsland: () => false,
    getIsQuitting: () => false
  });
  const target = {
    display: { id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 0, width: 1512, height: 982 } },
    screenInfo: { hasNotch: false, notchHeight: 0, notchWidth: 0, menuBarHeight: 0, label: "Built-in Display", ...screenInfo }
  };
  const window = new IslandWindow(target, {});
  window.dropProximityTimer = {};
  return { window, calls };
}

function assertIntegerDimension(value) {
  assert.ok(Number.isInteger(value) && value > 0, `expected a positive integer, received ${String(value)}`);
}

test("collapsed window dimensions stay valid Electron integers across display geometries", () => {
  const geometries = [
    { hasNotch: true, notchHeight: 37.5, menuBarHeight: 37.5 },
    { hasNotch: true, notchHeight: NaN, menuBarHeight: 24 },
    { hasNotch: true, notchHeight: undefined, menuBarHeight: 24 },
    { hasNotch: false, menuBarHeight: 24.5 },
    { hasNotch: false, menuBarHeight: Infinity },
    { hasNotch: false, menuBarHeight: 0 }
  ];
  for (const screenInfo of geometries) {
    const { window, calls } = createIslandWindow(screenInfo);
    assertIntegerDimension(window.getClosedHeight());
    window.applyClosedWindowTarget("visible-pill");
    for (const [, width, height] of calls.filter(([name]) => name === "setSize")) {
      assertIntegerDimension(width);
      assertIntegerDimension(height);
    }
    window.applyRequestedHeight(37.5);
    assertIntegerDimension(window.requestedHeight);
    for (const [, width, height] of calls.filter(([name]) => name === "setSize")) {
      assertIntegerDimension(width);
      assertIntegerDimension(height);
    }
  }
});

test("docked bounds stay integer when the built-in display reports fractional points", () => {
  const { DOCK, dockGeometry, pillSize } = require("../src/main/island-dock.cjs");
  const display = {
    bounds: { x: 0.5, y: 0.5, width: 1512.5, height: 982.5 },
    workArea: { x: 0.5, y: 24.5, width: 1512.5, height: 958 }
  };
  for (const edge of ["top", "left", "right"]) {
    for (const offset of [0, 0.25, 0.5, 0.9, 1]) {
      const { bounds } = dockGeometry(display, edge, offset, pillSize({ hasNotch: true, notchHeight: 37.5 }));
      for (const key of ["x", "y", "width", "height"]) {
        assert.ok(Number.isInteger(bounds[key]), `${edge}@${offset} ${key} must be an integer`);
      }
    }
  }
  assert.equal(DOCK.SQUARE, 56);
});
