import { R as React, b as ReactDOM } from "../../vendor/react-runtime.js";
import { placeFloatingLayer } from "./floating-layer-model.mjs";

const updateIcon = "data:image/svg+xml,%3csvg%20width='16'%20height='16'%20viewBox='0%200%2016%2016'%20fill='none'%20xmlns='http://www.w3.org/2000/svg'%3e%3cpath%20d='M8.00065%208.66699V14.0003L5.33398%2011.3337'%20stroke='%23DADCE1'%20style='stroke:%23DADCE1;stroke:color(display-p3%200.8568%200.8617%200.8817);stroke-opacity:1;'%20stroke-width='1.33333'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M8%2013.9997L10.6667%2011.333'%20stroke='%23DADCE1'%20style='stroke:%23DADCE1;stroke:color(display-p3%200.8568%200.8617%200.8817);stroke-opacity:1;'%20stroke-width='1.33333'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M2.92901%2010.179C2.38452%209.70273%201.95823%209.10634%201.68379%208.43699C1.40935%207.76764%201.29429%207.04365%201.34769%206.32219C1.40109%205.60074%201.62149%204.90158%201.99149%204.27993C2.36148%203.65827%202.87093%203.13115%203.47962%202.74019C4.0883%202.34922%204.77955%202.10513%205.49876%202.02717C6.21798%201.94922%206.94547%202.03954%207.62379%202.29101C8.3021%202.54248%208.91267%202.9482%209.40726%203.47614C9.90186%204.00409%2010.2669%204.63979%2010.4737%205.33305H11.667C12.3151%205.33297%2012.9457%205.54273%2013.4646%205.93095C13.9835%206.31917%2014.3627%206.86498%2014.5455%207.4867C14.7284%208.10842%2014.7049%208.77262%2014.4788%209.37993C14.2527%209.98724%2013.8359%2010.505%2013.291%2010.8557'%20stroke='%23DADCE1'%20style='stroke:%23DADCE1;stroke:color(display-p3%200.8568%200.8617%200.8817);stroke-opacity:1;'%20stroke-width='1.33333'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3c/svg%3e";

function formatMegabytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0) / 1048576;
  if (value >= 1024) return `${(value / 1024).toFixed(2)} GB`;
  return `${value.toFixed(1)} MB`;
}

// 只有"确实有新版本"或"用户已经触发了下载/安装"时才展示更新入口，
// 避免主进程默认的 idle 快照把按钮常驻在额度格子旁边。
export function hasActiveUpdateFlow(updateState) {
  if (!updateState) return false;
  return ["downloading", "ready", "installing", "manual", "error"].includes(updateState.phase);
}

// 灵动岛顶部的系统更新入口：位于 Codex 等额度格子的右侧，
// 点击展开「下载 → 校验 → 安装 → 重启」的完整闭环。
export function UpdateStatusButton({ updateState, hasUpdate, onDownload, onInstall, onOpenRelease }) {
  const [pinned, setPinned] = React.useState(false);
  const [position, setPosition] = React.useState({ left: 12, top: 12 });
  const triggerRef = React.useRef(null);
  const popoverRef = React.useRef(null);
  // 有可用更新但还没开始下载时，主进程侧停留在 idle 阶段；
  // 这里把它合成为 available 展示态，驱动按钮与弹层文案。
  const displayPhase = (() => {
    const phase = updateState?.phase ?? "idle";
    if (phase === "idle" && hasUpdate) return "available";
    return phase;
  })();
  const visible = pinned;
  React.useLayoutEffect(() => {
    if (!visible || !triggerRef.current) return undefined;
    const updatePosition = () => {
      const anchor = triggerRef.current.getBoundingClientRect();
      const layer = popoverRef.current?.getBoundingClientRect() || { width: 248, height: 160 };
      setPosition(placeFloatingLayer(anchor, { width: window.innerWidth, height: window.innerHeight }, layer));
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [visible, displayPhase, updateState?.progress?.pct]);
  React.useEffect(() => {
    if (displayPhase === "idle") setPinned(false);
  }, [displayPhase]);
  const primaryAction = (() => {
    if (displayPhase === "ready") return { label: "重启并完成安装", onClick: onInstall };
    if (displayPhase === "downloading" || displayPhase === "installing") return null;
    return { label: displayPhase === "error" ? "重试下载" : "下载并安装", onClick: onDownload };
  })();
  const statusText = (() => {
    if (displayPhase === "downloading") return "正在下载更新，完成后会校验安装包完整性。";
    if (displayPhase === "installing") return "正在安装，应用将自动重启…";
    if (displayPhase === "manual") return "自动安装未完成，已打开安装镜像，请将 WorkIsland 拖入「应用程序」后重新打开。";
    if (displayPhase === "error") return updateState?.error || "更新失败，请稍后重试。";
    return null;
  })();
  const headerBadge = (() => {
    if (displayPhase === "ready") return "已就绪";
    if (displayPhase === "downloading") return "下载中";
    if (displayPhase === "installing") return "安装中";
    if (displayPhase === "manual") return "需手动完成";
    if (displayPhase === "error") return "更新失败";
    return "新版本";
  })();
  const releaseVersion = updateState?.latestVersion;
  const popover = visible && React.createElement("div", { ref: popoverRef, className: "update-popover", role: "dialog", "aria-label": "软件更新", style: { left: `${position.left}px`, top: `${position.top}px` } },
    React.createElement("div", { className: "update-popover-header" },
      React.createElement("strong", null, releaseVersion ? `WorkIsland ${releaseVersion}` : "WorkIsland 更新"),
      React.createElement("span", null, headerBadge)
    ),
    React.createElement("p", { className: "update-popover-desc" }, "安装包来自官方 GitHub Release，下载后会校验完整性再安装，期间不会上传任何本机数据。"),
    displayPhase === "downloading" && React.createElement("div", { className: "update-progress", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": updateState?.progress?.pct ?? 0 },
      React.createElement("i", { style: { "--pct": `${updateState?.progress?.pct ?? 0}%` } })
    ),
    displayPhase === "downloading" && React.createElement("div", { className: "update-progress-meta" },
      React.createElement("span", null, formatMegabytes(updateState?.progress?.received)),
      React.createElement("span", null, updateState?.progress?.total ? formatMegabytes(updateState.progress.total) : "")
    ),
    statusText && React.createElement("div", { className: `update-popover-status is-${displayPhase}`, role: "status" }, statusText),
    React.createElement("div", { className: "update-popover-actions" },
      primaryAction && React.createElement("button", { type: "button", className: "update-popover-primary", onClick: primaryAction.onClick }, primaryAction.label),
      releaseVersion && onOpenRelease && React.createElement("button", { type: "button", className: "update-popover-link", onClick: onOpenRelease }, "查看发布说明")
    )
  );
  return React.createElement("div", { ref: triggerRef, className: "usage-cell update-cell" },
    React.createElement("button", { type: "button", className: `update-tag is-${displayPhase}`, onClick: () => setPinned((value) => !value), "aria-expanded": visible, title: releaseVersion ? `发现新版本 ${releaseVersion}` : "发现新版本", "aria-label": "软件更新" },
      React.createElement("img", { src: updateIcon, alt: "", draggable: false }),
      React.createElement("span", { className: "update-tag-dot" })
    ),
    popover && ReactDOM.createPortal(popover, document.body)
  );
}
