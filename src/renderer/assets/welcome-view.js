import { r as reactExports, R as React } from "../vendor/react-runtime.js";

function WelcomeApp() {
  const [visible, setVisible] = reactExports.useState(false);
  const [starting, setStarting] = reactExports.useState(false);

  reactExports.useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const start = () => {
    if (starting) return;
    setStarting(true);
    window.welcomeBridge?.getStarted();
  };

  return React.createElement(
    "main",
    { className: `welcome-root${visible ? " is-visible" : ""}` },
    React.createElement("div", { className: "welcome-drag-region", "aria-hidden": "true" }),
    React.createElement(
      "section",
      { className: "welcome-hero" },
      React.createElement(
        "div",
        { className: "welcome-mark", "aria-hidden": "true" },
        React.createElement("span", { className: "welcome-whale" }, "🐋")
      ),
      React.createElement("p", { className: "welcome-eyebrow" }, "LOCAL AGENTS · ONE ISLAND"),
      React.createElement("h1", null, "Orca"),
      React.createElement(
        "p",
        { className: "welcome-description" },
        "在 Mac 刘海区域查看 Coding Agent 会话、处理审批，并在任务完成时获得声音与触觉提醒。"
      )
    ),
    React.createElement(
      "div",
      { className: "welcome-features" },
      React.createElement("span", null, "● 本地运行"),
      React.createElement("span", null, "● 多 Agent"),
      React.createElement("span", null, "● 桌宠模式")
    ),
    React.createElement(
      "footer",
      { className: "welcome-footer" },
      React.createElement(
        "button",
        { className: "welcome-btn", type: "button", onClick: start, disabled: starting },
        starting ? "正在启动…" : "进入 Orca"
      ),
      React.createElement("p", { className: "welcome-hint" }, "进入后，灵动岛会显示在屏幕顶部刘海区域。")
    )
  );
}

export { WelcomeApp as W };
