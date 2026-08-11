import "../shared/i18n.js";
import { a as ReactDOM, R as React } from "../vendor/react-runtime.js";
import { W as WelcomeApp } from "./welcome-view.js";
const root = document.getElementById("root");
ReactDOM.createRoot(root).render(/* @__PURE__ */ React.createElement(WelcomeApp, null));
