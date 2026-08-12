import { r as reactExports, R as React } from "../vendor/react-runtime.js";

const workIslandLogo = new URL("../../../resources/icon.png", import.meta.url).href;

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
        React.createElement("img", { className: "welcome-logo", src: workIslandLogo, alt: "WorkIsland" })
      ),
      React.createElement("p", { className: "welcome-eyebrow" }, "LOCAL AGENTS · ONE ISLAND"),
      React.createElement("h1", null, "WorkIsland"),
      React.createElement(
        "p",
        { className: "welcome-description" },
        "在 Mac 顶部查看 Work Agent 工作状态、处理需要确认的事项，并在任务完成时获得声音与触觉提醒。"
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
        starting ? "正在启动…" : "进入 WorkIsland"
      ),
      React.createElement("p", { className: "welcome-hint" }, "进入后，WorkIsland 会显示在屏幕顶部；无刘海或外接屏会使用浮动栏。")
    )
  );
}

export { WelcomeApp as W };
