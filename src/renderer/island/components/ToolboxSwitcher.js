import { R as React } from "../../vendor/react-runtime.js";

const MODULES = [
  ["agent", "Agent", "◆"],
  ["shelf", "文件架", "▱"],
  ["clipboard", "剪贴板", "▤"],
  ["terminal", "终端", ">_" ]
];

export function ToolboxSwitcher({ enabled, active, onChange }) {
  return React.createElement("nav", { className: "toolbox-switcher", "aria-label": "工作台模块" },
    MODULES.filter(([id]) => enabled.includes(id)).map(([id, label, icon]) => React.createElement("button", {
      key: id,
      type: "button",
      className: `toolbox-tab${active === id ? " is-active" : ""}`,
      "aria-pressed": active === id,
      onClick: () => onChange(id)
    }, React.createElement("span", { className: "toolbox-tab-icon", "aria-hidden": "true" }, icon), label))
  );
}
