const bridge = window.debugBridge;
const statusNode = document.querySelector("#status");
const sessionsNode = document.querySelector("#sessions");
const hooksNode = document.querySelector("#hooks");
const refreshButton = document.querySelector("#refresh");
const resetButton = document.querySelector("#reset-onboarding");

function renderJson(node, value) {
  node.textContent = JSON.stringify(value, null, 2);
}

async function refresh() {
  refreshButton.disabled = true;
  statusNode.textContent = "Refreshing...";
  try {
    const { sessions = [], hookReports = [] } = await bridge.getStatus();
    renderJson(sessionsNode, sessions);
    renderJson(hooksNode, hookReports);
    statusNode.textContent = `${sessions.length} sessions, ${hookReports.length} hook reports`;
  } catch (error) {
    statusNode.textContent = `Unable to read debug status: ${error.message}`;
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", refresh);
resetButton.addEventListener("click", () => {
  bridge.resetOnboarding();
  statusNode.textContent = "Onboarding will be shown after the next restart.";
});

void refresh();
