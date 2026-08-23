// 贴边（dock）落位 —— 渲染层附件。
//
// IslandApp 只在几处一行钩子里消费这里的返回值；落位是 notch（默认）时，
// 返回的是一组「空」值（className 为空串、style 为 null），宿主表达式退回原样。
//
// dock 状态完全由主进程给定：{placement, edge, mode, strip}。渲染层不自行推断
// 形状 —— 窗口尺寸和这里画的形状必须同源，各算各的正是此前「看不见 / 长条 /
// 竖侧边栏」的共同成因。
import { r as reactExports, R as React } from "../../vendor/react-runtime.js";
import { b as buildDockClipPath } from "./dock-shape.js";

// 贴边轮廓：与屏幕边缘相接处的内凹半径，以及自由端的凸圆角半径。
const DOCK_CONCAVE_R = 14;
const DOCK_CONVEX_R = 14;

const INACTIVE = Object.freeze({
  active: false,
  dragging: false,
  edge: "right",
  mode: "notch",
  clipPath: null,
  wrapperClass: "",
  islandClass: "",
  pillLayerStyle: null,
  panelLayerClass: "",
  panelLayerStyle: null
});

/**
 * @param mounted / isOpen / transitionClass  宿主的动画状态
 * @param actualPanelH / panelHeight          宿主算出的面板高度（顶部贴边用前者定深度，侧边贴边用后者定跨度）
 * @param hoverOpenTimer                      宿主的 hover 展开计时器 ref（拖动开始时要清掉）
 * @param requestCollapse                     宿主的收起动作（窗口已缩成小方块，渲染层必须同步收起）
 */
function useIslandDock({ mounted, isOpen, transitionClass, actualPanelH, panelHeight, hoverOpenTimer, requestCollapse }) {
  const [dock, setDock] = reactExports.useState({ placement: "notch", edge: "right", mode: "notch" });
  reactExports.useEffect(() => {
    const bridge = window.islandBridge;
    bridge?.onPlacement?.((d) => d && setDock(d));
    // 主动拉一次：did-finish-load 的补发与 React 挂载之间仍有空隙，落在空隙里的那次推送会丢。
    void bridge?.getPlacement?.().then((d) => d && setDock(d)).catch(() => {});
  }, []);
  const active = dock.placement === "docked";
  const dragging = active && dock.mode === "dragging";
  const sideDock = active && dock.edge !== "top";

  // 窗口尺寸：形状在窗口坐标系里生成，窗口在拖动/吸附换边时会变尺寸。只在贴边态监听。
  const [winSize, setWinSize] = reactExports.useState(() => [window.innerWidth, window.innerHeight]);
  reactExports.useEffect(() => {
    if (!active) return;
    const onResize = () => setWinSize([window.innerWidth, window.innerHeight]);
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, [active]);

  // Command + 拖动 = 移动贴边岛。
  // 用 window 捕获阶段监听，而不是铺一层覆盖 div：覆盖层会连带吃掉面板内部的
  // 点击。按住 Command 才拦截，其余情况事件原样流向面板内容。
  reactExports.useEffect(() => {
    if (!active) return;
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
  }, [active]);

  // 主进程一旦进入拖动形态，渲染层必须同步收起：窗口已经缩成 56×56 小方块，
  // 若渲染层还在画展开面板，就又回到了「窗口与形状不同源」的老问题。
  const latest = reactExports.useRef({ hoverOpenTimer, requestCollapse });
  latest.current = { hoverOpenTimer, requestCollapse };
  reactExports.useEffect(() => {
    if (!dragging) return;
    const { hoverOpenTimer: timer, requestCollapse: collapse } = latest.current;
    if (timer?.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    collapse?.();
  }, [dragging]);

  // 贴边态的两个形状：条形与面板形，在同一（面板大小的）窗口坐标系下生成，
  // 路径指令结构一致，CSS clip-path 过渡可以直接插值 —— 形变全在渲染层，
  // 窗口 bounds 不动，这正是刘海模式丝滑的原因。
  const clips = reactExports.useMemo(() => {
    if (!active || dragging || !dock.strip) return null;
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
  }, [active, dragging, dock, winSize, actualPanelH, panelHeight]);

  if (!active) return INACTIVE;
  const strip = dock.strip;
  const pillLayerStyle = dragging
    ? { left: 0, top: 0, transform: "none", width: "100%", height: "100%" }
    : dock.edge === "top"
      ? { left: strip?.spanOffset ?? 0, top: 0, transform: "none", width: strip?.len ?? 160, height: strip?.depth ?? 44 }
      : {
          left: dock.edge === "left" ? 0 : "auto",
          right: dock.edge === "right" ? 0 : "auto",
          top: strip?.spanOffset ?? 0,
          transform: "none",
          width: strip?.depth ?? 44,
          height: strip?.len ?? 160
        };
  return {
    active,
    dragging,
    edge: dock.edge,
    mode: dock.mode,
    clipPath: dragging ? "none" : clips ? (mounted && isOpen ? clips.panel : clips.strip) : "none",
    // 形变期的 drop-shadow 优化沿用上游的 .island-pop-wrapper.is-morphing，
    // 附件不再自造一个同义类名。
    wrapperClass: "",
    islandClass: ` is-docked is-dock-${dock.edge} is-dock-${dock.mode}`,
    pillLayerStyle,
    panelLayerClass: sideDock ? " is-side-dock" : "",
    panelLayerStyle: sideDock ? { left: 0, transform: "none", width: winSize[0] } : null
  };
}

/** 条上的状态点：按会话主相位着色（见 dock.css 的 .dock-status-dot.is-*）。 */
function DockStatusDot({ dock, phase }) {
  if (!dock.active || dock.dragging) return null;
  return React.createElement("div", {
    className: `dock-status-dot is-${phase ?? "idle"} dock-dot-${dock.edge}`,
    title: phase ?? "idle"
  });
}

export { useIslandDock as u, DockStatusDot as D };
