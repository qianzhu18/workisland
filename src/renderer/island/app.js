import "../shared/i18n.js";
import { I as ISLAND_PANEL_MAX_HEIGHT_DEFAULT_PX, D as DEFAULT_SETTINGS, c as clampPanelMaxHeightPx, l as loadPluginAgentMeta } from "../shared/settings.js";
import { r as reactExports, R as React, a as ReactDOM } from "../vendor/react-runtime.js";
import { D as DEFAULT_NOTCH_INFO, r as requiresAttention, d as dominantPhase, I as IslandPill, g as getIslandClipShape, a as getIslandMaxBodyWidth } from "./components/IslandPill.js";
import { c as create } from "../vendor/store.js";
import { I as IslandPanel } from "./components/IslandPanel.js";
import { isVisibleInIsland } from "./session-model.mjs";
import { shouldCollapseOnFocusLoss } from "./focus-policy.mjs";
function shouldAutoDismiss(surface, sessionPhase, sessionTool) {
  if (surface.type !== "sessionList") return false;
  if (!surface.actionableSessionId) return false;
  if (sessionTool === "hermes") return false;
  return sessionPhase === "completed";
}
function isAttentionDismissable(sessionPhase, approvalMode) {
  if (sessionPhase === "waitingForAnswer") return true;
  if (sessionPhase === "waitingForApproval") {
    return approvalMode === "terminalNative";
  }
  return false;
}
const useSessionStore = create((set) => ({
  sessions: [],
  notchInfo: window.islandBridge?.__initialNotchInfo ?? DEFAULT_NOTCH_INFO,
  surface: null,
  openReason: null,
  agentQuotas: {},
  onboardingExpand: false,
  toggleExpandTick: 0,
  collapseTick: 0,
  switchSessionTick: 0,
  switchSessionDirection: "down",
  confirmSessionTick: 0,
  setSessions: (sessions) => set({ sessions }),
  setNotchInfo: (notchInfo) => set({ notchInfo }),
  presentSurface: (surface, openReason) => set({ surface, openReason }),
  clearSurface: () => set({ surface: null, openReason: null }),
  setAgentQuotas: (agentQuotas) => set({ agentQuotas }),
  setOnboardingExpand: (onboardingExpand) => set({ onboardingExpand }),
  requestToggleExpand: () => set((state) => ({ toggleExpandTick: state.toggleExpandTick + 1 })),
  requestCollapse: () => set((state) => ({ collapseTick: state.collapseTick + 1 })),
  requestSwitchSession: (direction) => set((state) => ({ switchSessionTick: state.switchSessionTick + 1, switchSessionDirection: direction })),
  requestConfirmSession: () => set((state) => ({ confirmSessionTick: state.confirmSessionTick + 1 }))
}));
function useIslandState() {
  const { setSessions, setNotchInfo, presentSurface, setAgentQuotas } = useSessionStore();
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
    bridge.onPresentSurface(({ surface, reason }) => {
      presentSurface(surface, reason);
    });
    bridge.onQuotaUpdate((quotas) => setAgentQuotas(quotas));
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
const OPEN_WINDOW_SHADOW_MARGIN_PX = 32;
function IslandApp() {
  useIslandState();
  const {
    sessions,
    notchInfo,
    surface,
    openReason,
    clearSurface,
    presentSurface,
    agentQuotas
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
  const hasUpdate = false;
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
      const shouldCollapse = shouldCollapseOnFocusLoss({
        isVisible: mounted,
        enabled: autoCollapseOnMouseLeave,
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
      close();
      clearSurface();
      window.islandBridge?.hideForFocusLoss?.();
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
  }, [autoCollapseOnMouseLeave, close, clearSurface, mounted]);
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
    const focusedSession = surface.type === "sessionList" && surface.actionableSessionId ? sessions.find((s) => s.id === surface.actionableSessionId) : void 0;
    if (surface.type === "sessionList" && surface.actionableSessionId && !focusedSession) {
      close();
      clearSurface();
      window.islandBridge?.surfaceDismissed();
      return;
    }
    if (shouldAutoDismiss(surface, focusedSession?.phase, focusedSession?.tool) && openReason === "notification" && !sessions.some((s) => requiresAttention(s.phase)) && !isFollowUpActiveRef.current) {
      autoCollapseTimer.current = setTimeout(() => {
        close();
        clearSurface();
        window.islandBridge?.surfaceDismissed();
      }, autoCollapseDurationMs);
    } else if (openReason === "notification" && focusedSession && requiresAttention(focusedSession.phase) && isAttentionDismissable(
      focusedSession.phase,
      focusedSession.permissionRequest?.approvalMode
    )) {
      attentionNotifTimer.current = setTimeout(() => {
        close();
        clearSurface();
        window.islandBridge?.surfaceDismissed();
      }, autoCollapseDurationMs);
    }
    return () => {
      if (autoCollapseTimer.current) clearTimeout(autoCollapseTimer.current);
      if (attentionNotifTimer.current) clearTimeout(attentionNotifTimer.current);
    };
  }, [surface, sessions]);
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
      return void 0;
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
  const clipPath = mounted ? isOpen ? openedShape.clipPath : closedShape.clipPath : closedShape.clipPath;
  const transition = mounted ? transitionClass : "";
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
  }, [hoverToOpen, notchStatus, open, presentSurface, surface]);
  const handleMouseLeave = reactExports.useCallback(() => {
    if (hoverOpenTimer.current) {
      clearTimeout(hoverOpenTimer.current);
      hoverOpenTimer.current = null;
    }
    window.islandBridge?.leaveIsland();
    if (!autoCollapseOnMouseLeave || !isOpen) return;
    const isFollowUpFocused = isFollowUpActiveRef.current && document.hasFocus() && document.activeElement?.closest("[data-follow-up-input]");
    if (isFollowUpFocused) {
      pendingFollowUpDismissRef.current = true;
      return;
    }
    mouseLeaveCloseTimer.current = setTimeout(() => {
      close();
      clearSurface();
      window.islandBridge?.hideForFocusLoss?.();
      window.islandBridge?.surfaceDismissed();
    }, MOUSE_LEAVE_CLOSE_DELAY_MS);
  }, [autoCollapseOnMouseLeave, isOpen, close, clearSurface]);
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
      className: `island-pop-wrapper${isPopping ? " is-popping" : ""}${isOpen || transitionClass === "is-opening" ? " is-open" : ""}`,
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
    /* @__PURE__ */ React.createElement(
      "div",
      {
        className: `island ${transition}`,
        style: { clipPath },
        onMouseEnter: handleMouseEnter,
        onMouseLeave: handleMouseLeave
      },
      /* @__PURE__ */ React.createElement(
        "div",
        {
          className: `island-pill-layer${isOpen ? " is-hidden" : ""}`,
          style: { width: pillWidth, height: notchH }
        },
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
          className: `island-panel-layer${isOpen ? "" : " is-hidden"}`,
          style: { width: panelWidth }
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
