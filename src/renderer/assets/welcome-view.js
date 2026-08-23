import { r as reactExports, R as React } from "../vendor/react-runtime.js";

const workIslandLogo = new URL("../../../resources/icon.png", import.meta.url).href;
const telemetryConsentOnly = new URLSearchParams(window.location.search).get("mode") === "telemetry";
const isWindows = window.welcomeBridge?.platform === "win32";

function WelcomeApp() {
  const [visible, setVisible] = reactExports.useState(false);
  const [starting, setStarting] = reactExports.useState(false);
  // 匿名使用统计同意（PRD-005）：默认不勾选，随"进入 WorkIsland"一次性提交。
  const [telemetry, setTelemetry] = reactExports.useState(false);
  const [showTelemetryDetails, setShowTelemetryDetails] = reactExports.useState(false);

  reactExports.useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const start = () => {
    if (starting) return;
    setStarting(true);
    window.welcomeBridge?.getStarted({ telemetry });
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
      React.createElement("p", { className: "welcome-eyebrow" }, telemetryConsentOnly ? "PRIVACY CHOICE" : "LOCAL AGENTS · ONE ISLAND"),
      React.createElement("h1", null, telemetryConsentOnly ? "你的隐私选择" : "WorkIsland"),
      React.createElement(
        "p",
        { className: "welcome-description" },
        telemetryConsentOnly
          ? "WorkIsland 新增了默认关闭的匿名使用统计。请决定是否允许它帮助我们改进产品。"
          : isWindows
            ? "在 Windows 桌面顶部查看 Work Agent 工作状态、处理需要确认的事项，并在任务完成时获得系统声音提醒。"
            : "在 Mac 顶部查看 Work Agent 工作状态、处理需要确认的事项，并在任务完成时获得声音与触觉提醒。"
      )
    ),
    telemetryConsentOnly ? null : React.createElement(
      "div",
      { className: "welcome-features" },
      React.createElement("span", null, "● 本地运行"),
      React.createElement("span", null, "● 多 Agent"),
      React.createElement("span", null, "● 桌宠模式")
    ),
    React.createElement(
      "div",
      { className: "welcome-consent" },
      React.createElement(
        "label",
        { className: "welcome-consent-row" },
        React.createElement("input", {
          type: "checkbox",
          checked: telemetry,
          onChange: (event) => setTelemetry(event.target.checked),
          "aria-label": "允许匿名使用统计"
        }),
        React.createElement(
          "span",
          null,
          "允许匿名使用统计，帮助改进 WorkIsland"
        )
      ),
      React.createElement(
        "button",
        {
          type: "button",
          className: "welcome-consent-more",
          onClick: () => setShowTelemetryDetails((value) => !value)
        },
        showTelemetryDetails ? "收起详情" : "会发送什么？"
      ),
      showTelemetryDetails
        ? React.createElement(
            "ul",
            { className: "welcome-consent-details" },
            React.createElement("li", null, "仅记录事件类型（如会话开始、审批处理、回源跳转）与 Agent 名称"),
            React.createElement("li", null, "身份仅为一串随机匿名编号，不含会话内容、文件路径或任何个人信息"),
            React.createElement("li", null, "数据发送至 PostHog（美国区）用于统计，代码开源可查"),
            React.createElement("li", null, "不勾选则完全不发送；之后可随时在“设置 → 关于”中开启或关闭")
          )
        : null
    ),
    React.createElement(
      "footer",
      { className: "welcome-footer" },
      React.createElement(
        "button",
        { className: "welcome-btn", type: "button", onClick: start, disabled: starting },
        starting ? "正在保存…" : telemetryConsentOnly ? "保存选择" : "进入 WorkIsland"
      ),
      telemetryConsentOnly ? null : React.createElement("p", { className: "welcome-hint" }, "进入后，WorkIsland 会显示在屏幕顶部；无刘海或外接屏会使用浮动栏。")
    )
  );
}

export { WelcomeApp as W };
