import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DOCK, pillSize, dockGeometry, nearestEdge, createDockableIslandWindow, attachIslandDock } = require("../src/main/island-dock.cjs");
const { IPC } = require("../src/shared/ipc.cjs");

// ── 纯几何 ───────────────────────────────────────────────────────────────────
const DISPLAYS = [
  { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 875 } },
  { id: 2, bounds: { x: 1440, y: -200, width: 2560, height: 1440 }, workArea: { x: 1440, y: -175, width: 2560, height: 1345 } },
  { id: 3, bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, workArea: { x: -1920, y: 25, width: 1920, height: 990 } }
];

const NO_NOTCH = { hasNotch: false, menuBarHeight: 25 };
const NOTCH = { hasNotch: true, notchHeight: 32, notchWidth: 200, menuBarHeight: 32 };
const PILL = pillSize(NO_NOTCH);

test("dock geometry keeps the window inside the display and the strip inside the window", () => {
  for (const d of DISPLAYS) {
    for (const edge of ["top", "left", "right"]) {
      for (const offset of [0, 0.1, 0.25, 0.5, 0.9, 1]) {
        const { bounds, strip } = dockGeometry(d, edge, offset, PILL);
        const b = d.bounds;
        assert.ok(bounds.x >= b.x && bounds.x + bounds.width <= b.x + b.width, `${edge}@${offset} x in display`);
        assert.ok(bounds.y >= b.y && bounds.y + bounds.height <= b.y + b.height, `${edge}@${offset} y in display`);
        const span = edge === "top" ? bounds.width : bounds.height;
        assert.ok(strip.spanOffset >= 0 && strip.spanOffset + strip.len <= span, `${edge}@${offset} strip in window`);
        assert.equal(strip.len, PILL.len, "every edge uses the pill length");
        assert.equal(strip.depth, PILL.depth, "every edge uses the pill thickness");
        if (edge === "top") {
          assert.equal(bounds.y, b.y, "top dock is flush with the display top");
        } else {
          const wa = d.workArea;
          assert.equal(edge === "left" ? bounds.x : bounds.x + bounds.width, edge === "left" ? wa.x : wa.x + wa.width, "side dock is flush with the work area edge");
          assert.ok(bounds.y >= wa.y && bounds.y + bounds.height <= wa.y + wa.height, "side dock stays inside the work area");
        }
      }
    }
  }
});

test("the docked strip is exactly the notch pill, so switching placement never resizes it", () => {
  // 无刘海屏：菜单栏高 25，收起态胶囊 126 + 72
  assert.deepEqual(pillSize(NO_NOTCH), { len: 198, depth: 25 });
  // 有刘海屏：厚度取刘海高度，长度取刘海宽度 + 62
  assert.deepEqual(pillSize(NOTCH), { len: 262, depth: 32 });
  // 三条边共用同一组尺寸 —— 顶部是它，侧边是它转 90°
  const d = DISPLAYS[0];
  const top = dockGeometry(d, "top", 0.5, PILL).strip;
  const left = dockGeometry(d, "left", 0.5, PILL).strip;
  const right = dockGeometry(d, "right", 0.5, PILL).strip;
  assert.deepEqual([top.len, top.depth], [left.len, left.depth]);
  assert.deepEqual([left.len, left.depth], [right.len, right.depth]);
});

test("pillSize falls back to sane numbers when screen info is missing", () => {
  const fallback = pillSize(undefined);
  assert.ok(fallback.len > 0 && fallback.depth > 0);
  assert.equal(pillSize({ hasNotch: false, menuBarHeight: 0 }).depth, 24, "no menu bar → the renderer's 24pt fallback");
  assert.equal(pillSize({ hasNotch: false, menuBarHeight: 99 }).depth, 24, "an absurd menu bar height is ignored");
});

test("nearestEdge never picks the bottom and reports a 0-1 offset", () => {
  const wa = { x: 0, y: 25, width: 1440, height: 875 };
  const sq = (x, y) => ({ x, y, width: 56, height: 56 });
  assert.equal(nearestEdge(wa, sq(700, 30)).edge, "top");
  assert.equal(nearestEdge(wa, sq(10, 450)).edge, "left");
  assert.equal(nearestEdge(wa, sq(1380, 450)).edge, "right");
  // 紧贴底部：离底边最近，但底部不在候选里，落到左右中更近的那个
  const bottom = nearestEdge(wa, sq(300, 860));
  assert.notEqual(bottom.edge, "bottom");
  assert.equal(bottom.edge, "left");
  for (const r of [sq(-100, -100), sq(5000, 5000), sq(700, 450)]) {
    const { offset } = nearestEdge(wa, r);
    assert.ok(offset >= 0 && offset <= 1);
  }
});

// ── 子类：notch 下对基类零干扰，docked 下接管 ────────────────────────────────
const harnessScreenInfo = { hasNotch: false, menuBarHeight: 25 };
function makeHarness({ initialPlacement } = {}) {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  const win = {
    destroyed: false,
    size: [740, 750],
    pos: [350, 0],
    isDestroyed() { return this.destroyed; },
    getSize() { return this.size.slice(); },
    getPosition() { return this.pos.slice(); },
    setBounds(b) { calls.push(["win.setBounds", b]); this.size = [b.width, b.height]; this.pos = [b.x, b.y]; },
    setSize(w, h) { calls.push(["win.setSize", w, h]); this.size = [w, h]; },
    setPosition(x, y) { calls.push(["win.setPosition", x, y]); this.pos = [x, y]; },
    setOpacity: record("win.setOpacity"),
    setIgnoreMouseEvents: record("win.setIgnoreMouseEvents"),
    getNativeWindowHandle: () => "handle",
    webContents: { send: record("wc.send"), on: record("wc.on") },
    on: record("win.on")
  };
  const baseCalls = [];
  class BaseIslandWindow {
    requestedHeight = 750;
    isPanelExpanded = false;
    _isFullscreenHidden = false;
    _isFocusHidden = false;
    isHoverRevealedWhileFullscreenHidden = false;
    shouldConcealAfterCloseAnimation = false;
    constructor(target) {
      this.win = win;
      this.currentTarget = target;
    }
    setFullscreenHidden(h) { baseCalls.push(["setFullscreenHidden", h]); }
    setFocusHidden(h) { baseCalls.push(["setFocusHidden", h]); }
    applyRequestedHeight(h) { baseCalls.push(["applyRequestedHeight", h]); this.win.setSize(this.win.getSize()[0], h); }
    applyClosedWindowTarget(t, o) { baseCalls.push(["applyClosedWindowTarget", t, o]); }
    syncWindowToCurrentState() { baseCalls.push(["syncWindowToCurrentState"]); }
    getClosedHeight() { return 32; }
    send(ch, payload) { this.win.webContents.send(ch, payload); }
  }
  const listeners = new Map();
  const handlers = new Map();
  const electron = {
    ipcMain: {
      on: (ch, fn) => listeners.set(ch, fn),
      removeListener: (ch) => listeners.delete(ch),
      handle: (ch, fn) => { if (handlers.has(ch)) throw new Error("double handler"); handlers.set(ch, fn); },
      removeHandler: (ch) => handlers.delete(ch)
    },
    screen: {
      cursor: { x: 500, y: 300 },
      getCursorScreenPoint() { return { ...this.cursor }; },
      getDisplayMatching: () => DISPLAYS[0]
    }
  };
  const fixPanelCalls = [];
  const Dockable = createDockableIslandWindow(BaseIslandWindow, {
    electron,
    IPC,
    log: null,
    fixPanel: (...a) => fixPanelCalls.push(a)
  });
  const target = { display: DISPLAYS[0], screenInfo: harnessScreenInfo };
  const iw = new Dockable(target, {});
  if (initialPlacement) iw.setPlacement(initialPlacement.placement, initialPlacement.dock);
  return { iw, win, calls, baseCalls, electron, listeners, handlers, fixPanelCalls };
}

test("in notch placement every override forwards to the base class untouched", () => {
  const { iw, calls, baseCalls, win } = makeHarness();
  calls.length = 0;
  assert.equal(iw.isDocked, false);
  assert.deepEqual(iw.dockState(), { placement: "notch", edge: "right", mode: "notch" });
  iw.setFullscreenHidden(true);
  iw.setFocusHidden(true);
  iw.applyRequestedHeight(400);
  iw.applyClosedWindowTarget("hidden-hotspot", { interactive: true });
  iw.syncWindowToCurrentState();
  assert.deepEqual(baseCalls, [
    ["setFullscreenHidden", true],
    ["setFocusHidden", true],
    ["applyRequestedHeight", 400],
    ["applyClosedWindowTarget", "hidden-hotspot", { interactive: true }],
    ["syncWindowToCurrentState"]
  ]);
  // 子类自己没碰窗口：唯一的 setSize 来自基类的 applyRequestedHeight
  assert.deepEqual(calls.filter(([n]) => n.startsWith("win.")), [["win.setSize", 740, 400]]);
  assert.deepEqual(win.size, [740, 400]);
});

test("docked placement takes over: hide calls are swallowed, height is only recorded, window sits on the edge", () => {
  const { iw, calls, baseCalls, win } = makeHarness({ initialPlacement: { placement: "docked", dock: { edge: "left", offset: 0.5 } } });
  const expected = dockGeometry(DISPLAYS[0], "left", 0.5, pillSize(harnessScreenInfo));
  assert.deepEqual(win.size, [expected.bounds.width, expected.bounds.height]);
  assert.deepEqual(win.pos, [expected.bounds.x, expected.bounds.y]);
  calls.length = 0;
  baseCalls.length = 0;
  iw.setFullscreenHidden(true);
  iw.setFocusHidden(true);
  iw.applyRequestedHeight(400);
  iw.applyClosedWindowTarget("hidden-hotspot");
  assert.deepEqual(baseCalls, [], "base hide/height/close paths must not run while docked");
  assert.equal(iw.requestedHeight, 400);
  assert.deepEqual(win.size, [expected.bounds.width, expected.bounds.height], "window size is fixed while docked");
  // 收起 = 可见 + 穿透
  assert.deepEqual(calls.filter(([n]) => n === "win.setOpacity").at(-1), ["win.setOpacity", 1]);
  assert.deepEqual(calls.filter(([n]) => n === "win.setIgnoreMouseEvents").at(-1), ["win.setIgnoreMouseEvents", true, { forward: true }]);
  const state = iw.dockState();
  assert.equal(state.placement, "docked");
  assert.equal(state.edge, "left");
  assert.equal(state.mode, "strip");
  assert.deepEqual(state.strip, expected.strip);
});

test("syncWindowToCurrentState re-applies dock bounds (fixPanel may have thrown the window to the top)", () => {
  const { iw, win, baseCalls } = makeHarness({ initialPlacement: { placement: "docked", dock: { edge: "right", offset: 0.3 } } });
  win.setBounds({ x: 350, y: 0, width: 740, height: 32 }); // 模拟 fixPanel 把窗口甩回顶部
  baseCalls.length = 0;
  iw.syncWindowToCurrentState();
  const expected = dockGeometry(DISPLAYS[0], "right", 0.3, pillSize(harnessScreenInfo)).bounds;
  assert.deepEqual(win.pos, [expected.x, expected.y]);
  assert.deepEqual(win.size, [expected.width, expected.height]);
  assert.deepEqual(baseCalls, [["syncWindowToCurrentState"]], "still lets the base finish its own bookkeeping");
});

test("switching back to notch restores the original window size before handing geometry to the base", () => {
  const { iw, win, baseCalls, fixPanelCalls } = makeHarness({ initialPlacement: { placement: "docked", dock: { edge: "left", offset: 0.5 } } });
  assert.notDeepEqual(win.size, [740, 750]);
  baseCalls.length = 0;
  iw.setPlacement("notch");
  assert.equal(iw.isDocked, false);
  assert.equal(win.size[0], 740, "notch width restored");
  assert.equal(fixPanelCalls.length, 1, "fixPanel re-run to re-anchor at the top");
  assert.deepEqual(baseCalls, [["applyRequestedHeight", 32]], "base geometry takes over again");
  assert.deepEqual(iw.dockState(), { placement: "notch", edge: "left", mode: "notch" });
});

test("drag: press shrinks to a square under the cursor, release snaps to the nearest edge and reports it", () => {
  const { iw, win, electron, listeners } = makeHarness({ initialPlacement: { placement: "docked", dock: { edge: "right", offset: 0.25 } } });
  const reported = [];
  iw.onDockChange = (d) => reported.push(d);
  const event = { sender: win.webContents };
  electron.screen.cursor = { x: 100, y: 400 };
  listeners.get(IPC.ISLAND_DRAG_START)(event);
  assert.equal(iw.dockState().mode, "dragging");
  assert.deepEqual(win.size, [DOCK.SQUARE, DOCK.SQUARE]);
  assert.deepEqual(win.pos, [100 - DOCK.SQUARE / 2, 400 - DOCK.SQUARE / 2]);
  listeners.get(IPC.ISLAND_DRAG_END)(event);
  assert.equal(iw.dockState().mode, "strip");
  assert.equal(iw.dockState().edge, "left");
  assert.equal(reported.length, 1);
  assert.equal(reported[0].edge, "left");
  assert.ok(reported[0].offset > 0 && reported[0].offset < 1);
  const expected = dockGeometry(DISPLAYS[0], "left", reported[0].offset, pillSize(harnessScreenInfo)).bounds;
  assert.deepEqual(win.pos, [expected.x, expected.y]);
  iw.stopDragFollow();
});

test("drag IPC from another window is ignored and notch placement never starts a drag", () => {
  const { iw, win, listeners } = makeHarness({ initialPlacement: { placement: "docked", dock: { edge: "right", offset: 0.25 } } });
  listeners.get(IPC.ISLAND_DRAG_START)({ sender: {} });
  assert.equal(iw.dockState().mode, "strip");
  iw.setPlacement("notch");
  listeners.get(IPC.ISLAND_DRAG_START)({ sender: win.webContents });
  assert.equal(iw.dockState().mode, "notch");
  assert.equal(iw._dockDragging, false);
});

test("get-placement handler returns the full dock state and dispose removes every hook", () => {
  const { iw, handlers, listeners, win } = makeHarness({ initialPlacement: { placement: "docked", dock: { edge: "top", offset: 0.5 } } });
  const state = handlers.get(IPC.ISLAND_GET_PLACEMENT)();
  assert.equal(state.placement, "docked");
  assert.equal(state.edge, "top");
  assert.ok(state.strip, "strip geometry must travel with the state (renderer draws from it)");
  iw.disposeDock();
  assert.equal(handlers.size, 0);
  for (const ch of [IPC.ISLAND_DRAG_START, IPC.ISLAND_DRAG_END, IPC.ISLAND_PANEL_EXPANDED, IPC.ISLAND_PANEL_COLLAPSED]) {
    assert.equal(listeners.has(ch), false, `${ch} removed`);
  }
});

test("attachIslandDock: notch settings never call setPlacement; docked applies once and writes position back", () => {
  const made = [];
  const iw = { setPlacement: (...a) => made.push(a), onDockChange: null };
  const updates = [];
  const coordinator = {
    settings: { islandPlacement: "notch", islandDock: { edge: "right", offset: 0.25 } },
    getSettings() { return this.settings; },
    updateSettings(partial, source) { updates.push([partial, source]); this.settings = { ...this.settings, ...partial }; }
  };
  const dock = attachIslandDock(iw, coordinator, null);
  assert.deepEqual(made, [], "default placement must not touch the window at all");
  dock.applySettings({ islandPlacement: "notch" });
  assert.deepEqual(made, []);
  dock.applySettings({ islandPlacement: "docked", islandDock: { edge: "left", offset: 0.4 } });
  assert.deepEqual(made, [["docked", { edge: "left", offset: 0.4 }]]);
  dock.applySettings({ islandPlacement: "docked", islandDock: { edge: "left", offset: 0.4 } });
  assert.equal(made.length, 1, "same placement again is a no-op");
  iw.onDockChange({ edge: "top", offset: 0.7 });
  assert.deepEqual(updates, [[{ islandDock: { edge: "top", offset: 0.7 } }, "island"]]);
  dock.applySettings({ islandPlacement: "notch" });
  assert.deepEqual(made.at(-1), ["notch", undefined]);
  assert.equal(attachIslandDock({}, coordinator, null), null, "a plain IslandWindow (no add-on) is left alone");
});
