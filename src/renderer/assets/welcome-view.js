import { r as reactExports, R as React } from "../vendor/react-runtime.js";
import { t } from "../shared/i18n.js";

const workIslandLogo = new URL("../../../resources/icon.png", import.meta.url).href;
const isWindows = window.welcomeBridge?.platform === "win32";

function WelcomeApp() {
  const [visible, setVisible] = reactExports.useState(false);
  const [starting, setStarting] = reactExports.useState(false);

  reactExports.useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // 遥测自 2026-08-22 起默认开启并在「设置 → 关于」披露，欢迎页不再询问。
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
        isWindows
          ? t("welcome.description.windows")
          : t("welcome.description.mac")
      ),
      React.createElement(
        "div",
        { className: "welcome-steps" },
        React.createElement("span", null, t("welcome.steps.installAgent")),
        React.createElement("span", null, t("welcome.steps.connectAgent")),
        React.createElement("span", null, t("welcome.steps.runCommand"))
      )
    ),
    React.createElement(
      "div",
      { className: "welcome-features" },
      React.createElement("span", null, t("welcome.features.local")),
      React.createElement("span", null, t("welcome.features.multiAgent")),
      React.createElement("span", null, t("welcome.features.pet"))
    ),
    React.createElement(
      "footer",
      { className: "welcome-footer" },
      React.createElement(
        "button",
        { className: "welcome-btn", type: "button", onClick: start, disabled: starting },
        starting ? t("welcome.action.saving") : t("welcome.action.enter")
      ),
      React.createElement("p", { className: "welcome-hint" }, t("welcome.hint"))
    )
  );
}

export { WelcomeApp as W };
