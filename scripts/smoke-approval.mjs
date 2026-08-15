import net from "node:net";
import { hostname, userInfo } from "node:os";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { requireRunningBridge } from "./smoke-support.mjs";

const require = createRequire(import.meta.url);
const { createDevelopmentSocketPath } = require("../src/main/bridge-protocol.cjs");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const socketPath = process.env.FLUX_SOCKET_PATH
  || createDevelopmentSocketPath(root);
const debugPort = Number(process.env.FLUX_DEBUG_PORT || 9333);
const sessionId = `approval-smoke-${Date.now()}`;

await requireRunningBridge(
  socketPath,
  `npm run dev:isolated -- --remote-debugging-port=${debugPort}`
);

function processHook(payload) {
  return new Promise((resolvePromise, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("Timed out waiting for an Island approval directive"));
    }, 10_000);
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({
        type: "command",
        command: {
          type: "processHook",
          source: "codex",
          payload: {
            ...payload,
            session_id: sessionId,
            cwd: root,
            _hostname: hostname(),
            _username: userInfo().username,
            _ipAddrs: []
          }
        }
      })}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        if (message.type !== "response") continue;
        clearTimeout(timeout);
        socket.end();
        resolvePromise(message.response);
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function getIslandTarget() {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  const targets = await response.json();
  const island = targets.find((target) => target.url.includes("/island.html"));
  if (!island) throw new Error("Island renderer target was not found");
  return island;
}

async function clickAllowWhenReady() {
  const target = await getIslandTarget();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    socket.once("open", resolvePromise);
    socket.once("error", reject);
  });
  const deadline = Date.now() + 7000;
  let id = 0;
  while (Date.now() < deadline) {
    id += 1;
    const result = await new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => reject(new Error("CDP evaluation timed out")), 1000);
      const onMessage = (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.id !== id) return;
        clearTimeout(timeout);
        socket.off("message", onMessage);
        resolvePromise(message.result?.result?.value);
      };
      socket.on("message", onMessage);
      socket.send(JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: {
          expression: "(() => { const button = document.querySelector('.approval-btn.allow'); if (!button) return false; button.click(); return true; })()",
          returnByValue: true
        }
      }));
    });
    if (result) {
      socket.close();
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  socket.close();
  throw new Error("Island approval button did not appear");
}

await processHook({
  hook_event_name: "UserPromptSubmit",
  prompt: "Island approval smoke test"
});

const directivePromise = processHook({
  hook_event_name: "PermissionRequest",
  tool_name: "exec_command",
  tool_input: { command: "printf approval-smoke", description: "Harmless approval smoke test" }
});
await clickAllowWhenReady();
const response = await directivePromise;
if (response?.type !== "hookDirective"
  || response.directive?.hookSpecificOutput?.decision?.behavior !== "allow") {
  throw new Error(`Unexpected approval response: ${JSON.stringify(response)}`);
}

await processHook({ hook_event_name: "SessionEnd" });
console.log(`Island approval smoke test passed for ${sessionId}.`);
