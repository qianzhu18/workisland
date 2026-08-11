import { access } from "node:fs/promises";

export async function requireRunningBridge(socketPath, startCommand, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(socketPath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(
    `WorkIsland bridge is not running at ${socketPath}. Start it first with: ${startCommand}`
  );
}
