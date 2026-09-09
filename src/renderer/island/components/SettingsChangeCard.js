import { R as React, r as reactExports } from "../../vendor/react-runtime.js";
import { t } from "../../shared/i18n.js";

const LABELS = {
  autoCollapseDelayMs: "settingsChange.field.autoCollapseDelayMs",
  autoCollapseOnMouseLeave: "settingsChange.field.autoCollapseOnMouseLeave",
  completionPopupDurationSec: "settingsChange.field.completionPopupDurationSec",
  fileShelfEnabled: "settingsChange.field.fileShelfEnabled",
  hoverToOpen: "settingsChange.field.hoverToOpen",
  islandDisplayMode: "settingsChange.field.islandDisplayMode",
  lyricsEnabled: "settingsChange.field.lyricsEnabled",
  mediaEnabled: "settingsChange.field.mediaEnabled",
  mediaTrackChangeNotifications: "settingsChange.field.mediaTrackChangeNotifications",
  performanceAlertsEnabled: "settingsChange.field.performanceAlertsEnabled",
  performanceEnabled: "settingsChange.field.performanceEnabled",
  petScale: "settingsChange.field.petScale",
  petSprite: "settingsChange.field.petSprite",
  showUsageQuota: "settingsChange.field.showUsageQuota",
  "sound.enabled": "settingsChange.field.soundEnabled",
  "sound.volume": "settingsChange.field.soundVolume",
  terminalEnabled: "settingsChange.field.terminalEnabled",
  updateChecksEnabled: "settingsChange.field.updateChecksEnabled",
  usageDisplayValue: "settingsChange.field.usageDisplayValue"
};

function formatValue(value) {
  if (value === true) return t("common.on");
  if (value === false) return t("common.off");
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
      setError(undoError?.message || t("settingsChange.undoFailed"));
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
        React.createElement("strong", null, t("settingsChange.heading", { client: surface?.client || t("common.agent") })),
        React.createElement("span", null, t("settingsChange.description"))
      )
    ),
    React.createElement("div", { className: "settings-change-list" }, changes.map((change) =>
      React.createElement("div", { className: "settings-change-row", key: change.key },
        React.createElement("span", null, LABELS[change.key] ? t(LABELS[change.key]) : change.key),
        React.createElement("span", null, `${formatValue(change.oldValue)} → ${formatValue(change.newValue)}`)
      )
    ), extraCount > 0 && React.createElement("div", { className: "settings-change-more" }, t("settingsChange.more", { count: extraCount }))),
    error && React.createElement("div", { className: "settings-change-error", role: "alert" }, error),
    React.createElement("div", { className: "settings-change-actions" },
      React.createElement("button", { type: "button", disabled: busy, onClick: undo }, t(busy ? "settingsChange.undoing" : "settingsChange.undo")),
      React.createElement("button", { type: "button", className: "is-secondary", onClick: viewSettings }, t("settingsChange.view"))
    )
  );
}
