"use strict";

const electron = require("electron");
const log = require("electron-log");
const { EventEmitter } = require("node:events");

function createDisplayManagerClass({
  getAllScreensInfo,
  getFrontmostAppDisplayId,
  watchFrontmostApp,
  unwatchFrontmostApp,
  watchScreenParameters,
  unwatchScreenParameters
}) {
  function getAllDisplayTargets() {
    const rawScreens = getAllScreensInfo();
    const displays = electron.screen.getAllDisplays();
    const externalCount = displays.filter((d, i) => {
      const raw = rawScreens.find((s) => s.cgDisplayId === d.id);
      return !raw?.localizedName && !(raw?.isMain ?? i === 0);
    }).length;
    return displays.map((display, index) => {
      const raw = rawScreens.find((s) => s.cgDisplayId === display.id);
      const screenInfo = {
        displayId: String(display.id),
        label: buildLabel(raw?.localizedName, raw?.isMain ?? false, raw?.hasNotch ?? false, index, externalCount),
        hasNotch: raw?.hasNotch ?? false,
        notchHeight: raw?.notchHeight ?? 0,
        notchWidth: raw?.notchWidth ?? 0,
        screenWidth: display.bounds.width,
        screenHeight: display.bounds.height,
        scaleFactor: display.scaleFactor,
        isMain: raw?.isMain ?? index === 0,
        menuBarHeight: raw?.menuBarHeight ?? 0
      };
      return { display, screenInfo };
    });
  }
  function buildLabel(localizedName, isMain, hasNotch, index, externalCount) {
    if (localizedName) return localizedName;
    if (isMain) {
      return hasNotch ? "Built-in Retina Display" : "Built-in Display";
    }
    if (externalCount <= 1) return "External Display";
    return `External Display ${index}`;
  }
  const REFRESH_DEBOUNCE_MS = 350;
  class DisplayManager extends EventEmitter {
    preference;
    /** 用户选择的屏幕 localizedName，用于 displayId 变化后按名称回退匹配 */
    preferenceLabel;
    currentTarget = null;
    // 去抖定时器句柄。任何一次 refresh 请求都会取消前一次、重排一次，
    // 最终只以"最后一次事件 + REFRESH_DEBOUNCE_MS"为准执行真正的 refresh。
    refreshTimer = null;
    // 合并本轮去抖窗口内的所有原因：只要出现过 'metrics-changed' 或
    // 'topology-changed'，都要强制触发 displayChanged，避免"同 id 不同 frame"被吞掉。
    pendingReason = void 0;
    // frontmost app 跟踪的去抖定时器。
    // 鼠标点击 + app 切换在多屏环境下可能极高频地触发 TSFN 回调，
    // 若每次都同步执行 emit displayChanged → moveToDisplay → fixPanel，
    // fixPanel 内的 dispatch_async(setCollectionBehavior) 会在 main queue 上
    // 持续堆积 window server 同步请求，最终导致主线程死锁（进程卡死）。
    // 200ms 去抖将高频事件收敛为一次，同时体感无延迟。
    frontmostTimer = null;
    static FRONTMOST_DEBOUNCE_MS = 200;
    // Bound event handlers so we can remove them cleanly in dispose().
    //
    // 注意：三种 Electron 事件此前分别调用 refresh() / refresh('metrics-changed')，
    // 现统一走 scheduleRefresh() 去抖。并且 display-added / display-removed
    // 不再传空 reason —— 即使 target display id 不变（比如用户接入一块不被选中的
    // 外屏，但此时其他屏的 bounds 可能已变），也要强制重跑 fixPanel，因为原本
    // 只以 id 变化作为触发条件会漏掉"同 id、新 bounds"的拓扑变化。
    onDisplayAdded = () => {
      this.scheduleRefresh("topology-changed");
    };
    onDisplayRemoved = () => {
      this.scheduleRefresh("topology-changed");
    };
    onDisplayChanged = () => {
      this.scheduleRefresh("metrics-changed");
    };
    constructor(preference, preferenceLabel) {
      super();
      this.preference = preference;
      this.preferenceLabel = preferenceLabel;
      const initial = this.resolve();
      if (initial) {
        if (initial.correctedId) {
          this.preference = initial.correctedId;
          this.preferenceLabel = initial.target.screenInfo.label;
          queueMicrotask(() => this.emit("preferenceIdCorrected", initial.correctedId, initial.target.screenInfo.label));
        }
        this.currentTarget = initial.target;
      }
      if (preference === "auto") this.startFrontmostTracking();
      this.setupDisplayEvents();
      this.startScreenParamsTracking();
    }
    // ── Public API ────────────────────────────────────────────────────────────
    /** The resolved display at construction time or after the last change. */
    getCurrentTarget() {
      return this.currentTarget;
    }
    /** All connected displays with their notch info — used by the display picker in Settings. */
    getAllTargets() {
      return getAllDisplayTargets();
    }
    /** Update preference (called when user changes the setting). */
    setPreference(pref, label) {
      const wasAuto = this.preference === "auto";
      const isAuto = pref === "auto";
      this.preference = pref;
      this.preferenceLabel = label;
      if (isAuto && !wasAuto) {
        this.startFrontmostTracking();
      } else if (!isAuto && wasAuto) {
        this.stopFrontmostTracking();
      }
      this.refresh();
    }
    /** Clean up native observer and Electron listeners before app quit. */
    dispose() {
      if (this.preference === "auto") this.stopFrontmostTracking();
      electron.screen.off("display-added", this.onDisplayAdded);
      electron.screen.off("display-removed", this.onDisplayRemoved);
      electron.screen.off("display-metrics-changed", this.onDisplayChanged);
      this.stopScreenParamsTracking();
      if (this.refreshTimer) {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = null;
      }
      if (this.frontmostTimer) {
        clearTimeout(this.frontmostTimer);
        this.frontmostTimer = null;
      }
    }
    // ── Internal ──────────────────────────────────────────────────────────────
    setupDisplayEvents() {
      electron.screen.on("display-added", this.onDisplayAdded);
      electron.screen.on("display-removed", this.onDisplayRemoved);
      electron.screen.on("display-metrics-changed", this.onDisplayChanged);
    }
    // Subscribe to NSWorkspaceDidActivateApplicationNotification via native addon.
    // The callback fires whenever the user switches to a different app, giving us
    // the CGDirectDisplayID of the screen containing that app's frontmost window.
    //
    // 回调走 200ms 去抖：在多屏环境下（尤其三屏），鼠标点击和 app 切换通知
    // 可能在毫秒内触发数十次，若每次都同步调 fixPanel（其内部 dispatch_async 向
    // window server 发 setCollectionBehavior），会导致 main queue 上的 blocks
    // 持续堆积，最终 window server 过载或死锁——即用户报告的"卡死"现象。
    startFrontmostTracking() {
      watchFrontmostApp((displayId) => {
        if (this.preference !== "auto") return;
        if (this.frontmostTimer) clearTimeout(this.frontmostTimer);
        this.frontmostTimer = setTimeout(() => {
          this.frontmostTimer = null;
          const all = getAllDisplayTargets();
          const target = all.find((t) => t.display.id === displayId) ?? null;
          if (!target) return;
          if (target.display.id !== this.currentTarget?.display.id) {
            this.currentTarget = target;
            this.emit("displayChanged", target);
          }
        }, DisplayManager.FRONTMOST_DEBOUNCE_MS);
      });
    }
    stopFrontmostTracking() {
      unwatchFrontmostApp();
      if (this.frontmostTimer) {
        clearTimeout(this.frontmostTimer);
        this.frontmostTimer = null;
      }
    }
    // 订阅原生 NSApplicationDidChangeScreenParametersNotification。
    // 此通知在 AppKit 屏幕参数完全稳定后才触发，比 Electron 事件更靠后、更可靠；
    // 用它作为最终的"保险触发源"，保证即使 Electron 事件漏发或被合并，
    // 灵动岛也一定能在布局稳定后重新定位。
    //
    // 两侧触发（原生 + Electron）共享同一把去抖定时器：谁先触发都会排定时器，
    // 后触发者只会重置定时器，最终只执行一次 refresh。
    startScreenParamsTracking() {
      watchScreenParameters(() => {
        this.scheduleRefresh("topology-changed");
      });
    }
    stopScreenParamsTracking() {
      unwatchScreenParameters();
    }
    // 去抖包装的 refresh：
    //   - 合并短时间内多次触发（切分辨率/插拔外屏时，事件常连发 3~5 次）
    //   - 等待 REFRESH_DEBOUNCE_MS 后再真正执行 refresh，确保此时 NSScreen 已稳定
    //   - 本轮窗口内出现过的任意"需要强制 emit"的理由都会被累积，防止被静默吞掉
    scheduleRefresh(reason) {
      this.pendingReason = reason;
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        const r = this.pendingReason;
        this.pendingReason = void 0;
        this.refresh(r);
      }, REFRESH_DEBOUNCE_MS);
    }
    // Re-resolve the target and emit 'displayChanged' when:
    //   - the target display changed (different display.id), OR
    //   - display metrics changed / topology changed (同 display.id 也可能 bounds/
    //     scaleFactor 变了，例如外屏插入后内屏的全局坐标不变但 NSScreen 数组/主屏
    //     归属变化，仍需让 IslandWindow 重跑 fixPanel + 更新 notchInfo)。
    //
    // 关键改动：reason 只要存在（metrics-changed 或 topology-changed），就强制 emit。
    // 旧逻辑中 display-added/removed 调用的是无 reason 的 refresh()，当 target id
    // 不变时会直接吞掉事件，导致"接入外屏但灵动岛所在的内屏 bounds 已刷新"的场景
    // 收不到 displayChanged，灵动岛保持旧位置。
    refresh(reason) {
      const result = this.resolve();
      if (!result) return;
      if (result.correctedId) {
        this.preference = result.correctedId;
        this.preferenceLabel = result.target.screenInfo.label;
        this.emit("preferenceIdCorrected", result.correctedId, result.target.screenInfo.label);
      }
      const next = result.target;
      const idChanged = next.display.id !== this.currentTarget?.display.id;
      if (idChanged || reason) {
        this.currentTarget = next;
        this.emit("displayChanged", next, reason);
      }
    }
    // Core resolution logic — pure, no side effects.
    // In 'auto' mode, reads the current frontmost app's display from the native addon
    // (used at construction time and after display topology changes).
    resolve() {
      const all = getAllDisplayTargets();
      if (all.length === 0) return null;
      if (this.preference === "auto") {
        const frontmostId = getFrontmostAppDisplayId();
        if (frontmostId !== null) {
          const match = all.find((t) => t.display.id === frontmostId);
          if (match) return { target: match };
        }
        if (this.currentTarget) return { target: this.currentTarget };
        const cursor = electron.screen.getCursorScreenPoint();
        const active = electron.screen.getDisplayNearestPoint(cursor);
        return { target: all.find((t) => t.display.id === active.id) ?? all[0] };
      }
      if (this.preference === "primary") {
        const main2 = all.find((t) => t.screenInfo.isMain);
        if (main2) return { target: main2 };
        const primary2 = electron.screen.getPrimaryDisplay();
        return { target: all.find((t) => t.display.id === primary2.id) ?? all[0] };
      }
      const pinned = all.find((t) => t.screenInfo.displayId === this.preference);
      if (pinned) {
        if (!this.preferenceLabel && pinned.screenInfo.label) {
          return { target: pinned, correctedId: this.preference };
        }
        return { target: pinned };
      }
      if (this.preferenceLabel) {
        const byLabel = all.find((t) => t.screenInfo.label === this.preferenceLabel);
        if (byLabel) {
          console.info(`[DisplayManager] pinned display ${this.preference} not found; matched label "${this.preferenceLabel}" -> ${byLabel.screenInfo.displayId}`);
          return { target: byLabel, correctedId: byLabel.screenInfo.displayId };
        }
      }
      console.warn(`[DisplayManager] pinned display ${this.preference} (label=${this.preferenceLabel ?? "unknown"}) not found, falling back to primary`);
      const main = all.find((t) => t.screenInfo.isMain);
      if (main) return { target: main };
      const primary = electron.screen.getPrimaryDisplay();
      return { target: all.find((t) => t.display.id === primary.id) ?? all[0] };
    }
  }
  return DisplayManager;
}

module.exports = { createDisplayManagerClass };
