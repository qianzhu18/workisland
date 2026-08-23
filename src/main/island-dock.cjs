"use strict";
/**
 * 贴边（dock）落位 —— IslandWindow 的可选附件。
 *
 * 设计约束：对主代码零侵入。
 *   - 以子类形式叠在 IslandWindow 上，只覆写少数几个方法，不改基类一行；
 *   - islandPlacement = "notch"（默认）时，每个覆写都原样转给基类：行为与
 *     没装这个附件时完全一致（tests/island-dock-addon.test.mjs 守着这一点）；
 *   - 只有设置切到 "docked" 才接管窗口几何与鼠标策略。
 *
 * 落位模型：
 *   - 主进程是唯一状态源 {placement, edge, mode, strip}，窗口尺寸与渲染层形状都由它推导；
 *     分开各算各的正是此前「找不到 / 长条 / 竖侧边栏」的共同成因；
 *   - 贴边期间窗口**固定为面板大小**（贴边锚定），条↔面板的切换全部交给渲染层的
 *     clip-path 形变 —— 和刘海模式同构，所以一样丝滑；
 *   - 窗口 bounds 只在拖动（小方块跟手）和吸附换边时变化。
 */

// 条的几何来自刘海胶囊本身：厚度 = 胶囊高度，长度 = 胶囊宽度。
// 贴边条就是那颗胶囊换了个位置，而不是另一个尺寸的新控件 —— 从刘海切到贴边时
// 大小不变，三条边也彼此一致。STRIP_* 只是取不到屏幕信息时的兜底。
const DOCK = Object.freeze({
  SQUARE: 56,          // 拖动中的小方块
  STRIP_DEPTH: 25,     // 兜底厚度（≈菜单栏高度）
  STRIP_LEN: 198,      // 兜底长度（≈无刘海屏的收起态胶囊宽度）
  VPANEL_W: 380,       // 侧边展开的竖长面板
  VPANEL_H: 560,
  TOP_WINDOW_H: 620,   // 顶部贴边时的窗口高度（面板向下展开的空间）
  HPANEL_W: 740,       // 顶部展开的横向面板
  DRAG_POLL_MS: 16,
  DRAG_MAX_MS: 15e3    // mouseup 丢失时的安全上限
});

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * 收起态胶囊的尺寸，直接照搬刘海模式的算法。
 * 贴边条沿用它，切换落位时大小不会跳变。
 * 渲染层的胶囊会随会话相位继续变长（要放标题和计时）；贴边条不显示文字，
 * 固定在空闲态那一档即可。
 */
function pillSize(screenInfo) {
  const info = screenInfo ?? {};
  const menuBarHeight = Number(info.menuBarHeight) || 0;
  const depth = info.hasNotch
    ? Number(info.notchHeight) || DOCK.STRIP_DEPTH
    : menuBarHeight > 0 && menuBarHeight < 40 ? menuBarHeight : 24;
  const notchWidth = info.hasNotch ? Number(info.notchWidth) || 126 : 126;
  // 与渲染层空闲态一致：本体宽度 + 两侧留白（有刘海 62，无刘海 72）
  const len = Math.max(notchWidth, 126) + (info.hasNotch ? 62 : 72);
  return { len: Math.round(len) || DOCK.STRIP_LEN, depth: Math.max(1, Math.round(depth)) };
}

/**
 * 贴边几何（纯函数，便于测试）。
 * @param strip 条的尺寸 {len, depth}，由 pillSize() 从屏幕信息推出
 * @returns {{bounds:{x,y,width,height}, strip:{spanOffset,len,depth}}}
 *   bounds 是窗口矩形；strip 是收起态条形在窗口内沿边方向的起点/长度/厚度。
 */
function dockGeometry(display, edge, offset, strip) {
  const b = display.bounds;
  const wa = display.workArea ?? b;
  const len = strip?.len ?? DOCK.STRIP_LEN;
  const depth = strip?.depth ?? DOCK.STRIP_DEPTH;
  if (edge === "top") {
    const w = DOCK.HPANEL_W;
    const winX = Math.max(b.x, Math.min(b.x + Math.round((b.width - w) * offset), b.x + b.width - w));
    const stripX = Math.max(b.x, Math.min(b.x + Math.round((b.width - len) * offset), b.x + b.width - len));
    return {
      bounds: { x: winX, y: b.y, width: w, height: DOCK.TOP_WINDOW_H },
      strip: { spanOffset: stripX - winX, len, depth }
    };
  }
  const w = DOCK.VPANEL_W;
  const h = DOCK.VPANEL_H;
  const stripCenter = wa.y + offset * wa.height;
  const stripTop = Math.max(wa.y, Math.min(Math.round(stripCenter - len / 2), wa.y + wa.height - len));
  const winY = Math.max(wa.y, Math.min(stripTop, wa.y + wa.height - h));
  const x = edge === "left" ? wa.x : wa.x + wa.width - w;
  return {
    bounds: { x, y: winY, width: w, height: h },
    strip: { spanOffset: stripTop - winY, len, depth }
  };
}

/** 松手时该吸到哪条边（上/左/右，不含底部），以及沿边位置的 0-1 比例。 */
function nearestEdge(workArea, rect) {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dTop = cy - workArea.y;
  const dLeft = cx - workArea.x;
  const dRight = workArea.x + workArea.width - cx;
  const nearest = Math.min(dTop, dLeft, dRight);
  const edge = nearest === dTop ? "top" : nearest === dLeft ? "left" : "right";
  const offset = edge === "top"
    ? clamp01((cx - workArea.x) / Math.max(1, workArea.width))
    : clamp01((cy - workArea.y) / Math.max(1, workArea.height));
  return { edge, offset };
}

/**
 * 用贴边能力包装 IslandWindow。
 * @param BaseIslandWindow createWindowClasses() 返回的 IslandWindow
 * @param deps { electron, IPC, log, fixPanel }
 */
function createDockableIslandWindow(BaseIslandWindow, deps) {
  const { electron, IPC, log, fixPanel } = deps;
  const noop = () => {};
  const logger = { info: log?.info ?? noop, warn: log?.warn ?? noop, debug: log?.debug ?? noop };

  class DockableIslandWindow extends BaseIslandWindow {
    _placement = "notch";
    _dockEdge = "right";       // "top" | "left" | "right"
    _dockOffset = 0.25;        // 沿边位置的 0-1 比例，跨分辨率仍成立
    _dockDragging = false;
    _dragTimer = null;
    _dragOrigin = null;
    // 渲染层是否处于展开态。只由渲染层的 PANEL_EXPANDED/COLLAPSED 上报驱动，
    // 不用基类的 isPanelExpanded —— 后者会被隐藏路径提前置 false。
    _rendererExpanded = false;
    // 刘海形态下的窗口尺寸，切回 notch 时原样归还。
    _notchSize = null;
    /** 拖动吸附完成后的回调：{edge, offset}，由安装方写回设置。 */
    onDockChange = null;

    constructor(target, options) {
      super(target, options);
      this._notchSize = this.win.getSize();
      this._onDragStart = (event) => {
        if (!this.isDocked || this.win.isDestroyed() || event.sender !== this.win.webContents) return;
        this.beginDrag();
      };
      this._onDragEnd = (event) => {
        if (this.win.isDestroyed() || event.sender !== this.win.webContents) return;
        this.stopDragFollow();
        if (!this.isDocked) return;
        this._dragOrigin = null;
        this.snapToNearestEdge();
      };
      this._onPanelExpanded = (event) => {
        if (this.win.isDestroyed() || event.sender !== this.win.webContents) return;
        this._rendererExpanded = true;
        if (this.isDocked) this.sendDockState(); // mode 变了（strip→panel），渲染层的形态类名要跟上
      };
      this._onPanelCollapsed = (event) => {
        if (this.win.isDestroyed() || event.sender !== this.win.webContents) return;
        this._rendererExpanded = false;
        if (this.isDocked) this.sendDockState();
      };
      const { ipcMain } = electron;
      ipcMain.on(IPC.ISLAND_DRAG_START, this._onDragStart);
      ipcMain.on(IPC.ISLAND_DRAG_END, this._onDragEnd);
      ipcMain.on(IPC.ISLAND_PANEL_EXPANDED, this._onPanelExpanded);
      ipcMain.on(IPC.ISLAND_PANEL_COLLAPSED, this._onPanelCollapsed);
      // 渲染层崩溃重建窗口时，旧 handler 可能还没随 closed 摘掉；先移除再注册。
      ipcMain.removeHandler(IPC.ISLAND_GET_PLACEMENT);
      // 必须返回完整 dock 状态。只回 {placement} 会把推送过的 edge/mode/strip
      // 覆盖成 undefined，渲染层直接退化成一整块无裁切的黑矩形。
      ipcMain.handle(IPC.ISLAND_GET_PLACEMENT, () => this.dockState());
      // 补发落位状态。setPlacement 往往在页面加载完成前就调用过（启动时按设置
      // 落位），那时 webContents.send 会被直接丢弃，渲染层便一直以为自己是
      // notch 模式 —— 窗口已按面板尺寸摆好，渲染层却仍按刘海 clip-path 裁切。
      this.win.webContents.on("did-finish-load", () => {
        if (this.win.isDestroyed()) return;
        this.sendDockState();
        if (this.isDocked) this.applyDockBounds();
      });
      this.win.on("closed", () => this.disposeDock());
    }

    disposeDock() {
      const { ipcMain } = electron;
      ipcMain.removeListener(IPC.ISLAND_DRAG_START, this._onDragStart);
      ipcMain.removeListener(IPC.ISLAND_DRAG_END, this._onDragEnd);
      ipcMain.removeListener(IPC.ISLAND_PANEL_EXPANDED, this._onPanelExpanded);
      ipcMain.removeListener(IPC.ISLAND_PANEL_COLLAPSED, this._onPanelCollapsed);
      ipcMain.removeHandler(IPC.ISLAND_GET_PLACEMENT);
      this.stopDragFollow();
    }

    get isDocked() {
      return this._placement === "docked";
    }

    // ── 覆写：贴边态下接管，否则原样交还基类 ──────────────────────────────
    /** 贴边是常驻卡片，不参与全屏隐身。 */
    setFullscreenHidden(hidden) {
      if (this.isDocked) return;
      super.setFullscreenHidden(hidden);
    }
    /** 贴边是常驻卡片，不参与失焦隐身。 */
    setFocusHidden(hidden) {
      if (this.isDocked) return;
      super.setFocusHidden(hidden);
    }
    /** 贴边态窗口固定为面板大小：高度上报只记录、不改窗口。 */
    applyRequestedHeight(height) {
      if (!this.isDocked) return super.applyRequestedHeight(height);
      this.requestedHeight = Math.max(1, Math.round(height));
    }
    /** 贴边下没有「隐身到顶部热区」：收起只是回到穿透，让面板区域下方的应用可以正常点击。 */
    applyClosedWindowTarget(target, options) {
      if (!this.isDocked) return super.applyClosedWindowTarget(target, options);
      if (this.win.isDestroyed()) return;
      this.win.setOpacity(1);
      this.win.setIgnoreMouseEvents(true, { forward: true });
    }
    /**
     * moveToDisplay 之类的场景会先跑 fixPanel（它会把窗口甩回顶部居中），
     * 贴边态必须把窗口按新显示器重新摆回边上。
     */
    syncWindowToCurrentState() {
      if (!this.isDocked) return super.syncWindowToCurrentState();
      this.applyDockBounds();
      super.syncWindowToCurrentState();
    }

    // ── 贴边状态机 ────────────────────────────────────────────────────────
    /**
     * 切换落位形态。
     * notch  = 顶部刘海居中（基类原有形态，fixPanel + 菜单栏对齐那套几何）
     * docked = 贴边（位置由 edge + offset 决定）
     */
    setPlacement(placement, dock) {
      if (this.win.isDestroyed()) return;
      const next = placement === "docked" ? "docked" : "notch";
      const changed = this._placement !== next;
      this._placement = next;
      if (next === "docked") {
        // 常驻可见：把基类的隐身标记清零，「隐身到顶部热区」整套停用。
        this._isFullscreenHidden = false;
        this._isFocusHidden = false;
        this.isHoverRevealedWhileFullscreenHidden = false;
        this.shouldConcealAfterCloseAnimation = false;
        if (dock?.edge === "top" || dock?.edge === "left" || dock?.edge === "right") this._dockEdge = dock.edge;
        if (typeof dock?.offset === "number" && Number.isFinite(dock.offset)) this._dockOffset = clamp01(dock.offset);
        this.applyDockBounds();
        this.win.setOpacity(1);
        // 空闲态穿透 + 转发：条的可点击性由渲染层 mouseenter → ISLAND_ENTER 开启，
        // 和刘海模式同一套机制。
        this.win.setIgnoreMouseEvents(true, { forward: true });
      } else if (changed) {
        this.stopDragFollow();
        this._dragOrigin = null;
        this._dockDragging = false;
        // 把窗口尺寸/位置交还给基类那套几何：先恢复刘海形态的窗口宽度
        // （侧边贴边时窗口只有 380 宽，刘海 clip-path 按 740 宽算，不还原会错位），
        // 再 fixPanel 贴顶居中、压到收起高度。
        const { display } = this.currentTarget;
        const [w, h] = this._notchSize ?? this.win.getSize();
        this.win.setBounds({
          x: display.bounds.x + Math.round((display.bounds.width - w) / 2),
          y: display.bounds.y,
          width: w,
          height: h
        });
        fixPanel?.(this.win.getNativeWindowHandle(), display.id);
        this.applyRequestedHeight(this.getClosedHeight());
        this.win.setOpacity(1);
        this.win.setIgnoreMouseEvents(true, { forward: true });
      }
      if (changed) logger.info("[IslandDock] placement ->", next, next === "docked" ? this._dockEdge : "");
      this.sendDockState();
    }
    /** 当前 dock 形态：dragging | strip | panel。 */
    get dockMode() {
      if (this._dockDragging) return "dragging";
      return this._rendererExpanded ? "panel" : "strip";
    }
    dockGeometry() {
      return dockGeometry(
        this.currentTarget.display,
        this._dockEdge,
        this._dockOffset,
        pillSize(this.currentTarget.screenInfo)
      );
    }
    /** 把窗口摆到当前 dock 几何（瞬时）。形变动画在渲染层。 */
    applyDockBounds() {
      if (this.win.isDestroyed() || !this.isDocked || this._dockDragging) return;
      this.win.setBounds(this.dockGeometry().bounds);
      this.sendDockState();
    }
    /** 把完整 dock 状态推给渲染层。渲染层只照着画，不自行推断。 */
    sendDockState() {
      this.send(IPC.ISLAND_PLACEMENT, this.dockState());
    }
    dockState() {
      const state = {
        placement: this._placement,
        edge: this._dockEdge,
        mode: this.isDocked ? this.dockMode : "notch"
      };
      if (this.isDocked && !this._dockDragging) state.strip = this.dockGeometry().strip;
      return state;
    }
    /** 按下即收成小方块落在光标下，之后由主进程轮询光标跟手。 */
    beginDrag() {
      const c = electron.screen.getCursorScreenPoint();
      // 窗口是面板大小，保留原位置会让方块出现在面板左上角、离光标很远。
      this._dockDragging = true;
      const sx = c.x - Math.round(DOCK.SQUARE / 2);
      const sy = c.y - Math.round(DOCK.SQUARE / 2);
      this.win.setBounds({ x: sx, y: sy, width: DOCK.SQUARE, height: DOCK.SQUARE });
      this._dragOrigin = { cx: c.x, cy: c.y, wx: sx, wy: sy, startedAt: Date.now() };
      this.sendDockState();
      // 轮询而不是依赖渲染层持续上报 mousemove：拖动中鼠标常常已经移出窗口范围，
      // 渲染层就收不到事件了。
      this.stopDragFollow();
      this._dragTimer = setInterval(() => {
        if (this.win.isDestroyed() || !this._dragOrigin) {
          this.stopDragFollow();
          return;
        }
        if (Date.now() - this._dragOrigin.startedAt > DOCK.DRAG_MAX_MS) {
          // mouseup 没能传回来（例如鼠标在别的窗口上松开），别无限跟随。
          this.stopDragFollow();
          this._dragOrigin = null;
          this.snapToNearestEdge();
          return;
        }
        const now = electron.screen.getCursorScreenPoint();
        this.win.setPosition(
          this._dragOrigin.wx + (now.x - this._dragOrigin.cx),
          this._dragOrigin.wy + (now.y - this._dragOrigin.cy)
        );
      }, DOCK.DRAG_POLL_MS);
    }
    stopDragFollow() {
      if (this._dragTimer) {
        clearInterval(this._dragTimer);
        this._dragTimer = null;
      }
    }
    /** 松手：一定吸附到最近的边（上/左/右，不含底部），并记住位置。 */
    snapToNearestEdge() {
      if (this.win.isDestroyed() || !this.isDocked) return;
      const [width, height] = this.win.getSize();
      const [x, y] = this.win.getPosition();
      const rect = { x, y, width, height };
      // 显示器归属仍由 DisplayManager 决定：这里只算边与比例，几何始终按
      // currentTarget 那块屏摆放（拖到别的屏松手，会回到本屏对应位置）。
      const { workArea } = electron.screen.getDisplayMatching(rect);
      const { edge, offset } = nearestEdge(workArea, rect);
      this._dockEdge = edge;
      this._dockOffset = offset;
      this._dockDragging = false;
      this.applyDockBounds();
      // 吸附完成后回到穿透态：窗口是面板大小，空闲时绝不能挡住下面的点击。
      this.win.setIgnoreMouseEvents(true, { forward: true });
      this.onDockChange?.({ edge, offset });
    }
  }
  return DockableIslandWindow;
}

/**
 * 把附件接到应用上：按设置落位、拖动后把位置写回设置。
 * 返回 { applySettings }，在设置变更回调里调用即可让切换立即生效。
 */
function attachIslandDock(iw, coordinator, log) {
  if (!iw || typeof iw.setPlacement !== "function") return null;
  iw.onDockChange = (dock) => {
    try {
      coordinator.updateSettings({ islandDock: dock }, "island");
    } catch (err) {
      log?.warn?.("[IslandDock] 保存贴边位置失败:", err);
    }
  };
  let applied = "notch";
  const applySettings = (settings) => {
    const placement = settings?.islandPlacement === "docked" ? "docked" : "notch";
    if (placement === applied) return;
    applied = placement;
    try {
      iw.setPlacement(placement, settings?.islandDock);
    } catch (err) {
      log?.warn?.("[IslandDock] 应用落位失败:", err);
    }
  };
  applySettings(coordinator.getSettings?.() ?? {});
  return { applySettings };
}

module.exports = { DOCK, pillSize, dockGeometry, nearestEdge, createDockableIslandWindow, attachIslandDock };
