import { R as React } from "../../vendor/react-runtime.js";

function bytes(value) {
  return `${(Math.max(0, Number(value) || 0) / 1073741824).toFixed(1)} GB`;
}

export function PerformancePopover({ state }) {
  const [hovered, setHovered] = React.useState(false);
  const [pinned, setPinned] = React.useState(false);
  const visible = hovered || pinned;
  React.useEffect(() => {
    window.islandBridge?.setPerformanceDetailsVisible?.(visible);
    return () => window.islandBridge?.setPerformanceDetailsVisible?.(false);
  }, [visible]);
  const cpu = Math.round(Number(state?.cpuPct) || 0);
  const memory = Math.round(Number(state?.memoryPct) || 0);
  const level = cpu >= 85 || memory >= 90 ? "critical" : cpu >= 65 || memory >= 75 ? "warning" : "normal";
  return React.createElement("div", { className: "performance-control", onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) },
    React.createElement("button", { type: "button", className: `panel-btn performance-button is-${level}${pinned ? " is-pinned" : ""}`, onClick: () => setPinned((value) => !value), "aria-expanded": visible, "aria-label": "性能监视器", title: "性能监视器" },
      React.createElement("span", { className: "performance-gauge", style: { "--load": `${Math.max(cpu, memory)}%` } }),
      React.createElement("span", { className: "performance-mini" }, `${cpu}%`)
    ),
    visible && React.createElement("div", { className: "performance-popover", role: "dialog", "aria-label": "性能详情" },
      React.createElement("div", { className: "performance-popover-header" }, React.createElement("strong", null, "系统性能"), React.createElement("span", null, pinned ? "已固定" : "实时")),
      React.createElement("div", { className: "performance-metrics" },
        React.createElement("div", { className: "performance-metric" }, React.createElement("span", null, "CPU"), React.createElement("strong", null, `${cpu}%`), React.createElement("i", { style: { "--value": `${cpu}%` } })),
        React.createElement("div", { className: "performance-metric" }, React.createElement("span", null, "内存"), React.createElement("strong", null, `${memory}%`), React.createElement("i", { style: { "--value": `${memory}%` } }))
      ),
      React.createElement("div", { className: "performance-memory" }, `${bytes(state?.memoryUsedBytes)} / ${bytes(state?.memoryTotalBytes)}`),
      state?.processes?.length > 0 && React.createElement("div", { className: "performance-processes" },
        React.createElement("div", { className: "performance-process-title" }, "高占用进程"),
        state.processes.slice(0, 5).map((process) => React.createElement("div", { className: "performance-process", key: process.pid }, React.createElement("span", { title: process.name }, process.name), React.createElement("strong", null, `${process.cpuPct.toFixed(1)}%`)))
      )
    )
  );
}
