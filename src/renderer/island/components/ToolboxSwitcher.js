import { R as React } from "../../vendor/react-runtime.js";
import { t } from "../../shared/i18n.js";

const MODULES = [
  ["agent", "toolbox.agent", "◆"],
  ["shelf", "toolbox.shelf", "▱"],
  ["clipboard", "toolbox.clipboard", "▤"],
  ["terminal", "toolbox.terminal", ">_" ]
];

export function ToolboxSwitcher({ enabled, active, onChange }) {
  return React.createElement("nav", { className: "toolbox-switcher", "aria-label": t("toolbox.navigation") },
    MODULES.filter(([id]) => enabled.includes(id)).map(([id, labelKey, icon]) => React.createElement("button", {
      key: id,
      type: "button",
      className: `toolbox-tab${active === id ? " is-active" : ""}`,
      "aria-pressed": active === id,
      onClick: () => onChange(id)
    }, React.createElement("span", { className: "toolbox-tab-icon", "aria-hidden": "true" }, icon), t(labelKey)))
  );
}
