import net from "node:net";
import os from "node:os";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireRunningBridge } from "./smoke-support.mjs";

const require = createRequire(import.meta.url);
const { encodeLine, decodeLines, createDevelopmentSocketPath } = require("../src/main/bridge-protocol.cjs");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isolated = process.argv.includes("--isolated");
const socketPath = process.env.FLUX_SOCKET_PATH || (isolated
  ? createDevelopmentSocketPath(root)
  : resolve(os.homedir(), ".flux", "run", "bridge.sock"));
const sessionId = `smoke-${Date.now()}`;
const commands = [
  {
    type: "processHook",
    source: "claude",
    payload: {
      hook_event_name: "UserPromptSubmit",
      session_id: sessionId,
      cwd: root,
      prompt: "WorkIsland source smoke test"
    }
  },
  {
    type: "processHook",
    source: "claude",
    payload: {
      hook_event_name: "SessionEnd",
      session_id: sessionId,
      cwd: root
    }
  }
];

await requireRunningBridge(socketPath, isolated ? "npm run dev:isolated" : "npm run dev");

await new Promise((resolvePromise, reject) => {
  const socket = net.createConnection(socketPath);
  let buffer = Buffer.alloc(0);
  let commandIndex = 0;
  const timeout = setTimeout(() => {
    socket.destroy();
    reject(new Error(`Timed out waiting for bridge ACK on ${socketPath}`));
  }, 5000);

  const sendNext = () => {
    if (commandIndex >= commands.length) {
      clearTimeout(timeout);
      socket.end();
      resolvePromise();
      return;
    }
    socket.write(encodeLine({ type: "command", command: commands[commandIndex] }));
    commandIndex += 1;
  };

  socket.on("connect", sendNext);
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const decoded = decodeLines(buffer);
    buffer = decoded.remainder;
    for (const message of decoded.messages) {
      if (message.type === "response" && message.response?.type === "acknowledged") sendNext();
    }
  });
  socket.on("error", (error) => {
    clearTimeout(timeout);
    reject(error);
  });
});

console.log(`Hook smoke test passed for ${sessionId}.`);
