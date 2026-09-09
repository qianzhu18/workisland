import { initializeI18n, onLocaleChange, t } from "./shared/i18n.js";

const bridge = window.debugBridge;
const statusNode = document.querySelector("#status");
const sessionsNode = document.querySelector("#sessions");
const hooksNode = document.querySelector("#hooks");
const refreshButton = document.querySelector("#refresh");
const resetButton = document.querySelector("#reset-onboarding");

function renderJson(node, value) {
  node.textContent = JSON.stringify(value, null, 2);
}

function localizeShell() {
  document.title = t("debug.title");
  document.querySelectorAll("[data-i18n]").forEach(node => {
    node.textContent = t(node.dataset.i18n);
  });
}

async function refresh() {
  refreshButton.disabled = true;
  statusNode.textContent = t("debug.status.refreshing");
  try {
    const { sessions = [], hookReports = [] } = await bridge.getStatus();
    renderJson(sessionsNode, sessions);
    renderJson(hooksNode, hookReports);
    statusNode.textContent = t("debug.status.summary", { sessions: sessions.length, reports: hookReports.length });
  } catch (error) {
    statusNode.textContent = t("debug.status.error", { error: error.message });
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", refresh);
resetButton.addEventListener("click", () => {
  bridge.resetOnboarding();
  statusNode.textContent = t("debug.status.reset");
});

await initializeI18n(bridge);
localizeShell();
onLocaleChange(() => {
  localizeShell();
  void refresh();
});
void refresh();
