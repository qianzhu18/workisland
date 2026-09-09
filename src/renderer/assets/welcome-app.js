import { initializeI18n, onLocaleChange } from "../shared/i18n.js";
import { a as ReactDOM, R as React } from "../vendor/react-runtime.js";
import { W as WelcomeApp } from "./welcome-view.js";
const root = document.getElementById("root");
const reactRoot = ReactDOM.createRoot(root);
const render = () => reactRoot.render(/* @__PURE__ */ React.createElement(WelcomeApp, null));
await initializeI18n(window.welcomeBridge);
render();
onLocaleChange(render);
