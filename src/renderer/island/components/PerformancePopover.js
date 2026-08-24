import { R as React, b as ReactDOM } from "../../vendor/react-runtime.js";
import { placeFloatingLayer } from "./floating-layer-model.mjs";
import { performanceActionMessage } from "./performance-action-model.mjs";

function bytes(value) {
  return `${(Math.max(0, Number(value) || 0) / 1073741824).toFixed(1)} GB`;
}

export function PerformancePopover({ state }) {
  const [hovered, setHovered] = React.useState(false);
  const [pinned, setPinned] = React.useState(false);
  const [position, setPosition] = React.useState({ left: 12, top: 12 });
  const [selectedProcess, setSelectedProcess] = React.useState(null);
  const [pendingAction, setPendingAction] = React.useState("");
  const [feedback, setFeedback] = React.useState("");
  const triggerRef = React.useRef(null);
  const popoverRef = React.useRef(null);
  const closeTimer = React.useRef(null);
  const visible = hovered || pinned;
  const cancelClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const open = () => { cancelClose(); setHovered(true); };
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setHovered(false), 140);
  };
  React.useLayoutEffect(() => {
    if (!visible || !triggerRef.current) return undefined;
    const updatePosition = () => {
      const anchor = triggerRef.current.getBoundingClientRect();
      const layer = popoverRef.current?.getBoundingClientRect() || { width: 246, height: 300 };
      setPosition(placeFloatingLayer(anchor, { width: window.innerWidth, height: window.innerHeight }, layer));
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [visible, state?.processes?.length, selectedProcess?.pid, feedback]);
  React.useEffect(() => {
    window.islandBridge?.setPerformanceDetailsVisible?.(visible);
    return () => window.islandBridge?.setPerformanceDetailsVisible?.(false);
  }, [visible]);
  const cpu = Math.round(Number(state?.cpuPct) || 0);
  const memory = Math.round(Number(state?.memoryPct) || 0);
  const level = cpu >= 85 || memory >= 90 ? "critical" : cpu >= 65 || memory >= 75 ? "warning" : "normal";
  const actOnProcess = async (action) => {
    if (!selectedProcess || pendingAction) return;
    setPendingAction(action);
    setFeedback("");
    try {
      const result = await window.islandBridge?.actOnProcess?.({ ...selectedProcess, action });
      setFeedback(performanceActionMessage(result));
      if (result?.ok) setSelectedProcess(null);
    } catch {
      setFeedback(performanceActionMessage({ ok: false, reason: "failed" }));
    } finally {
      setPendingAction("");
    }
  };
  const popover = visible && React.createElement("div", { ref: popoverRef, className: "performance-popover", role: "dialog", "aria-label": "性能详情", style: { left: `${position.left}px`, top: `${position.top}px` }, onMouseEnter: open, onMouseLeave: closeSoon },
    React.createElement("div", { className: "performance-popover-header" }, React.createElement("strong", null, "系统性能"), React.createElement("span", null, pinned ? "已固定" : "实时")),
    React.createElement("div", { className: "performance-metrics" },
      React.createElement("div", { className: "performance-metric" }, React.createElement("span", null, "CPU"), React.createElement("strong", null, `${cpu}%`), React.createElement("i", { style: { "--value": `${cpu}%` } })),
      React.createElement("div", { className: "performance-metric" }, React.createElement("span", null, "内存"), React.createElement("strong", null, `${memory}%`), React.createElement("i", { style: { "--value": `${memory}%` } }))
    ),
    React.createElement("div", { className: "performance-memory" }, `${bytes(state?.memoryUsedBytes)} / ${bytes(state?.memoryTotalBytes)}`),
    state?.processes?.length > 0 && React.createElement("div", { className: "performance-processes" },
      React.createElement("div", { className: "performance-process-title" }, "高占用进程"),
      state.processes.slice(0, 5).map((process) => React.createElement("button", { type: "button", className: `performance-process${selectedProcess?.pid === process.pid ? " is-selected" : ""}`, key: process.pid, onClick: () => { setSelectedProcess(process); setFeedback(""); setPinned(true); }, "aria-label": `管理进程 ${process.name}` }, React.createElement("span", { title: process.name }, process.name), React.createElement("strong", null, `${process.cpuPct.toFixed(1)}%`))),
      selectedProcess && React.createElement("div", { className: "performance-process-confirm" },
        React.createElement("div", null, React.createElement("strong", null, selectedProcess.name), React.createElement("span", null, `PID ${selectedProcess.pid}`)),
        React.createElement("p", null, "要退出这个进程吗？未保存的数据可能丢失。"),
        React.createElement("div", { className: "performance-process-actions" },
          React.createElement("button", { type: "button", disabled: Boolean(pendingAction), onClick: () => { setSelectedProcess(null); setFeedback(""); } }, "取消"),
          React.createElement("button", { type: "button", disabled: Boolean(pendingAction), onClick: () => actOnProcess("terminate") }, pendingAction === "terminate" ? "正在退出…" : "退出"),
          React.createElement("button", { type: "button", className: "is-destructive", disabled: Boolean(pendingAction), onClick: () => actOnProcess("force") }, pendingAction === "force" ? "正在强制退出…" : "强制退出")
        )
      ),
      feedback && React.createElement("div", { className: "performance-process-feedback", role: "status" }, feedback)
    )
  );
  return React.createElement("div", { ref: triggerRef, className: "performance-control", onMouseEnter: open, onMouseLeave: closeSoon },
    React.createElement("button", { type: "button", className: `panel-btn performance-button is-${level}${pinned ? " is-pinned" : ""}`, onClick: () => setPinned((value) => !value), "aria-expanded": visible, "aria-label": "性能监视器", title: "性能监视器" },
      React.createElement("span", { className: "performance-gauge", style: { "--load": `${Math.max(cpu, memory)}%` } }),
      React.createElement("span", { className: "performance-mini" }, `${cpu}%`)
    ),
    popover && ReactDOM.createPortal(popover, document.body)
  );
}
