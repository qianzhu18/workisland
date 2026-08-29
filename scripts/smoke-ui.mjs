import WebSocket from "ws";

const port = Number(process.env.FLUX_DEBUG_PORT || 9333);
const baseUrl = `http://127.0.0.1:${port}`;

async function targets() {
  const response = await fetch(`${baseUrl}/json/list`);
  if (!response.ok) throw new Error(`CDP target list failed: ${response.status}`);
  return response.json();
}

async function waitForTarget(fragment, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const target = (await targets()).find((candidate) => candidate.url.includes(fragment));
    if (target) return target;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for renderer target: ${fragment}`);
}

async function waitForTargetGone(fragment, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const target = (await targets()).find((candidate) => candidate.url.includes(fragment));
    if (!target) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for renderer target to close: ${fragment}`);
}

async function evaluate(target, expression) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const id = 1;
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CDP evaluation timed out: ${expression}`)), 4000);
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.id !== id) return;
      clearTimeout(timeout);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result?.result?.value);
    });
    socket.send(JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: { expression, awaitPromise: true, returnByValue: true }
    }));
  });
  socket.close();
  return result;
}

const welcome = (await targets()).find((candidate) => candidate.url.includes("/welcome.html"));
if (welcome) {
  await evaluate(welcome, "document.querySelector('.welcome-btn')?.click(); true");
}
const island = await waitForTarget("/island.html");
if (await evaluate(island, "typeof window.islandBridge") !== "object") {
  throw new Error("islandBridge is not exposed");
}

await evaluate(island, "window.islandBridge.openSettings(); true");
const settings = await waitForTarget("/settings.html");
if (await evaluate(settings, "typeof window.settingsApi") !== "object") {
  throw new Error("settingsApi is not exposed");
}
if (await evaluate(settings, "typeof window.settingsApi.getHookStatus") !== "function") {
  throw new Error("local Agent settings API is missing");
}
const authoredSettingsReady = await evaluate(
  settings,
  "document.querySelector('[data-tab=agents]')?.textContent.includes('Agents') && document.querySelectorAll('.nav-item').length === 5"
);
if (!authoredSettingsReady) {
  throw new Error("authored settings app did not render");
}
const unavailableNavigationVisible = await evaluate(
  settings,
  "['飞书', 'SSH 远程', 'CloudAgent'].some((label) => document.body.innerText.includes(label))"
);
if (unavailableNavigationVisible) throw new Error("Unavailable private-service navigation is still visible");

await evaluate(island, "document.querySelector('.pill').click(); true");
const petButtonExists = await evaluate(island, "!!document.querySelector('.panel-pet-button')");
if (!petButtonExists) throw new Error("The expanded island pet button is missing");
await evaluate(island, "document.querySelector('.panel-pet-button').click(); true");
const pet = await waitForTarget("/pet.html");
if (await evaluate(pet, "typeof window.petBridge") !== "object") {
  throw new Error("petBridge is not exposed");
}
const petSpriteRendered = await evaluate(
  pet,
  `(async () => {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const canvas = document.querySelector('.pet-canvas');
      if (canvas?.width && canvas?.height) {
        const pixels = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] > 0) return true;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  })()`
);
if (!petSpriteRendered) throw new Error("The pet sprite did not render to canvas");
const islandStayedOpen = await evaluate(
  island,
  `(async () => {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (document.querySelector('.island-pop-wrapper')?.classList.contains('is-open')) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  })()`
);
if (!islandStayedOpen) throw new Error("Opening the pet changed the island's expanded state");
await evaluate(pet, "window.petBridge.togglePanel(); true");
const panel = await waitForTarget("/pet-panel.html");
if (await evaluate(panel, "typeof window.petPanelBridge") !== "object") {
  throw new Error("petPanelBridge is not exposed");
}
await evaluate(pet, "window.petBridge.togglePanel(); true");
await evaluate(island, "document.querySelector('.panel-pet-button').click(); true");
await waitForTargetGone("/pet.html");
await waitForTarget("/island.html");

console.log("UI smoke test passed: island, settings, pet, and pet panel.");
