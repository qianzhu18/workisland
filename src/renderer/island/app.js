import "../shared/i18n.js";
import { I as ISLAND_PANEL_MAX_HEIGHT_DEFAULT_PX, D as DEFAULT_SETTINGS, c as clampPanelMaxHeightPx, l as loadPluginAgentMeta } from "../shared/settings.js";
import { r as reactExports, R as React, a as ReactDOM } from "../vendor/react-runtime.js";
import { D as DEFAULT_NOTCH_INFO, r as requiresAttention, d as dominantPhase, I as IslandPill, g as getIslandClipShape, a as getIslandMaxBodyWidth } from "./components/IslandPill.js";
import { c as create } from "../vendor/store.js";
import { I as IslandPanel } from "./components/IslandPanel.js";
import { isVisibleInIsland } from "./session-model.mjs";
import { resolveFocusLossPresentation, shouldCollapseOnFocusLoss } from "./focus-policy.mjs";
import { b as buildDockClipPath } from "./dock-shape.js";
const useSessionStore = create((set) => ({
  sessions: [],
  notchInfo: window.islandBridge?.__initialNotchInfo ?? DEFAULT_NOTCH_INFO,
  surface: null,
  openReason: null,
  notificationAutoDismiss: false,
  agentQuotas: {},
  onboardingExpand: false,
  hasUpdate: false,
  toggleExpandTick: 0,
  collapseTick: 0,
  switchSessionTick: 0,
  switchSessionDirection: "down",
  confirmSessionTick: 0,
  setSessions: (sessions) => set({ sessions }),
  setNotchInfo: (notchInfo) => set({ notchInfo }),
  presentSurface: (surface, openReason, notificationAutoDismiss = false) => set({ surface, openReason, notificationAutoDismiss }),
  clearSurface: () => set({ surface: null, openReason: null, notificationAutoDismiss: false }),
  setAgentQuotas: (agentQuotas) => set({ agentQuotas }),
  setOnboardingExpand: (onboardingExpand) => set({ onboardingExpand }),
  setHasUpdate: (hasUpdate) => set({ hasUpdate }),
  requestToggleExpand: () => set((state) => ({ toggleExpandTick: state.toggleExpandTick + 1 })),
  requestCollapse: () => set((state) => ({ collapseTick: state.collapseTick + 1 })),
  requestSwitchSession: (direction) => set((state) => ({ switchSessionTick: state.switchSessionTick + 1, switchSessionDirection: direction })),
  requestConfirmSession: () => set((state) => ({ confirmSessionTick: state.confirmSessionTick + 1 }))
}));
function useIslandState() {
  const { setSessions, setNotchInfo, presentSurface, setAgentQuotas, setHasUpdate } = useSessionStore();
  reactExports.useEffect(() => {
    const bridge = window.islandBridge;
    if (!bridge) {
      console.error("[useIslandState] islandBridge is not defined — preload may have failed");
      return;
    }
    bridge.onNotchInfo((info) => {
      setNotchInfo(info);
    });
    bridge.onSessionUpdate((sessions) => {
      setSessions(sessions);
    });
    bridge.onPresentSurface(({ surface, reason, autoDismiss }) => {
      presentSurface(surface, reason, autoDismiss);
    });
    bridge.onQuotaUpdate((quotas) => setAgentQuotas(quotas));
    const offUpdate = bridge.onUpdateAvailable?.(() => setHasUpdate(true));
    void bridge.getQuotaMap().then((quotas) => {
      if (quotas && Object.keys(quotas).length > 0) setAgentQuotas(quotas);
    });
    bridge.onOnboardingExpand(() => {
      useSessionStore.getState().setOnboardingExpand(true);
    });
    bridge.onToggleExpand?.(() => {
      useSessionStore.getState().requestToggleExpand();
    });
    bridge.onCollapse?.(() => {
      useSessionStore.getState().requestCollapse();
    });
    bridge.onWindowBlur?.(() => {
      window.dispatchEvent(new Event("workisland-window-blur"));
    });
    bridge.onSwitchSession?.((direction) => {
      useSessionStore.getState().requestSwitchSession(direction);
    });
    bridge.onConfirmSession?.(() => {
      useSessionStore.getState().requestConfirmSession();
    });
    return () => offUpdate?.();
  }, []);
}
function useIslandAnimation() {
  const [notchStatus, setNotchStatus] = reactExports.useState("closed");
  const [transitionClass, setTransitionClass] = reactExports.useState("");
  const [isPopping, setIsPopping] = reactExports.useState(false);
  const popTimer = reactExports.useRef(null);
  const open = reactExports.useCallback(() => {
    setTransitionClass("is-opening");
    setNotchStatus("opened");
  }, []);
  const close = reactExports.useCallback(() => {
    setTransitionClass("is-closing");
    setNotchStatus("closed");
  }, []);
  const pop = reactExports.useCallback(() => {
    if (notchStatus === "opened") return;
    setIsPopping(true);
    if (popTimer.current) clearTimeout(popTimer.current);
    popTimer.current = setTimeout(() => setIsPopping(false), 300);
  }, [notchStatus]);
  return { notchStatus, transitionClass, isPopping, open, close, pop };
}
const WINDOW_W = 740;
const WINDOW_H = 750;
const HOVER_OPEN_DELAY_MS = 200;
const MOUSE_LEAVE_CLOSE_DELAY_MS = 300;
const CLOSE_WINDOW_RESIZE_DELAY_MS = 300;
// 唤醒热区在胶囊两侧各留的容错余量（pt）。
const HOTSPOT_SIDE_PADDING_PX = 48;
const OPEN_WINDOW_SHADOW_MARGIN_PX = 32;
// 贴边轮廓：与屏幕边缘相接处的内凹半径，以及自由端的凸圆角半径。
const DOCK_CONCAVE_R = 14;
const DOCK_CONVEX_R = 14;
function IslandApp() {
  useIslandState();
  const {
    sessions,
    notchInfo,
    surface,
    openReason,
    notificationAutoDismiss,
    clearSurface,
    presentSurface,
    agentQuotas,
    hasUpdate
  } = useSessionStore();
  const onboardingExpand = useSessionStore((s) => s.onboardingExpand);
  const setOnboardingExpand = useSessionStore((s) => s.setOnboardingExpand);
  const toggleExpandTick = useSessionStore((s) => s.toggleExpandTick);
  const collapseTick = useSessionStore((s) => s.collapseTick);
  const switchSessionTick = useSessionStore((s) => s.switchSessionTick);
  const switchSessionDirection = useSessionStore((s) => s.switchSessionDirection);
  const { notchStatus, transitionClass, isPopping, open, close } = useIslandAnimation();
  const panelLayerRef = reactExports.useRef(null);
  const [panelHeight, setPanelHeight] = reactExports.useState(300);
  // dock 状态完全由主进程给定：{placement, edge, mode}。
  // 渲染层不自行推断形状 —— 窗口尺寸和这里画的形状必须同源，
  // 各算各的正是此前「看不见 / 长条 / 竖侧边栏」的共同成因。
  const [dock, setDock] = reactExports.useState({ placement: "notch", edge: "right", mode: "notch" });
  reactExports.useEffect(() => {
    window.islandBridge?.onPlacement?.((d) => d && setDock(d));
    // 主动拉一次：did-finish-load 的补发与 React 挂载之间仍有空隙，
    // 落在空隙里的那一次推送会丢。
    void window.islandBridge?.getPlacement?.().then((d) => d && setDock(d)).catch(() => {});
  }, []);
  const isDocked = dock.placement === "docked";
  const isSideDock = isDocked && dock.edge !== "top";
  const isDragging = isDocked && dock.mode === "dragging";
  const [winSize, setWinSize] = reactExports.useState([window.innerWidth, window.innerHeight]);
  reactExports.useEffect(() => {
    const onResize = () => setWinSize([window.innerWidth, window.innerHeight]);
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // 主进程一旦进入拖动形态，渲染层必须同步收起：窗口已经缩成 56×56 小方块，
  // 若渲染层还在画展开面板，就又回到了「窗口与形状不同源」的老问题。
  // Command + 拖动 = 移动贴边岛。
  // 用 window 捕获阶段监听，而不是铺一层覆盖 div：覆盖层会连带吃掉面板内部的
  // 点击，正是前两版「拖不动又点不了」的成因。按住 Command 才拦截，其余情况
  // 事件原样流向面板内容。
  reactExports.useEffect(() => {
    if (!isDocked) return;
    const onDown = (e) => {
      if (!e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      window.islandBridge?.dragStart?.();
      const onUp = () => {
        window.removeEventListener("mouseup", onUp, true);
        window.islandBridge?.dragEnd?.();
      };
      window.addEventListener("mouseup", onUp, true);
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [isDocked]);
  reactExports.useEffect(() => {
    if (!isDragging) return;
    if (hoverOpenTimer.current) {
      clearTimeout(hoverOpenTimer.current);
      hoverOpenTimer.current = null;
    }
    useSessionStore.getState().requestCollapse();
  }, [isDragging]);
  const [mounted, setMounted] = reactExports.useState(false);
  const autoCollapseTimer = reactExports.useRef(null);
  const attentionNotifTimer = reactExports.useRef(null);
  const hoverOpenTimer = reactExports.useRef(null);
  const mouseLeaveCloseTimer = reactExports.useRef(
    null
  );
  const warmupCloseTimerRef = reactExports.useRef(
    null
  );
  const resizeWindowTimerRef = reactExports.useRef(
    null
  );
  const collapsePanelToPillTimerRef = reactExports.useRef(
    null
  );
  const isFollowUpActiveRef = reactExports.useRef(false);
  const pendingFollowUpDismissRef = reactExports.useRef(false);
  const focusLossHandledRef = reactExports.useRef(false);
  const handleFollowUpChange = reactExports.useCallback((active) => {
    isFollowUpActiveRef.current = active;
    if (active && autoCollapseTimer.current) {
      clearTimeout(autoCollapseTimer.current);
      autoCollapseTimer.current = null;
    }
  }, []);
  const [panelMaxHeightPx, setPanelMaxHeightPx] = reactExports.useState(ISLAND_PANEL_MAX_HEIGHT_DEFAULT_PX);
  const [pillFirstRow, setPillFirstRow] = reactExports.useState(DEFAULT_SETTINGS.pillFirstRow);
  const [hoverToOpen, setHoverToOpen] = reactExports.useState(DEFAULT_SETTINGS.hoverToOpen);
  const [autoCollapseOnMouseLeave, setAutoCollapseOnMouseLeave] = reactExports.useState(DEFAULT_SETTINGS.autoCollapseOnMouseLeave);
  const [showUsageQuota, setShowUsageQuota] = reactExports.useState(DEFAULT_SETTINGS.showUsageQuota);
  const [tokenBurnTotal, setTokenBurnTotal] = reactExports.useState(0);
  const [autoCollapseDurationMs, setAutoCollapseDurationMs] = reactExports.useState(
    DEFAULT_SETTINGS.completionPopupDurationSec * 1e3
  );
  reactExports.useEffect(() => {
    window.islandBridge?.getStatsSnapshot("today").then((snap) => {
      if (snap) {
        setTokenBurnTotal(snap.totalInputTokens + snap.totalOutputTokens + snap.totalCacheReadTokens + snap.totalCacheCreationTokens);
      }
    });
    const offBurn = window.islandBridge?.onTodayBurnUpdate((total) => {
      setTokenBurnTotal(total);
    });
    window.islandBridge?.getSettings().then((s) => {
      setAutoCollapseDurationMs(s.completionPopupDurationSec * 1e3);
      setPillFirstRow(s.pillFirstRow);
      setHoverToOpen(s.hoverToOpen);
      setAutoCollapseOnMouseLeave(s.autoCollapseOnMouseLeave);
      setShowUsageQuota(s.showUsageQuota);
    });
    const offSettings = window.islandBridge?.onSettingsChanged((s) => {
      setAutoCollapseDurationMs(s.completionPopupDurationSec * 1e3);
      setPillFirstRow(s.pillFirstRow);
      setHoverToOpen(s.hoverToOpen);
      setAutoCollapseOnMouseLeave(s.autoCollapseOnMouseLeave);
      setShowUsageQuota(s.showUsageQuota);
    });
    return () => {
      offBurn?.();
      offSettings?.();
    };
  }, []);
  reactExports.useEffect(() => {
    let mounted2 = true;
    const bridge = window.islandBridge;
    if (!bridge?.getSettings) return;
    bridge.getSettings().then((settings) => {
      if (!mounted2) return;
      setPanelMaxHeightPx(clampPanelMaxHeightPx(settings.panelMaxHeightPx));
    }).catch(() => {
      if (!mounted2) return;
      setPanelMaxHeightPx(ISLAND_PANEL_MAX_HEIGHT_DEFAULT_PX);
    });
    const unsubscribe = bridge.onSettingsChanged?.((settings) => {
      if (!mounted2) return;
      setPanelMaxHeightPx(clampPanelMaxHeightPx(settings.panelMaxHeightPx));
    });
    return () => {
      mounted2 = false;
      unsubscribe?.();
    };
  }, []);
  reactExports.useEffect(() => {
    setMounted(true);
  }, []);
  reactExports.useEffect(() => {
    if (!mounted) return;
    const warmupStartTimer = setTimeout(() => {
      open();
      warmupCloseTimerRef.current = setTimeout(() => {
        close();
      }, 600);
    }, 100);
    return () => {
      clearTimeout(warmupStartTimer);
      if (warmupCloseTimerRef.current)
        clearTimeout(warmupCloseTimerRef.current);
    };
  }, [mounted]);
  reactExports.useEffect(() => {
    const rendererClosedState = {
      notchHeight: notchInfo.hasNotch ? notchInfo.notchHeight : notchInfo.menuBarHeight > 0 && notchInfo.menuBarHeight < 40 ? notchInfo.menuBarHeight : 24,
      notchWidth: notchInfo.hasNotch ? notchInfo.notchWidth : 126
    };
    if (!notchInfo.hasNotch) {
      console.warn(
        "[notch-diagnostics][renderer:IslandApp] hasNotch=false, using no-notch fallback dimensions",
        {
          notchInfo,
          rendererClosedState
        }
      );
    }
  }, [notchInfo]);
  reactExports.useEffect(() => {
    return () => {
      if (hoverOpenTimer.current) clearTimeout(hoverOpenTimer.current);
      if (mouseLeaveCloseTimer.current)
        clearTimeout(mouseLeaveCloseTimer.current);
      if (attentionNotifTimer.current)
        clearTimeout(attentionNotifTimer.current);
      if (resizeWindowTimerRef.current)
        clearTimeout(resizeWindowTimerRef.current);
      if (collapsePanelToPillTimerRef.current)
        clearTimeout(collapsePanelToPillTimerRef.current);
    };
  }, []);
  reactExports.useEffect(() => {
    const handleWindowBlur = () => {
      const followUpFocused = isFollowUpActiveRef.current
        && document.activeElement?.closest?.("[data-follow-up-input]");
      // 失焦即隐身——不再受 autoCollapseOnMouseLeave 开关阻断。该开关的旧语义
      // （收起成胶囊）与"完全隐身"诉求冲突：开关关闭时旧逻辑完全不隐藏，岛会
      // 常驻成黑胶囊。这里只要可见且非 follow-up 输入聚焦就隐身。
      const shouldCollapse = shouldCollapseOnFocusLoss({
        isVisible: mounted,
        enabled: true,
        followUpFocused
      });
      if (!shouldCollapse) {
        focusLossHandledRef.current = false;
        if (followUpFocused) pendingFollowUpDismissRef.current = true;
        return;
      }
      // Electron's native blur and the DOM blur can arrive for the same focus
      // transition; collapse once to avoid duplicate surface acknowledgements.
      if (focusLossHandledRef.current) return;
      focusLossHandledRef.current = true;
      pendingFollowUpDismissRef.current = false;
      if (resolveFocusLossPresentation({ isVisible: mounted, followUpFocused }) !== "pill") return;
      // 普通失焦只收成默认胶囊，保持左侧角色可见。
      clearSurface();
      close();
      window.islandBridge?.surfaceDismissed();
    };
    const handleWindowFocus = () => {
      focusLossHandledRef.current = false;
    };
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("workisland-window-blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);
    return () => {
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("workisland-window-blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [close, clearSurface, mounted]);
  const collapsePanelToPill = reactExports.useCallback(() => {
    if (mouseLeaveCloseTimer.current) {
      clearTimeout(mouseLeaveCloseTimer.current);
      mouseLeaveCloseTimer.current = null;
    }
    if (autoCollapseTimer.current) {
      clearTimeout(autoCollapseTimer.current);
      autoCollapseTimer.current = null;
    }
    if (attentionNotifTimer.current) {
      clearTimeout(attentionNotifTimer.current);
      attentionNotifTimer.current = null;
    }
    if (hoverOpenTimer.current) {
      clearTimeout(hoverOpenTimer.current);
      hoverOpenTimer.current = null;
    }
    if (collapsePanelToPillTimerRef.current) {
      clearTimeout(collapsePanelToPillTimerRef.current);
      collapsePanelToPillTimerRef.current = null;
    }
    window.islandBridge?.leaveIsland();
    close();
    clearSurface();
    window.islandBridge?.surfaceDismissed();
  }, [close, clearSurface]);
  const notchStatusRef = reactExports.useRef(notchStatus);
  reactExports.useEffect(() => {
    const prev = notchStatusRef.current;
    notchStatusRef.current = notchStatus;
    if (notchStatus === "opened" && prev !== "opened") {
      window.islandBridge?.panelExpanded();
    } else if (notchStatus !== "opened" && prev === "opened") {
      window.islandBridge?.panelCollapsed();
    }
  }, [notchStatus]);
  const handleOpenSettings = reactExports.useCallback((tab) => {
    if (tab) {
      window.islandBridge?.openSettingsTab(tab);
    } else {
      window.islandBridge?.openSettings();
    }
    if (collapsePanelToPillTimerRef.current) {
      clearTimeout(collapsePanelToPillTimerRef.current);
    }
    collapsePanelToPillTimerRef.current = setTimeout(() => {
      collapsePanelToPill();
      collapsePanelToPillTimerRef.current = null;
    }, 150);
  }, [collapsePanelToPill]);
  const handleOpenAbout = reactExports.useCallback(() => {
    window.islandBridge?.openAbout();
    if (collapsePanelToPillTimerRef.current) {
      clearTimeout(collapsePanelToPillTimerRef.current);
    }
    collapsePanelToPillTimerRef.current = setTimeout(() => {
      collapsePanelToPill();
      collapsePanelToPillTimerRef.current = null;
    }, 150);
  }, [collapsePanelToPill]);
  reactExports.useLayoutEffect(() => {
    const el = panelLayerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      if (el.scrollHeight > 0) setPanelHeight(el.scrollHeight);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  reactExports.useEffect(() => {
    if (!surface) return;
    if (mouseLeaveCloseTimer.current) {
      clearTimeout(mouseLeaveCloseTimer.current);
      mouseLeaveCloseTimer.current = null;
    }
    if (attentionNotifTimer.current) {
      clearTimeout(attentionNotifTimer.current);
      attentionNotifTimer.current = null;
    }
    if (collapsePanelToPillTimerRef.current) {
      clearTimeout(collapsePanelToPillTimerRef.current);
      collapsePanelToPillTimerRef.current = null;
    }
    open();
    const focusedSession = (surface.type === "sessionList" || surface.type === "completion") && surface.actionableSessionId ? sessions.find((s) => s.id === surface.actionableSessionId) : void 0;
    if ((surface.type === "sessionList" || surface.type === "completion") && surface.actionableSessionId && !focusedSession) {
      close();
      clearSurface();
      window.islandBridge?.surfaceDismissed();
      return;
    }
    return () => {
      if (attentionNotifTimer.current) clearTimeout(attentionNotifTimer.current);
    };
  }, [surface, sessions]);
  // 通知自动收起计时器：只在 surface 变化时设定一次，不依赖 sessions。
  // 旧逻辑把计时器放在 [surface, sessions] 依赖的 effect 里，导致任务运行期间
  // 每次 session 更新（每秒多次）都重置 5 秒计时器，surface 一直不收起，
  // "时间抓不住"。现在 surface 一旦弹出就稳定倒数 autoCollapseDurationMs。
  reactExports.useEffect(() => {
    if (!surface) return;
    if (openReason !== "notification" || !notificationAutoDismiss) return;
    if (isFollowUpActiveRef.current) return;
    if (autoCollapseTimer.current) clearTimeout(autoCollapseTimer.current);
    autoCollapseTimer.current = setTimeout(() => {
      autoCollapseTimer.current = null;
      clearSurface();
      close();
      window.islandBridge?.surfaceDismissed();
    }, autoCollapseDurationMs);
    return () => {
      if (autoCollapseTimer.current) clearTimeout(autoCollapseTimer.current);
    };
  }, [surface, openReason, notificationAutoDismiss, autoCollapseDurationMs, close, clearSurface]);
  reactExports.useEffect(() => {
    if (!onboardingExpand) return;
    setOnboardingExpand(false);
  }, [onboardingExpand]);
  const notchH = notchInfo.hasNotch ? notchInfo.notchHeight : notchInfo.menuBarHeight > 0 && notchInfo.menuBarHeight < 40 ? notchInfo.menuBarHeight : 24;
  const notchW = notchInfo.hasNotch ? notchInfo.notchWidth : 126;
  const hasAttention = sessions.some((s) => requiresAttention(s.phase));
  const visibleCount = sessions.filter(isVisibleInIsland).length;
  const phase = dominantPhase(sessions);
  const closedTopR = 8;
  const closedBottomR = 10;
  const openedTopR = 24;
  const openedBottomR = 18;
  const maxPillBodyWidth = getIslandMaxBodyWidth({
    bottomRadius: closedBottomR,
    topRadius: closedTopR,
    windowWidth: WINDOW_W
  });
  const maxPanelBodyWidth = getIslandMaxBodyWidth({
    bottomRadius: openedBottomR,
    topRadius: openedTopR,
    windowWidth: WINDOW_W
  });
  function getPillExtra() {
    let extra;
    if (notchInfo.hasNotch) {
      extra = visibleCount > 0 ? 72 : 62;
    } else if (visibleCount === 0 || phase === null) {
      extra = 72;
    } else {
      switch (phase) {
        case "waitingForApproval":
        case "waitingForAnswer":
          extra = 108;
          break;
        case "completed":
          extra = 112;
          break;
        case "running":
          extra = 100;
          break;
        default: {
          extra = 100;
        }
      }
    }
    return extra;
  }
  const pillExtra = getPillExtra();
  const pillWidth = Math.min(Math.max(notchW, 126) + pillExtra, maxPillBodyWidth);
  const desiredPanelWidth = notchInfo.screenWidth > 0 ? Math.max(680, Math.min(740, notchInfo.screenWidth * 0.46)) : 680;
  const panelWidth = Math.min(desiredPanelWidth, maxPanelBodyWidth);
  const isOpen = notchStatus === "opened";
  const actualPanelH = Math.max(
    notchH + 40,
    Math.min(panelHeight, WINDOW_H - 10)
  );
  const maxExpandedWindowHeight = Math.min(
    WINDOW_H,
    panelMaxHeightPx + OPEN_WINDOW_SHADOW_MARGIN_PX
  );
  reactExports.useEffect(() => {
    const bridge = window.islandBridge;
    if (!bridge?.resizeWindow) return;
    if (resizeWindowTimerRef.current) {
      clearTimeout(resizeWindowTimerRef.current);
      resizeWindowTimerRef.current = null;
    }
    if (notchStatus === "opened" || transitionClass === "is-opening") {
      bridge.resizeWindow(maxExpandedWindowHeight);
      // 兜底：展开动画结束后再确认一次高度。
      // 若有迟到的收起同步在 PANEL_EXPANDED 之前把窗口压矮了，这里会把它拉回来；
      // 否则本 effect 在面板稳定展开后不再重跑，窗口会一直卡在收起高度上。
      const confirm = setTimeout(() => {
        bridge.resizeWindow(maxExpandedWindowHeight);
      }, 340);
      return () => clearTimeout(confirm);
    }
    const delay = transitionClass === "is-closing" ? CLOSE_WINDOW_RESIZE_DELAY_MS : 0;
    resizeWindowTimerRef.current = setTimeout(() => {
      bridge.syncClosedWindow?.();
      resizeWindowTimerRef.current = null;
    }, delay);
    return () => {
      if (resizeWindowTimerRef.current) {
        clearTimeout(resizeWindowTimerRef.current);
        resizeWindowTimerRef.current = null;
      }
    };
  }, [maxExpandedWindowHeight, notchStatus, transitionClass]);
  const closedShape = getIslandClipShape({
    bodyWidth: pillWidth,
    bottom: notchH,
    bottomRadius: closedBottomR,
    topRadius: closedTopR,
    windowWidth: WINDOW_W
  });
  const openedShape = getIslandClipShape({
    bodyWidth: panelWidth,
    bottom: actualPanelH,
    bottomRadius: openedBottomR,
    topInset: 8,
    topRadius: openedTopR,
    windowWidth: WINDOW_W
  });
  const notchClip = mounted ? isOpen ? openedShape.clipPath : closedShape.clipPath : closedShape.clipPath;
  // 贴边态的两个形状：条形与面板形，同一（面板大小的）窗口坐标系下生成，
  // 路径指令结构一致，CSS clip-path 过渡可以直接插值 —— 形变全在渲染层，
  // 窗口 bounds 不动，这正是刘海模式丝滑的原因。
  const dockClips = reactExports.useMemo(() => {
    if (!isDocked || isDragging || !dock.strip) return null;
    const [w, h] = winSize;
    const top = dock.edge === "top";
    const span = top ? w : h;
    const strip = buildDockClipPath({
      edge: dock.edge,
      winW: w,
      winH: h,
      bodyLen: Math.max(0, dock.strip.len - 2 * DOCK_CONCAVE_R),
      depth: dock.strip.depth,
      concaveR: DOCK_CONCAVE_R,
      convexR: DOCK_CONVEX_R,
      spanStart: dock.strip.spanOffset
    });
    const panelDepth = top ? Math.min(actualPanelH + 8, h) : w;
    // 侧边面板的纵向跨度跟随内容高度：内容短时不至于拖一大块空黑到屏幕下方。
    const panelSpan = top ? span : Math.max(dock.strip.len, Math.min(panelHeight + 16, span));
    const panel = buildDockClipPath({
      edge: dock.edge,
      winW: w,
      winH: h,
      bodyLen: Math.max(0, panelSpan - 2 * DOCK_CONCAVE_R),
      depth: panelDepth,
      concaveR: DOCK_CONCAVE_R,
      convexR: DOCK_CONVEX_R,
      spanStart: 0
    });
    return { strip, panel };
  }, [isDocked, isDragging, dock, winSize, actualPanelH, panelHeight]);
  const clipPath = isDocked
    ? isDragging ? "none" : dockClips ? (mounted && isOpen ? dockClips.panel : dockClips.strip) : "none"
    : notchClip;
  const transition = mounted ? transitionClass : "";
  /**
   * 全宽热区的进入处理：只负责「唤醒」，不负责「展开」。
   *
   * 两件事必须分开：唤醒是把隐身的胶囊显形，热区应该宽松；展开是打开整个面板，
   * 必须精确命中胶囊本体。若热区复用 handleMouseEnter，它里面的 hoverToOpen 分支
   * 会让鼠标扫过屏幕顶部就展开面板 —— 用菜单栏时会被反复误触发。
   */
  const handleHotspotEnter = reactExports.useCallback(() => {
    window.islandBridge?.enterIsland();
  }, []);
  const handleHotspotLeave = reactExports.useCallback(() => {
    window.islandBridge?.leaveIsland();
  }, []);
  const handleMouseEnter = reactExports.useCallback((e) => {
    if (mouseLeaveCloseTimer.current) {
      clearTimeout(mouseLeaveCloseTimer.current);
      mouseLeaveCloseTimer.current = null;
    }
    pendingFollowUpDismissRef.current = false;
    if (autoCollapseTimer.current) clearTimeout(autoCollapseTimer.current);
    if (attentionNotifTimer.current) {
      clearTimeout(attentionNotifTimer.current);
      attentionNotifTimer.current = null;
    }
    if (resizeWindowTimerRef.current) {
      clearTimeout(resizeWindowTimerRef.current);
      resizeWindowTimerRef.current = null;
    }
    window.islandBridge?.enterIsland();
    if (hoverToOpen && notchStatus === "closed") {
      window.islandBridge?.triggerHaptic();
      hoverOpenTimer.current = setTimeout(() => {
        if (!surface) presentSurface({ type: "sessionList" }, "hover");
        open();
      }, HOVER_OPEN_DELAY_MS);
    }
  }, [hoverToOpen, notchStatus, open, presentSurface, surface, isDocked]);
  const handleMouseLeave = reactExports.useCallback(() => {
    if (hoverOpenTimer.current) {
      clearTimeout(hoverOpenTimer.current);
      hoverOpenTimer.current = null;
    }
    window.islandBridge?.leaveIsland();
    // 鼠标离开后收成默认胶囊，保持左侧角色可见。
    if (!isOpen) return;
    const isFollowUpFocused = isFollowUpActiveRef.current && document.hasFocus() && document.activeElement?.closest("[data-follow-up-input]");
    if (isFollowUpFocused) {
      pendingFollowUpDismissRef.current = true;
      return;
    }
    mouseLeaveCloseTimer.current = setTimeout(() => {
      clearSurface();
      close();
      window.islandBridge?.surfaceDismissed();
    }, MOUSE_LEAVE_CLOSE_DELAY_MS);
  }, [isOpen, close, clearSurface]);
  const handlePillClick = reactExports.useCallback(() => {
    if (hoverOpenTimer.current) {
      clearTimeout(hoverOpenTimer.current);
      hoverOpenTimer.current = null;
    }
    if (collapsePanelToPillTimerRef.current) {
      clearTimeout(collapsePanelToPillTimerRef.current);
      collapsePanelToPillTimerRef.current = null;
    }
    if (!surface) presentSurface({ type: "sessionList" }, "click");
    open();
  }, [open, presentSurface, surface]);
  const handlePetButtonClick = reactExports.useCallback((event) => {
    event.stopPropagation();
    if (hoverOpenTimer.current) {
      clearTimeout(hoverOpenTimer.current);
      hoverOpenTimer.current = null;
    }
    const screenX = event.screenX > 0 ? event.screenX : window.screenX + window.innerWidth / 2;
    const screenY = event.screenY > 0 ? event.screenY + 64 : window.screenY + 80;
    window.islandBridge?.triggerHaptic();
    window.islandBridge?.dragToPet(screenX, screenY);
  }, []);
  const toggleExpandLatest = reactExports.useRef({ notchStatus, collapsePanelToPill, handlePillClick });
  toggleExpandLatest.current = { notchStatus, collapsePanelToPill, handlePillClick };
  reactExports.useEffect(() => {
    if (toggleExpandTick === 0) return;
    const { notchStatus: ns, collapsePanelToPill: collapse, handlePillClick: click } = toggleExpandLatest.current;
    if (ns === "opened") {
      collapse();
    } else {
      click();
    }
  }, [toggleExpandTick]);
  reactExports.useEffect(() => {
    if (collapseTick === 0) return;
    collapsePanelToPill();
  }, [collapseTick]);
  reactExports.useEffect(() => {
    if (switchSessionTick === 0) return;
    const visible = sessions.filter(isVisibleInIsland).sort((a, b) => b.updatedAt - a.updatedAt);
    if (visible.length === 0) return;
    const currentId = surface?.type === "sessionList" ? surface.actionableSessionId : void 0;
    const currentIdx = currentId ? visible.findIndex((s) => s.id === currentId) : -1;
    let nextIdx;
    if (currentIdx === -1) {
      nextIdx = switchSessionDirection === "down" ? 0 : visible.length - 1;
    } else {
      nextIdx = switchSessionDirection === "down" ? Math.min(currentIdx + 1, visible.length - 1) : Math.max(currentIdx - 1, 0);
    }
    presentSurface({ type: "sessionList", actionableSessionId: visible[nextIdx].id }, "click");
  }, [switchSessionTick]);
  const confirmSessionTick = useSessionStore((s) => s.confirmSessionTick);
  reactExports.useEffect(() => {
    if (confirmSessionTick === 0) return;
    const actionableId = surface?.type === "sessionList" ? surface.actionableSessionId : void 0;
    if (!actionableId) return;
    window.islandBridge?.jumpToSession(actionableId);
    collapsePanelToPill();
  }, [confirmSessionTick]);
  const handleSessionRowClick = reactExports.useCallback(
    (sessionId) => {
      window.islandBridge?.jumpToSession(sessionId);
      collapsePanelToPill();
    },
    [collapsePanelToPill]
  );
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      // is-morphing：形变进行中。用它在动画期间摘掉 wrapper 上的 drop-shadow，
      // 否则每一帧 clip-path 变化都要把整个窗口大小的子树重新栅格化再模糊一次。
      className: `island-pop-wrapper${isPopping ? " is-popping" : ""}${isOpen || transitionClass === "is-opening" ? " is-open" : ""}${transitionClass === "is-opening" || transitionClass === "is-closing" ? " is-morphing" : ""}`,
      style: { position: "fixed", inset: 0, pointerEvents: "none" }
    },
    /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "island-top-bar",
        style: {
          height: isOpen ? openedTopR : closedTopR,
          left: isOpen ? openedShape.left : closedShape.left,
          width: isOpen ? openedShape.outerWidth : closedShape.outerWidth
        }
      }
    ),
    // 全宽隐形唤醒热区。
    // 此前整个窗口里只有 .island 是 pointer-events:auto，而它被 clip-path 裁成了
    // 胶囊轮廓 —— 于是唤醒热区恰好等于胶囊的可见轮廓，必须精确命中才有反应。
    // 主进程那侧其实早就把窗口铺满屏幕宽度并 setIgnoreMouseEvents(false) 了，
    // 缺的只是渲染层没有对应的可命中区域。展开后撤掉，避免挡住面板自身的交互。
    // notch 下才需要顶部隐形唤醒热区；贴边态是常驻可见的，不需要。
    !isDocked && !isOpen && /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "island-hotspot",
        // 胶囊宽度 + 两侧各 48pt 容错。之前是铺满窗口（740pt，约占屏宽一半）。
        style: {
          width: pillWidth + HOTSPOT_SIDE_PADDING_PX * 2,
          height: Math.max(notchH, 24)
        },
        onMouseEnter: handleHotspotEnter,
        onMouseLeave: handleHotspotLeave
      }
    ),
    /* @__PURE__ */ React.createElement(
      "div",
      {
        className: `island ${transition}${isDocked ? ` is-docked is-dock-${dock.edge} is-dock-${dock.mode}` : ""}`,
        style: { clipPath },
        onMouseEnter: handleMouseEnter,
        onMouseLeave: handleMouseLeave
      },
      /* @__PURE__ */ React.createElement(
        "div",
        {
          className: `island-pill-layer${isOpen ? " is-hidden" : ""}`,
          style: isDocked
            ? isDragging
              ? { left: 0, top: 0, transform: "none", width: "100%", height: "100%" }
              : dock.edge === "top"
                ? { left: dock.strip?.spanOffset ?? 0, top: 0, transform: "none", width: dock.strip?.len ?? 160, height: dock.strip?.depth ?? 44 }
                : {
                    left: dock.edge === "left" ? 0 : "auto",
                    right: dock.edge === "right" ? 0 : "auto",
                    top: dock.strip?.spanOffset ?? 0,
                    transform: "none",
                    width: dock.strip?.depth ?? 44,
                    height: dock.strip?.len ?? 160
                  }
            : { width: pillWidth, height: notchH }
        },
        isDocked && !isDragging && /* @__PURE__ */ React.createElement(
          "div",
          {
            className: `dock-status-dot is-${phase ?? "idle"} dock-dot-${dock.edge}`,
            title: phase ?? "idle"
          }
        ),
        /* @__PURE__ */ React.createElement(
          IslandPill,
          {
            sessions,
            hasAttention,
            hasNotch: notchInfo.hasNotch,
            visibleCount,
            hasUpdate,
            tokenBurnTotal,
            onClick: handlePillClick,
            onUpdateClick: handleOpenAbout
          }
        )
      ),
      /* @__PURE__ */ React.createElement(
        "div",
        {
          ref: panelLayerRef,
          className: `island-panel-layer${isOpen ? "" : " is-hidden"}${isSideDock ? " is-side-dock" : ""}`,
          style: isSideDock
            ? { left: 0, transform: "none", width: winSize[0] }
            : { width: panelWidth }
        },
        /* @__PURE__ */ React.createElement(
          IslandPanel,
          {
            sessions,
            surface,
            notchHeight: notchH,
            panelMaxHeightPx,
            agentQuotas,
            hasUpdate,
            tokenBurnTotal,
            pillFirstRow,
            showUsageQuota,
            onSessionRowClick: handleSessionRowClick,
            onOpenSettings: handleOpenSettings,
            onOpenAbout: handleOpenAbout,
            onOpenPet: handlePetButtonClick,
            onCollapse: collapsePanelToPill,
            onFollowUpChange: handleFollowUpChange
          }
        )
      )
    )
  );
}
void loadPluginAgentMeta(() => window.islandBridge.getPluginAgentMeta());
const root = document.getElementById("root");
ReactDOM.createRoot(root).render(/* @__PURE__ */ React.createElement(IslandApp, null));
