import { R as React, b as ReactDOM } from "../../vendor/react-runtime.js";
import { t } from "../../shared/i18n.js";
import { placeFloatingLayer } from "./floating-layer-model.mjs";
import { performanceActionMessage } from "./performance-action-model.mjs";
import { formatProcessMemory, preferredProcessMetric, sortProcessesByMetric } from "./performance-process-model.mjs";

function bytes(value) {
  return `${(Math.max(0, Number(value) || 0) / 1073741824).toFixed(1)} GB`;
}

export function PerformancePopover({ state, labelled = false }) {
  const [hovered, setHovered] = React.useState(false);
  const [position, setPosition] = React.useState({ left: 12, top: 12 });
  const [selectedProcess, setSelectedProcess] = React.useState(null);
  const [selectedMetric, setSelectedMetric] = React.useState("");
  const [showAllProcesses, setShowAllProcesses] = React.useState(false);
  const [pendingAction, setPendingAction] = React.useState("");
  const [feedback, setFeedback] = React.useState("");
  const triggerRef = React.useRef(null);
  const popoverRef = React.useRef(null);
  const closeTimer = React.useRef(null);
  const visible = hovered;
  const cancelClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const open = () => { if (document.documentElement.hasAttribute('data-toolbar-dragging')) return; cancelClose(); setHovered(true); };
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setHovered(false), 350);
  };
  React.useEffect(() => {
    const close = (event) => {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "pointerdown" && (triggerRef.current?.contains(event.target) || popoverRef.current?.contains(event.target))) return;
      cancelClose(); setHovered(false); setSelectedProcess(null);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("workisland:toolbar-drag-start", close);
    return () => {
      cancelClose();
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("workisland:toolbar-drag-start", close);
    };
  }, []);
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
  }, [visible, state?.processes?.length, selectedProcess?.pid, selectedMetric, showAllProcesses, feedback]);
  React.useEffect(() => {
    window.islandBridge?.setPerformanceDetailsVisible?.(visible);
    return () => window.islandBridge?.setPerformanceDetailsVisible?.(false);
  }, [visible]);
  const cpu = Math.round(Number(state?.cpuPct) || 0);
  const memory = Math.round(Number(state?.memoryPct) || 0);
  const metric = selectedMetric || preferredProcessMetric(state);
  const orderedProcesses = sortProcessesByMetric(state?.processes, metric);
  const visibleProcesses = showAllProcesses ? orderedProcesses : orderedProcesses.slice(0, 5);
  const processStatus = state?.processesLoading
    ? t("performance.process.loading")
    : state?.processesUnavailable
      ? t("performance.process.unavailable")
      : state?.processesLoaded
        ? t("performance.process.empty")
        : t("performance.process.loading");
  const level = cpu >= 85 || memory >= 90 ? "critical" : cpu >= 65 || memory >= 75 ? "warning" : "normal";
  const actOnProcess = async (action) => {
    if (!selectedProcess || pendingAction) return;
    setPendingAction(action);
    setFeedback("");
    try {
      const result = await window.islandBridge?.actOnProcess?.({ ...selectedProcess, action });
      setFeedback(t(performanceActionMessage(result)));
      if (result?.ok) setSelectedProcess(null);
    } catch {
      setFeedback(t(performanceActionMessage({ ok: false, reason: "failed" })));
    } finally {
      setPendingAction("");
    }
  };
  const popover = visible && React.createElement("div", { ref: popoverRef, className: "performance-popover", role: "dialog", "aria-label": t("performance.details"), style: { left: `${position.left}px`, top: `${position.top}px` }, onMouseEnter: open, onMouseLeave: closeSoon },
    React.createElement("div", { className: "performance-popover-header" }, React.createElement("strong", null, t("performance.system")), React.createElement("span", null, t("performance.realtime"))),
    React.createElement("div", { className: "performance-metrics" },
      React.createElement("button", { type: "button", className: `performance-metric${metric === "cpu" ? " is-active" : ""}`, onClick: () => setSelectedMetric("cpu"), "aria-pressed": metric === "cpu", title: t("performance.sort.cpu") }, React.createElement("span", null, "CPU"), React.createElement("strong", null, `${cpu}%`), React.createElement("i", { style: { "--value": `${cpu}%` } })),
      React.createElement("button", { type: "button", className: `performance-metric${metric === "memory" ? " is-active" : ""}`, onClick: () => setSelectedMetric("memory"), "aria-pressed": metric === "memory", title: t("performance.sort.memory") }, React.createElement("span", null, t("performance.memory")), React.createElement("strong", null, `${memory}%`), React.createElement("i", { style: { "--value": `${memory}%` } }))
    ),
    React.createElement("div", { className: "performance-memory" }, `${bytes(state?.memoryUsedBytes)} / ${bytes(state?.memoryTotalBytes)}`),
    orderedProcesses.length === 0 && React.createElement("div", { className: "performance-process-status", role: "status" }, processStatus),
    state?.processes?.length > 0 && React.createElement("div", { className: "performance-processes" },
      React.createElement("div", { className: "performance-process-title" }, React.createElement("span", null, t(metric === "memory" ? "performance.sort.memory" : "performance.sort.cpu")), React.createElement("span", null, t("performance.process.count", { count: orderedProcesses.length }))),
      React.createElement("div", { className: `performance-process-list${showAllProcesses ? " is-expanded" : ""}` },
        visibleProcesses.map((process) => React.createElement("button", { type: "button", disabled: Boolean(process.protected), className: `performance-process${selectedProcess?.pid === process.pid ? " is-selected" : ""}${process.protected ? " is-protected" : ""}`, key: process.pid, onClick: () => { if (process.protected) return; setSelectedProcess(process); setFeedback(""); }, "aria-label": t(process.protected ? "performance.process.protectedLabel" : "performance.process.manageLabel", { name: process.name }) },
          React.createElement("span", { className: "performance-process-name", title: process.name }, process.name),
          React.createElement("span", { className: "performance-process-values" },
            React.createElement("strong", { className: metric === "cpu" ? "is-primary" : "" }, `${Number(process.cpuPct || 0).toFixed(1)}% CPU`),
            React.createElement("strong", { className: metric === "memory" ? "is-primary" : "" }, formatProcessMemory(process.memoryBytes)),
            process.protected && React.createElement("em", null, t("performance.process.protected"))
          )
        ))
      ),
      orderedProcesses.length > 5 && React.createElement("button", { type: "button", className: "performance-process-toggle", onClick: () => setShowAllProcesses((value) => !value), "aria-expanded": showAllProcesses }, showAllProcesses ? t("performance.process.collapse") : t("performance.process.viewAll", { count: orderedProcesses.length })),
      selectedProcess && React.createElement("div", { className: "performance-process-confirm" },
        React.createElement("div", null, React.createElement("strong", null, selectedProcess.name), React.createElement("span", null, `PID ${selectedProcess.pid}`)),
        React.createElement("p", null, t("performance.process.quitConfirm")),
        React.createElement("div", { className: "performance-process-actions" },
          React.createElement("button", { type: "button", disabled: Boolean(pendingAction), onClick: () => { setSelectedProcess(null); setFeedback(""); } }, t("common.cancel")),
          React.createElement("button", { type: "button", disabled: Boolean(pendingAction), onClick: () => actOnProcess("terminate") }, t(pendingAction === "terminate" ? "performance.process.quitting" : "performance.process.quit")),
          React.createElement("button", { type: "button", className: "is-destructive", disabled: Boolean(pendingAction), onClick: () => actOnProcess("force") }, t(pendingAction === "force" ? "performance.process.forceQuitting" : "performance.process.forceQuit"))
        )
      ),
      feedback && React.createElement("div", { className: "performance-process-feedback", role: "status" }, feedback)
    )
  );
  return React.createElement("div", { ref: triggerRef, className: "performance-control", onMouseEnter: open, onMouseLeave: closeSoon },
    React.createElement("button", { type: "button", className: `panel-btn performance-button is-${level}`, onClick: open, "aria-expanded": visible, "aria-label": t("performance.monitor"), title: t("performance.monitor") },
      React.createElement("span", { className: "performance-gauge", style: { "--load": `${Math.max(cpu, memory)}%` } }),
      React.createElement("span", { className: "performance-mini" }, `${cpu}%`),
      labelled && React.createElement("span", { className: "performance-menu-label" }, t("performance.monitor"))
    ),
    popover && ReactDOM.createPortal(popover, document.body)
  );
}
