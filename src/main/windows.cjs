"use strict";

function createWindowClasses(dependencies) {
  const {
    electron,
    path,
    utils,
    IPC,
    fixPanel,
    fixPetWindow,
    setWindowCornerRadius,
    log,
    isVisibleInIsland,
    getIsQuitting
  } = dependencies;

  // 隐身热区：光标轮询间隔，以及热区在胶囊两侧的容错余量（与渲染层保持一致）。
  const HOTSPOT_POLL_INTERVAL_MS = 80;
  const HOTSPOT_SIDE_PADDING_PX = 48;
  const ISLAND_WIDTH = 740;
  const ISLAND_HEIGHT = 750;
  class IslandWindow {
    win;
    currentTarget;
    _hotspotTimer = null;
    // 渲染层是否处于展开态。只由渲染层的 PANEL_EXPANDED/COLLAPSED 上报驱动，
    // 不受主进程自己的 isPanelExpanded 推测影响 —— 后者会被隐藏路径提前置 false。
    _rendererExpanded = false;
    _isFullscreenHidden = false;
    _isFocusHidden = false;
    isHoverRevealedWhileFullscreenHidden = false;
    isPanelExpanded = false;
    shouldConcealAfterCloseAnimation = false;
    requestedHeight = ISLAND_HEIGHT;
    handleIslandEnter = () => {
      if (this.shouldStayConcealed) {
        this.shouldConcealAfterCloseAnimation = false;
        this.revealForHover();
      } else if (!this.win.isDestroyed()) {
        this.win.setIgnoreMouseEvents(false);
      }
    };
    handleIslandLeave = () => {
      if (this.win.isDestroyed()) return;
      if (this._isFullscreenHidden || this._isFocusHidden) {
        // 处于隐藏态（全屏隐藏或焦点丢失隐藏）时，鼠标一旦离开就立即收敛到
        // 透明 hotspot。不再"等关闭动画"——旧逻辑在 panel 展开时只置
        // shouldConcealAfterCloseAnimation 并转发鼠标，窗口本体仍可见（黑胶囊），
        // 且若关闭动画迟迟不来就长时间滞留。隐身必须是确定性的。
        this.isPanelExpanded = false;
        this.shouldConcealAfterCloseAnimation = false;
        this.applyClosedWindowTarget("hidden-hotspot");
      } else {
        this.win.setIgnoreMouseEvents(true, { forward: true });
      }
    };
    handleIslandResize = (event, payload) => {
      if (this.win.isDestroyed()) return;
      if (event.sender !== this.win.webContents) return;
      this.applyRequestedHeight(payload.height);
    };
    handleSyncClosedWindow = (event) => {
      if (this.win.isDestroyed()) return;
      if (event.sender !== this.win.webContents) return;
      // 面板正处于展开态时，收起同步一律丢弃。
      // 渲染层的 resize effect 只在 notchStatus/transitionClass 变化时重跑，
      // 面板稳定展开后不会再发高度；此时若被压到收起高度，就再没有东西会把它
      // 改回去 —— 于是展开态的宽形状被裁成顶部一条，长时间滞留成一根黑色长条。
      if (this.isPanelExpanded) {
        log.debug("[IslandWindow] 忽略展开态下的 syncClosedWindow");
        return;
      }
      this.landClosedWindow();
    };
    handlePanelExpanded = (event) => {
      if (this.win.isDestroyed()) return;
      if (event.sender !== this.win.webContents) return;
      this.isPanelExpanded = true;
      this._rendererExpanded = true;
    };
    handlePanelCollapsed = (event) => {
      if (this.win.isDestroyed()) return;
      if (event.sender !== this.win.webContents) return;
      this.isPanelExpanded = false;
      this._rendererExpanded = false;
    };
    constructor(target, options = {}) {
      this.currentTarget = target;
      const { display, screenInfo } = target;
      const winX = display.bounds.x + Math.round((display.bounds.width - ISLAND_WIDTH) / 2);
      const winY = display.bounds.y;
      log.debug("[IslandWindow] target display:", {
        id: display.id,
        bounds: display.bounds,
        label: screenInfo.label,
        hasNotch: screenInfo.hasNotch,
        notchHeight: screenInfo.notchHeight
      });
      const initialNotchInfo = this.buildNotchInfo(target);
      this.win = new electron.BrowserWindow({
        width: ISLAND_WIDTH,
        height: ISLAND_HEIGHT,
        x: winX,
        y: winY,
        show: false,
        frame: false,
        transparent: true,
        hasShadow: false,
        resizable: false,
        movable: false,
        skipTaskbar: true,
        webPreferences: {
          preload: path.join(__dirname, "../preload/island.js"),
          sandbox: false,
          contextIsolation: true,
          additionalArguments: [
            `--notch-info=${JSON.stringify(initialNotchInfo)}`
          ]
        }
      });
      this.win.setAlwaysOnTop(true, "pop-up-menu");
      this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      this.win.setIgnoreMouseEvents(true, { forward: true });
      fixPanel(this.win.getNativeWindowHandle(), display.id);
      if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        const url2 = `${process.env["ELECTRON_RENDERER_URL"]}/island/renderer/island.html`;
        this.win.loadURL(url2);
      } else {
        const filePath = path.join(__dirname, "../renderer/island/renderer/island.html");
        this.win.loadFile(filePath);
      }
      this.win.webContents.on("did-finish-load", () => {
        const notchInfo = this.buildNotchInfo(this.currentTarget);
        this.win.webContents.send(IPC.ISLAND_NOTCH_INFO, notchInfo);
        this.applyRequestedHeight(this.getClosedHeight());
        this.win.show();
        // 调试开关：WORKISLAND_CAPTURE=1 启动时，2s 后把渲染帧写到 /tmp。
        // 外部截屏工具抓不到面板级窗口，这是验证实际渲染的唯一手段；平时不跑。
        if (process.env.WORKISLAND_CAPTURE) {
          // 先收起再抓：活跃会话的审批事件可能已把面板弹开
          setTimeout(() => {
            if (!this.win.isDestroyed()) this.send(IPC.ISLAND_COLLAPSE);
          }, 1400);
          setTimeout(() => {
            if (this.win.isDestroyed()) return;
            this.win.webContents.capturePage().then((img) => {
              require("node:fs").writeFileSync("/tmp/island-capture.png", img.toPNG());
              log.info("[island capture] written");
            }).catch(() => {});
          }, 2000);
        }
        log.debug("[IslandWindow] ready on display:", this.currentTarget.screenInfo.label);
      });
      // 把渲染层的报错接到主日志：岛的渲染进程没有可见的 devtools，
      // 一旦 React 抛错整页空白，从外面看就只是「什么都不显示」，无从判断。
      this.win.webContents.on("console-message", (_e, level, message, line, sourceId) => {
        if (level >= 2) log.error("[island renderer]", message, `${sourceId}:${line}`);
      });
      this.win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
        log.error("[IslandWindow] did-fail-load:", { errorCode, errorDescription, validatedURL });
      });
      this.win.webContents.on("render-process-gone", (_event, details) => {
        log.error("[IslandWindow] render-process-gone:", details);
      });
      this.win.on("blur", () => {
        if (utils.is.dev && this.win.webContents.isDevToolsOpened()) return;
        // A native blur event covers focus changes that do not produce a DOM
        // mouseleave event, especially when switching to another application.
        // Focus changes can happen while the renderer shows either the
        // expanded panel or the closed pill; both states must be hideable.
        options.onBlur?.(this);
      });
      this.win.on("closed", () => {
        electron.ipcMain.removeListener(IPC.ISLAND_ENTER, this.handleIslandEnter);
        electron.ipcMain.removeListener(IPC.ISLAND_LEAVE, this.handleIslandLeave);
        electron.ipcMain.removeListener(IPC.ISLAND_RESIZE, this.handleIslandResize);
        electron.ipcMain.removeListener(IPC.ISLAND_PANEL_EXPANDED, this.handlePanelExpanded);
        electron.ipcMain.removeListener(IPC.ISLAND_PANEL_COLLAPSED, this.handlePanelCollapsed);
        electron.ipcMain.removeListener(IPC.ISLAND_SYNC_CLOSED_WINDOW, this.handleSyncClosedWindow);
        this.stopHotspotCursorWatch();
        log.warn("[IslandWindow] window closed");
      });
      electron.ipcMain.on(IPC.ISLAND_ENTER, this.handleIslandEnter);
      electron.ipcMain.on(IPC.ISLAND_LEAVE, this.handleIslandLeave);
      electron.ipcMain.on(IPC.ISLAND_RESIZE, this.handleIslandResize);
      electron.ipcMain.on(IPC.ISLAND_PANEL_EXPANDED, this.handlePanelExpanded);
      electron.ipcMain.on(IPC.ISLAND_PANEL_COLLAPSED, this.handlePanelCollapsed);
      electron.ipcMain.on(IPC.ISLAND_SYNC_CLOSED_WINDOW, this.handleSyncClosedWindow);
    }
    // ── Public API ─────────────────────────────────────────────────────────────
    get browserWindow() {
      return this.win;
    }
    get webContents() {
      return this.win.webContents;
    }
    /** Whether the island is currently in fullscreen-hidden mode. */
    get isFullscreenHidden() {
      return this._isFullscreenHidden;
    }
    getPillRect() {
      const { display, screenInfo } = this.currentTarget;
      const notchH = screenInfo.hasNotch ? screenInfo.notchHeight : screenInfo.menuBarHeight > 0 && screenInfo.menuBarHeight < 40 ? screenInfo.menuBarHeight : 24;
      const notchW = screenInfo.hasNotch ? screenInfo.notchWidth : 126;
      const pillWidth = Math.max(notchW, 126) + 40;
      const winCenterX = display.bounds.x + Math.round(display.bounds.width / 2);
      return {
        x: winCenterX - Math.round(pillWidth / 2),
        y: display.bounds.y,
        width: pillWidth,
        height: notchH
      };
    }
    /**
     * Enter or exit fullscreen-hidden mode.
     * When hidden: height=1px, opacity=0, mouse events forwarded.
     * When unhidden: restore original height, opacity=1.
     */
    setFullscreenHidden(hidden) {
      if (this.win.isDestroyed()) return;
      if (this._isFullscreenHidden === hidden) return;
      this._isFullscreenHidden = hidden;
      this.shouldConcealAfterCloseAnimation = false;
      log.debug("[IslandWindow] fullscreen hidden:", hidden);
      if (hidden) {
        this.isPanelExpanded = false;
        this.applyClosedWindowTarget("hidden-hotspot");
      } else {
        if (this._isFocusHidden) {
          this.applyClosedWindowTarget("hidden-hotspot");
          return;
        }
        // 从全屏隐藏恢复时，菜单栏可见性可能已变化（全屏→桌面），
        // 重新 fixPanel 让无刘海屏的窗口重新对齐菜单栏高度。
        const { display } = this.currentTarget;
        fixPanel(this.win.getNativeWindowHandle(), display.id);
        this.applyRequestedHeight(this.requestedHeight);
        this.win.setOpacity(1);
        this.win.setIgnoreMouseEvents(true, { forward: true });
      }
    }
    /** Hide the Island after focus leaves the WorkIsland surface. */
    setFocusHidden(hidden) {
      if (this.win.isDestroyed()) return;
      const next = Boolean(hidden);
      if (this._isFocusHidden === next && (!next || this.shouldStayConcealed)) return;
      this._isFocusHidden = next;
      this.shouldConcealAfterCloseAnimation = false;
      if (next) {
        this.isPanelExpanded = false;
        this.applyClosedWindowTarget("hidden-hotspot");
        return;
      }
      if (this.shouldStayConcealed) {
        this.applyClosedWindowTarget("hidden-hotspot");
        return;
      }
      this.isHoverRevealedWhileFullscreenHidden = false;
      this.applyRequestedHeight(this.getClosedHeight());
      this.win.setOpacity(1);
      this.win.setIgnoreMouseEvents(true, { forward: true });
    }
    /** Broadcast a typed payload to the island renderer. */
    send(channel, payload) {
      if (!this.win.isDestroyed()) {
        this.win.webContents.send(channel, payload);
      }
    }
    /**
     * Relocate the island to a different display.
     *
     * Safe to call at any time after construction. Re-runs fixPanel (idempotent ISA-swap,
     * re-applies level=102) and updates the renderer's notch geometry via ISLAND_NOTCH_INFO.
     *
     * 幂等：若 target display.id 与当前一致且 force 未置位则跳过 fixPanel，避免无意义的
     * window server 请求堆积（setCollectionBehavior dispatch_async 高频累积
     * 可导致主线程死锁）。topology-changed / metrics-changed 场景下上游传入
     * force=true 以确保同 id 但 bounds/scaleFactor 已变时仍重新定位。
     */
    moveToDisplay(target, options) {
      if (this.win.isDestroyed()) return;
      const isSameDisplay = target.display.id === this.currentTarget.display.id;
      this.currentTarget = target;
      const { display, screenInfo } = target;
      log.debug("[IslandWindow] move to display:", { id: display.id, label: screenInfo.label, skipped: isSameDisplay && !options?.force });
      if (!isSameDisplay || options?.force) {
        fixPanel(this.win.getNativeWindowHandle(), display.id);
      }
      const notchInfo = this.buildNotchInfo(target);
      this.send(IPC.ISLAND_NOTCH_INFO, notchInfo);
      this.syncWindowToCurrentState();
    }
    // ── Private helpers ────────────────────────────────────────────────────────
    // Hover reveal: user moved mouse into the island area while fullscreen-hidden.
    // Show the island and enable clicks so it behaves normally.
    /**
     * 原生窗口透明度的补间。
     * BrowserWindow.setOpacity 是瞬时的 —— 隐藏时直接 setOpacity(0)，
     * island 会「啪」地消失，没有任何过渡。CSS 在这里帮不上忙：
     * 窗口整体的 opacity 属于原生层，渲染层管不到。
     */
    fadeOpacityTo(target, durationMs, onDone) {
      if (this.win.isDestroyed()) return;
      if (this._fadeTimer) {
        clearInterval(this._fadeTimer);
        this._fadeTimer = null;
      }
      const from = this.win.getOpacity();
      if (durationMs <= 0 || Math.abs(target - from) < 0.01) {
        this.win.setOpacity(target);
        onDone?.();
        return;
      }
      const started = Date.now();
      this._fadeTimer = setInterval(() => {
        if (this.win.isDestroyed()) {
          clearInterval(this._fadeTimer);
          this._fadeTimer = null;
          return;
        }
        const t = Math.min(1, (Date.now() - started) / durationMs);
        // ease-out：起步快、收尾缓，和 CSS 的 ease-out 观感一致
        const eased = 1 - Math.pow(1 - t, 3);
        this.win.setOpacity(from + (target - from) * eased);
        if (t >= 1) {
          clearInterval(this._fadeTimer);
          this._fadeTimer = null;
          onDone?.();
        }
      }, 16);
    }
    revealForHover() {
      if (this.win.isDestroyed()) return;
      this.isHoverRevealedWhileFullscreenHidden = true;
      this.applyRequestedHeight(this.requestedHeight);
      // 唤出要跟手，用更短的淡入
      this.fadeOpacityTo(1, 110);
      this.win.setIgnoreMouseEvents(false);
    }
    // Convert DisplayTarget → NotchInfo for the island renderer.
    // screenOriginX/Y use Electron coords (top-left origin); the renderer uses
    // only notchHeight/Width for CSS, so coordinate system doesn't matter there.
    buildNotchInfo(target) {
      return {
        hasNotch: target.screenInfo.hasNotch,
        screenWidth: target.screenInfo.screenWidth,
        screenHeight: target.screenInfo.screenHeight,
        screenOriginX: target.display.bounds.x,
        screenOriginY: target.display.bounds.y,
        scaleFactor: target.screenInfo.scaleFactor,
        notchHeight: target.screenInfo.notchHeight,
        notchWidth: target.screenInfo.notchWidth,
        menuBarHeight: target.screenInfo.menuBarHeight
      };
    }
    getClosedHeight() {
      const { screenInfo } = this.currentTarget;
      return Math.max(
        screenInfo.hasNotch ? screenInfo.notchHeight : screenInfo.menuBarHeight > 0 && screenInfo.menuBarHeight < 40 ? screenInfo.menuBarHeight : 24,
        1
      );
    }
    /**
     * 当处于全屏隐藏且未被 hover 恢复时，窗口应保持 hotspot 形态（高 1px、透明、转发鼠标事件）。
     * 多处状态收敛逻辑都依赖该判定，集中到 getter 避免散落的 `_isFullscreenHidden && !isHoverRevealed` 漏判。
     */
    get shouldStayConcealed() {
      return (this._isFullscreenHidden || this._isFocusHidden) && !this.isHoverRevealedWhileFullscreenHidden;
    }
    /** renderer 关闭动画完成后由 IPC 触发：把窗口收敛到当前状态对应的目标态。 */
    landClosedWindow() {
      if (this.win.isDestroyed()) return;
      this.isPanelExpanded = false;
      const concealAfterClose = this._isFullscreenHidden && this.shouldConcealAfterCloseAnimation;
      this.shouldConcealAfterCloseAnimation = false;
      if (concealAfterClose || this.shouldStayConcealed) {
        this.applyClosedWindowTarget("hidden-hotspot");
        return;
      }
      this.applyClosedWindowTarget("visible-pill");
    }
    /** moveToDisplay 等场景下重新对齐窗口尺寸/可见性到当前状态。 */
    syncWindowToCurrentState() {
      if (this.win.isDestroyed()) return;
      if (this.shouldStayConcealed) {
        this.applyClosedWindowTarget("hidden-hotspot");
        return;
      }
      if (this.isPanelExpanded) {
        this.applyRequestedHeight(this.requestedHeight);
        return;
      }
      this.applyClosedWindowTarget("visible-pill", {
        interactive: this._isFullscreenHidden && this.isHoverRevealedWhileFullscreenHidden
      });
    }
    applyClosedWindowTarget(target, options) {
      if (this.win.isDestroyed()) return;
      const interactive = options?.interactive ?? false;
      const [width] = this.win.getSize();
      const closedHeight = this.getClosedHeight();
      this.requestedHeight = closedHeight;
      if (target === "hidden-hotspot") {
        // 透明热区：opacity 0（用户看不见），窗口保持胶囊高度占住屏幕顶部一条。
        //
        // 这里**不能捕获鼠标**。旧实现用 setIgnoreMouseEvents(false) 让窗口收下
        // 全部鼠标事件，代价是连点击一起吞掉 —— 于是热区覆盖的那段菜单栏在岛
        // 完全不可见的情况下也点不动，用户只会觉得"顶部有一块坏了"。
        //
        // 改为不拦截 + 主进程轮询光标坐标来判断是否进入热区：点击全部穿透给下方
        // 应用，悬停探测则完全不依赖窗口收到鼠标事件。
        this.isHoverRevealedWhileFullscreenHidden = false;
        // 先淡出、淡完再压高度。
        // 顺序反过来会露出「长条」：面板展开时若焦点丢失（setFocusHidden /
        // setFullscreenHidden 都是立刻调到这里），窗口高度瞬间压到 closedHeight，
        // 而渲染层的 clip-path 还停在展开态那个 740 宽的形状 —— 于是只露出顶部
        // 一条，看起来就是一根横贯的黑色长条。
        this.fadeOpacityTo(0, 200, () => {
          if (this.win.isDestroyed()) return;
          const [w] = this.win.getSize();
          this.win.setSize(w, closedHeight);
        });
        this.win.setIgnoreMouseEvents(true, { forward: true });
        this.startHotspotCursorWatch();
        // 仅当渲染层确实处于展开态时才强制它收起。少了这一步，主进程隐藏时两边
        // 状态会分叉：主进程把 requestedHeight 记成收起高度，渲染层却仍在画展开
        // 面板；之后 revealForHover 按 requestedHeight 恢复并置 opacity 1，就得到
        // 「展开态宽形状 + 收起态高度 + 完全可见」= 那根黑色长条。
        //
        // 条件必须收窄：无条件发会把「只有胶囊、面板本就没展开」的温和隐藏也变成
        // 强制收起，表现为点一下就整个消失。
        if (this._rendererExpanded) {
          this.send(IPC.ISLAND_COLLAPSE);
        }
        return;
      }
      this.stopHotspotCursorWatch();
      this.win.setSize(width, closedHeight);
      this.fadeOpacityTo(1, 110);
      if (interactive) {
        this.win.setIgnoreMouseEvents(false);
      } else {
        this.win.setIgnoreMouseEvents(true, { forward: true });
      }
    }
    /**
     * 隐身热区期间轮询光标位置，进入热区矩形即唤出。
     * 之所以轮询而不是靠窗口的 mouseenter：窗口此时对鼠标完全透明（点击要穿透
     * 给菜单栏），自然也收不到进入事件。轮询只在隐身态运行，唤出即停。
     */
    startHotspotCursorWatch() {
      this.stopHotspotCursorWatch();
      this._hotspotTimer = setInterval(() => {
        if (this.win.isDestroyed() || !this.shouldStayConcealed) {
          this.stopHotspotCursorWatch();
          return;
        }
        const pt = electron.screen.getCursorScreenPoint();
        const r = this.getPillRect();
        const inside = pt.x >= r.x - HOTSPOT_SIDE_PADDING_PX && pt.x <= r.x + r.width + HOTSPOT_SIDE_PADDING_PX && pt.y >= r.y && pt.y <= r.y + r.height;
        if (inside) {
          this.stopHotspotCursorWatch();
          this.revealForHover();
        }
      }, HOTSPOT_POLL_INTERVAL_MS);
    }
    stopHotspotCursorWatch() {
      if (this._hotspotTimer) {
        clearInterval(this._hotspotTimer);
        this._hotspotTimer = null;
      }
    }
    applyRequestedHeight(height) {
      if (this.win.isDestroyed()) return;
      const clamped = Math.max(1, Math.min(ISLAND_HEIGHT, Math.round(height)));
      this.requestedHeight = clamped;
      if (this.shouldStayConcealed) return;
      const [width] = this.win.getSize();
      this.win.setSize(width, clamped);
      // 无刘海屏上，收起态窗口对齐菜单栏高度，展开态从屏幕顶部向下生长。
      // 两者 y 定位不同，跨阈值时需要重新 fixPanel。
      // 有刘海屏 fixPanel 统一贴顶，重定位是 no-op（幂等），不会副作用。
      const { screenInfo, display } = this.currentTarget;
      if (!screenInfo.hasNotch && screenInfo.menuBarHeight > 0) {
        const prevH = this._lastAppliedHeight ?? clamped;
        const menuBarH = screenInfo.menuBarHeight;
        if ((prevH <= menuBarH) !== (clamped <= menuBarH)) {
          fixPanel(this.win.getNativeWindowHandle(), display.id);
        }
      }
      this._lastAppliedHeight = clamped;
    }
  }
  const BASE_PET_SIZE = 130;
  const BASE_DISPLAY_SIZE = 120;
  class PetPanelWindow {
    win;
    onReadyListener;
    onResizeListener;
    currentDirection;
    constructor(params) {
      this.currentDirection = params.direction;
      this.win = new electron.BrowserWindow({
        width: params.width,
        height: params.height,
        x: params.x,
        y: params.y,
        show: false,
        frame: false,
        transparent: true,
        opacity: 0,
        // 初始不透明度设为 0，等待重定位后恢复，解决闪烁问题
        hasShadow: true,
        resizable: false,
        skipTaskbar: true,
        vibrancy: "popover",
        visualEffectState: "active",
        webPreferences: {
          preload: path.join(__dirname, "../preload/pet-panel.js"),
          sandbox: false,
          contextIsolation: true
        }
      });
      this.win.setAlwaysOnTop(true, "pop-up-menu");
      this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      setWindowCornerRadius(this.win.getNativeWindowHandle(), 20);
      this.win.webContents.on("before-input-event", (event, input) => {
        if (input.type !== "keyDown" || !input.meta) return;
        if (input.key.toLowerCase() !== "w" && input.code !== "KeyW") return;
        event.preventDefault();
        params.onBlur();
      });
      if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        this.win.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/island/renderer/pet-panel.html`);
      } else {
        this.win.loadFile(path.join(__dirname, "../renderer/island/renderer/pet-panel.html"));
      }
      this.onReadyListener = (event) => {
        if (event.sender === this.win.webContents) {
          this.send(IPC.PET_PANEL_INIT, { direction: this.currentDirection, sessions: params.getSessions() });
          if (params.initialSurface) {
            this.send(IPC.PET_PANEL_SURFACE, params.initialSurface);
          }
        }
      };
      electron.ipcMain.on(IPC.PET_PANEL_READY, this.onReadyListener);
      this.onResizeListener = (event, height) => {
        if (event.sender === this.win.webContents && !this.win.isDestroyed()) {
          const newHeight = Math.ceil(height);
          const newBoundsAndDirection = params.onResize(newHeight);
          const bounds = this.win.getBounds();
          const directionChanged = this.currentDirection !== newBoundsAndDirection.direction;
          const boundsChanged = bounds.height !== newBoundsAndDirection.height || bounds.x !== newBoundsAndDirection.x || bounds.y !== newBoundsAndDirection.y;
          if (directionChanged) {
            this.currentDirection = newBoundsAndDirection.direction;
            this.send(IPC.PET_PANEL_INIT, { direction: this.currentDirection, sessions: params.getSessions() });
          }
          if (boundsChanged) {
            this.win.setBounds({
              x: newBoundsAndDirection.x,
              y: newBoundsAndDirection.y,
              width: newBoundsAndDirection.width,
              height: newBoundsAndDirection.height
            });
          }
          if (!this.win.isVisible()) {
            setTimeout(() => {
              if (!this.win.isDestroyed()) {
                this.win.showInactive();
                this.win.setOpacity(1);
              }
            }, 30);
          }
        }
      };
      electron.ipcMain.on(IPC.PET_PANEL_RESIZE, this.onResizeListener);
      this.win.on("blur", () => {
        if (utils.is.dev && this.win.webContents.isDevToolsOpened()) {
          return;
        }
        params.onBlur();
      });
      this.win.on("closed", () => {
        electron.ipcMain.removeListener(IPC.PET_PANEL_READY, this.onReadyListener);
        electron.ipcMain.removeListener(IPC.PET_PANEL_RESIZE, this.onResizeListener);
      });
    }
    get browserWindow() {
      return this.win;
    }
    get isDestroyed() {
      return this.win.isDestroyed();
    }
    send(channel, payload) {
      if (!this.win.isDestroyed()) {
        this.win.webContents.send(channel, payload);
      }
    }
    setBounds(bounds) {
      if (!this.win.isDestroyed()) {
        this.win.setBounds(bounds);
      }
    }
    destroy() {
      if (!this.win.isDestroyed()) {
        this.win.destroy();
      }
    }
  }
  const PET_WINDOW_PADDING = 10;
  const PANEL_VISUAL_WIDTH = 400;
  const PANEL_MAX_HEIGHT = 400;
  const PANEL_PADDING = 32;
  const SESSION_ROW_HEIGHT = 48;
  const SESSION_GAP = 14;
  const ACTIONABLE_CARD_HEIGHT = 160;
  function estimatePanelHeight(sessions) {
    const visible = sessions.filter(isVisibleInIsland);
    if (visible.length === 0) return PANEL_PADDING + 30;
    let h = PANEL_PADDING;
    for (let i = 0; i < visible.length; i++) {
      if (i > 0) h += SESSION_GAP;
      h += SESSION_ROW_HEIGHT;
      const p = visible[i].phase;
      if (p === "waitingForApproval" || p === "waitingForAnswer" || p === "completed") {
        h += ACTIONABLE_CARD_HEIGHT;
      }
    }
    return Math.min(h, PANEL_MAX_HEIGHT);
  }
  class PetWindow {
    win;
    panelWin = null;
    panelDirection = "up";
    petSize;
    displaySize;
    sessions = [];
    onMoveCallback = null;
    pendingSurface = null;
    pointerInside = false;
    initialInteractionTimer = null;
    constructor(x, y, scale = 1) {
      this.petSize = Math.round(BASE_PET_SIZE * scale);
      this.displaySize = Math.round(BASE_DISPLAY_SIZE * scale);
      const windowSize = this.petSize + PET_WINDOW_PADDING * 2;
      this.win = new electron.BrowserWindow({
        width: windowSize,
        height: windowSize,
        x: Math.round(x - windowSize / 2),
        y: Math.round(y - windowSize / 2),
        show: false,
        frame: false,
        transparent: true,
        hasShadow: false,
        resizable: false,
        skipTaskbar: true,
        webPreferences: {
          preload: path.join(__dirname, "../preload/pet.js"),
          sandbox: false,
          contextIsolation: true
        }
      });
      this.win.setAlwaysOnTop(true, "pop-up-menu");
      this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      this.win.setIgnoreMouseEvents(true, { forward: true });
      fixPetWindow(this.win.getNativeWindowHandle());
      if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        this.win.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/island/renderer/pet.html`);
      } else {
        this.win.loadFile(path.join(__dirname, "../renderer/island/renderer/pet.html"));
      }
      this.win.webContents.on("did-finish-load", () => {
        // Give the first hover/release sequence a real interactive window. Keeping the
        // window click-through from creation can prevent Chromium from ever producing
        // the mouseenter event that is supposed to disable click-through.
        this.win.show();
        this.send(IPC.PET_SIZE_UPDATE, { petSize: this.petSize, displaySize: this.displaySize });
        this.initialInteractionTimer = setTimeout(() => {
          if (this.win.isDestroyed()) return;
          this.win.setIgnoreMouseEvents(false);
          this.initialInteractionTimer = setTimeout(() => {
            this.initialInteractionTimer = null;
            if (!this.pointerInside && !this.win.isDestroyed()) {
              this.win.setIgnoreMouseEvents(true, { forward: true });
            }
          }, 600);
        }, 250);
      });
      this.win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
        log.error("[PetWindow] did-fail-load:", { errorCode, errorDescription, validatedURL });
      });
      this.win.webContents.on("render-process-gone", (_event, details) => {
        log.error("[PetWindow] render-process-gone:", details);
      });
      electron.ipcMain.on(IPC.PET_ENTER, this.handleEnter);
      electron.ipcMain.on(IPC.PET_LEAVE, this.handleLeave);
      electron.ipcMain.on(IPC.PET_MOVE, this.handleMove);
      electron.ipcMain.on(IPC.PET_TOGGLE_PANEL, this.handleTogglePanel);
    }
    get browserWindow() {
      return this.win;
    }
    get isPanelOpen() {
      return this.panelWin !== null && !this.panelWin.isDestroyed;
    }
    get currentPetSize() {
      return this.petSize;
    }
    getCanvasBounds() {
      const bounds = this.win.getBounds();
      const offset = PET_WINDOW_PADDING + (this.petSize - this.displaySize) / 2;
      return {
        x: Math.round(bounds.x + offset),
        y: Math.round(bounds.y + offset),
        width: this.displaySize,
        height: this.displaySize
      };
    }
    setOnMove(cb) {
      this.onMoveCallback = cb;
    }
    send(channel, payload) {
      if (!this.win.isDestroyed()) {
        this.win.webContents.send(channel, payload);
      }
      if (channel === IPC.PET_SESSION_UPDATE) {
        this.sessions = payload ?? [];
        if (this.panelWin && !this.panelWin.isDestroyed) {
          this.panelWin.send(channel, payload);
        }
      }
    }
    destroy() {
      if (this.initialInteractionTimer) {
        clearTimeout(this.initialInteractionTimer);
        this.initialInteractionTimer = null;
      }
      electron.ipcMain.removeListener(IPC.PET_ENTER, this.handleEnter);
      electron.ipcMain.removeListener(IPC.PET_LEAVE, this.handleLeave);
      electron.ipcMain.removeListener(IPC.PET_MOVE, this.handleMove);
      electron.ipcMain.removeListener(IPC.PET_TOGGLE_PANEL, this.handleTogglePanel);
      if (this.panelWin) {
        this.panelWin.destroy();
        this.panelWin = null;
      }
      if (!this.win.isDestroyed()) {
        this.win.destroy();
      }
    }
    handleEnter = () => {
      this.pointerInside = true;
      if (!this.win.isDestroyed()) {
        this.win.setIgnoreMouseEvents(false);
      }
    };
    handleLeave = () => {
      this.pointerInside = false;
      if (!this.win.isDestroyed()) {
        this.win.setIgnoreMouseEvents(true, { forward: true });
      }
    };
    handleMove = (_e, dx, dy) => {
      if (this.win.isDestroyed()) return;
      if (this.panelWin) this.collapsePanel();
      const [x, y] = this.win.getPosition();
      this.win.setPosition(x + dx, y + dy);
      this.onMoveCallback?.();
    };
    handleTogglePanel = () => {
      if (this.isPanelOpen) {
        this.collapsePanel();
      } else {
        this.expandPanel();
      }
    };
    calculatePanelBounds(panelH) {
      const bounds = this.win.getBounds();
      const display = electron.screen.getDisplayNearestPoint({
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2
      });
      const workArea = display.workArea;
      const gap = 10 * (this.petSize / BASE_PET_SIZE);
      const panelW = PANEL_VISUAL_WIDTH;
      const centerX = bounds.x + bounds.width / 2;
      const centerY = bounds.y + bounds.height / 2;
      const halfPetSize = this.petSize / 2;
      const petTop = centerY - halfPetSize;
      const petBottom = centerY + halfPetSize;
      const petLeft = centerX - halfPetSize;
      const petRight = centerX + halfPetSize;
      const spaceTop = petTop - workArea.y;
      const spaceBottom = workArea.y + workArea.height - petBottom;
      const spaceLeft = petLeft - workArea.x;
      const spaceRight = workArea.x + workArea.width - petRight;
      const needH = panelH + gap;
      const needW = panelW + gap;
      const nearTop = spaceTop < needH;
      const nearBottom = spaceBottom < needH;
      const nearLeft = spaceLeft < needW;
      const nearRight = spaceRight < needW;
      let direction = "up";
      if (nearTop) {
        if (nearBottom) {
          direction = spaceLeft > spaceRight ? "left" : "right";
        } else {
          if (nearLeft && spaceRight > spaceBottom) direction = "right";
          else if (nearRight && spaceLeft > spaceBottom) direction = "left";
          else direction = "down";
        }
      } else {
        const halfPanelW = panelW / 2;
        const toLeft = centerX - workArea.x;
        const toRight = workArea.x + workArea.width - centerX;
        if (toLeft >= halfPanelW || toRight >= halfPanelW) direction = "up";
        else if (nearLeft) direction = "right";
        else if (nearRight) direction = "left";
        else direction = "up";
      }
      let panelX = 0;
      let panelY = 0;
      if (direction === "up") {
        panelX = Math.round(centerX - panelW / 2);
        panelY = Math.round(petTop - gap - panelH);
      } else if (direction === "down") {
        panelX = Math.round(centerX - panelW / 2);
        panelY = Math.round(petBottom + gap);
      } else if (direction === "left") {
        panelX = Math.round(petLeft - gap - panelW);
        panelY = Math.round(centerY - panelH / 2);
      } else {
        panelX = Math.round(petRight + gap);
        panelY = Math.round(centerY - panelH / 2);
      }
      const finalX = Math.max(workArea.x, Math.min(panelX, workArea.x + workArea.width - panelW));
      const finalY = Math.max(workArea.y, Math.min(panelY, workArea.y + workArea.height - panelH));
      return {
        x: finalX,
        y: finalY,
        width: panelW,
        height: panelH,
        direction
      };
    }
    expandPanel() {
      if (this.win.isDestroyed()) return;
      const initialH = estimatePanelHeight(this.sessions);
      const initialBounds = this.calculatePanelBounds(initialH);
      this.panelDirection = initialBounds.direction;
      const surface = this.pendingSurface;
      this.pendingSurface = null;
      this.panelWin = new PetPanelWindow({
        x: initialBounds.x,
        y: initialBounds.y,
        width: initialBounds.width,
        height: initialBounds.height,
        direction: initialBounds.direction,
        getSessions: () => this.sessions,
        initialSurface: surface,
        onBlur: () => {
          this.collapsePanel();
        },
        onResize: (height) => {
          const actualH = Math.ceil(height);
          const newBounds = this.calculatePanelBounds(actualH);
          if (this.panelDirection !== newBounds.direction || !this.panelWin?.browserWindow.isVisible()) {
            this.panelDirection = newBounds.direction;
            this.send(IPC.PET_PANEL_STATE, { open: true, direction: this.panelDirection });
          }
          return newBounds;
        }
      });
    }
    expandPanelWithSurface(surface) {
      if (this.win.isDestroyed()) return;
      this.pendingSurface = surface;
      this.expandPanel();
    }
    sendSurfaceToPanel(surface) {
      if (this.panelWin && !this.panelWin.isDestroyed) {
        this.panelWin.send(IPC.PET_PANEL_SURFACE, surface);
      }
    }
    collapsePanel() {
      if (!this.panelWin) return;
      this.panelWin.destroy();
      this.panelWin = null;
      if (!this.win.isDestroyed()) {
        this.send(IPC.PET_PANEL_STATE, { open: false, direction: this.panelDirection });
      }
    }
    resize(scale) {
      if (this.win.isDestroyed()) return;
      if (this.isPanelOpen) this.collapsePanel();
      const oldWindowSize = this.petSize + PET_WINDOW_PADDING * 2;
      this.petSize = Math.round(BASE_PET_SIZE * scale);
      this.displaySize = Math.round(BASE_DISPLAY_SIZE * scale);
      const newWindowSize = this.petSize + PET_WINDOW_PADDING * 2;
      const bounds = this.win.getBounds();
      const cx = bounds.x + oldWindowSize / 2;
      const cy = bounds.y + oldWindowSize / 2;
      this.win.setBounds({
        x: Math.round(cx - newWindowSize / 2),
        y: Math.round(cy - newWindowSize / 2),
        width: newWindowSize,
        height: newWindowSize
      }, true);
      this.send(IPC.PET_SIZE_UPDATE, { petSize: this.petSize, displaySize: this.displaySize });
    }
  }
  class SettingsWindow {
    win = null;
    /** The underlying BrowserWindow (may be null before first show). */
    get browserWindow() {
      return this.win && !this.win.isDestroyed() ? this.win : null;
    }
    /** Show the settings window, creating it on first call.
     *  displayBounds — 灵动岛当前所在屏幕的 bounds，设置窗口将居中显示于该屏幕。
     */
    show(displayBounds) {
      if (this.win && !this.win.isDestroyed()) {
        if (displayBounds) this.centerOnDisplay(this.win, displayBounds);
        this.win.show();
        this.win.focus();
        return;
      }
      const width = 680;
      const height = 520;
      const pos = displayBounds ? {
        x: displayBounds.x + Math.round((displayBounds.width - width) / 2),
        y: displayBounds.y + Math.round((displayBounds.height - height) / 2)
      } : {};
      this.win = new electron.BrowserWindow({
        width,
        height,
        ...pos,
        show: false,
        resizable: true,
        minimizable: true,
        maximizable: false,
        fullscreenable: false,
        title: "WorkIsland Settings",
        titleBarStyle: "hiddenInset",
        trafficLightPosition: { x: 14, y: 14 },
        transparent: true,
        backgroundColor: "#00000000",
        vibrancy: "under-window",
        visualEffectState: "active",
        icon: path.join(__dirname, "../../resources/icon.png"),
        webPreferences: {
          preload: path.join(__dirname, "../preload/settings.js"),
          sandbox: false,
          contextIsolation: true
        }
      });
      if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        this.win.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/island/renderer/settings.html`);
      } else {
        this.win.loadFile(path.join(__dirname, "../renderer/island/renderer/settings.html"));
      }
      this.win.once("ready-to-show", () => {
        this.win?.show();
      });
      this.win.on("close", (e) => {
        if (!getIsQuitting()) {
          e.preventDefault();
          this.win?.hide();
        }
      });
    }
    centerOnDisplay(win, bounds) {
      const [width, height] = win.getSize();
      const x = bounds.x + Math.round((bounds.width - width) / 2);
      const y = bounds.y + Math.round((bounds.height - height) / 2);
      win.setPosition(x, y);
    }
  }
  class DebugWindow {
    win = null;
    /** Show the debug window, creating it on first call. */
    show() {
      if (this.win && !this.win.isDestroyed()) {
        this.win.show();
        this.win.focus();
        return;
      }
      this.win = new electron.BrowserWindow({
        width: 1080,
        height: 720,
        minWidth: 900,
        minHeight: 600,
        show: false,
        resizable: true,
        title: "WorkIsland Debug Playground",
        icon: path.join(__dirname, "../../resources/icon.png"),
        webPreferences: {
          preload: path.join(__dirname, "../preload/debug.js"),
          sandbox: false,
          contextIsolation: true
        }
      });
      if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        this.win.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/island/renderer/debug.html`);
      } else {
        this.win.loadFile(path.join(__dirname, "../renderer/island/renderer/debug.html"));
      }
      this.win.once("ready-to-show", () => {
        this.win?.show();
      });
      this.win.on("close", (e) => {
        if (!getIsQuitting()) {
          e.preventDefault();
          this.win?.hide();
        }
      });
    }
  }
  class WelcomeWindow {
    win;
    constructor({ consentOnly = false } = {}) {
      this.win = new electron.BrowserWindow({
        width: 420,
        height: 540,
        show: false,
        frame: false,
        resizable: false,
        maximizable: false,
        minimizable: false,
        transparent: true,
        backgroundColor: "#00000000",
        center: true,
        icon: path.join(__dirname, "../../resources/icon.png"),
        webPreferences: {
          preload: path.join(__dirname, "../preload/welcome.js"),
          sandbox: false,
          contextIsolation: true
        }
      });
      if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        const suffix = consentOnly ? "?mode=telemetry" : "";
        this.win.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/island/renderer/welcome.html${suffix}`);
      } else {
        this.win.loadFile(path.join(__dirname, "../renderer/island/renderer/welcome.html"), consentOnly ? {
          query: { mode: "telemetry" }
        } : undefined);
      }
      this.win.once("ready-to-show", () => {
        this.win.show();
        this.win.focus();
      });
    }
    get browserWindow() {
      return this.win;
    }
    close() {
      if (!this.win.isDestroyed()) {
        this.win.destroy();
      }
    }
  }

  return {
    IslandWindow,
    PetPanelWindow,
    PetWindow,
    SettingsWindow,
    DebugWindow,
    WelcomeWindow
  };
}

module.exports = { createWindowClasses };
