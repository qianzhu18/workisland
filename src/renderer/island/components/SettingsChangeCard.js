import { R as React, r as reactExports } from "../../vendor/react-runtime.js";

const LABELS = {
  autoCollapseDelayMs: "自动收起延迟",
  autoCollapseOnMouseLeave: "移出后自动收起",
  completionPopupDurationSec: "完成通知时长",
  fileShelfEnabled: "文件架",
  hoverToOpen: "悬停展开",
  islandDisplayMode: "灵动岛显示模式",
  lyricsEnabled: "歌词",
  mediaEnabled: "媒体控制",
  mediaTrackChangeNotifications: "切歌通知",
  performanceAlertsEnabled: "性能提醒",
  performanceEnabled: "性能监控",
  petScale: "桌宠大小",
  petSprite: "桌宠形象",
  showUsageQuota: "用量额度",
  "sound.enabled": "提示音",
  "sound.volume": "提示音音量",
  terminalEnabled: "终端",
  updateChecksEnabled: "更新检查",
  usageDisplayValue: "用量显示"
};

function formatValue(value) {
  if (value === true) return "开启";
  if (value === false) return "关闭";
  return String(value ?? "—");
}

export function SettingsChangeCard({ surface, onOpenSettings, onCollapse }) {
  const [busy, setBusy] = reactExports.useState(false);
  const [error, setError] = reactExports.useState("");
  const changes = Array.isArray(surface?.changes) ? surface.changes.slice(0, 4) : [];
  const extraCount = Math.max(0, (surface?.changes?.length || 0) - changes.length);

  const undo = async () => {
    setBusy(true);
    setError("");
    try {
      await window.islandBridge?.undoSettingsChanges?.(surface?.changeIds || []);
      onCollapse?.();
    } catch (undoError) {
      setError(undoError?.message || "设置已再次变化，无法撤销");
    } finally {
      setBusy(false);
    }
  };
  const viewSettings = () => {
    onOpenSettings?.("agent-control");
    onCollapse?.();
  };

  return React.createElement("section", { className: "settings-change-card", "aria-live": "polite" },
    React.createElement("div", { className: "settings-change-heading" },
      React.createElement("span", { className: "settings-change-mark", "aria-hidden": "true" }, "✓"),
      React.createElement("div", null,
        React.createElement("strong", null, `${surface?.client || "智能体"} 修改了 WorkIsland 设置`),
        React.createElement("span", null, "修改已应用，你随时可以撤销")
      )
    ),
    React.createElement("div", { className: "settings-change-list" }, changes.map((change) =>
      React.createElement("div", { className: "settings-change-row", key: change.key },
        React.createElement("span", null, LABELS[change.key] || change.key),
        React.createElement("span", null, `${formatValue(change.oldValue)} → ${formatValue(change.newValue)}`)
      )
    ), extraCount > 0 && React.createElement("div", { className: "settings-change-more" }, `另有 ${extraCount} 项修改`)),
    error && React.createElement("div", { className: "settings-change-error", role: "alert" }, error),
    React.createElement("div", { className: "settings-change-actions" },
      React.createElement("button", { type: "button", disabled: busy, onClick: undo }, busy ? "撤销中…" : "撤销"),
      React.createElement("button", { type: "button", className: "is-secondary", onClick: viewSettings }, "查看设置")
    )
  );
}
