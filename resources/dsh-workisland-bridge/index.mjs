import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_PATH = join(homedir(), ".flux", "dsh-workisland-bridge.json");

function config() {
  try { return JSON.parse(readFileSync(CONFIG_PATH, "utf8")); } catch { return null; }
}

function text(blocks) {
  if (typeof blocks === "string") return blocks;
  if (!Array.isArray(blocks)) return "";
  return blocks.map((block) => typeof block?.text === "string" ? block.text : "").filter(Boolean).join("\n");
}

function emit(event, agent, extra = {}) {
  const current = config();
  if (!current?.command || !agent?.id) return;
  const payload = JSON.stringify({ session_id: String(agent.id), cwd: agent.session?.header?.cwd, ...extra, hook_event_name: event });
  const child = spawn(current.command, { shell: true, stdio: ["pipe", "ignore", "ignore"] });
  child.stdin.end(payload);
  child.on("error", () => {});
}

export function apply(ctx) {
  ctx.on("agent/session-start", ({ agent }) => emit("SessionStart", agent));
  ctx.on("agent/inbox/claimed", ({ agent, message }) => emit("UserPromptSubmit", agent, { prompt: text(message?.content) }));
  ctx.on("agent/status", ({ agent, status }) => {
    if (status === "running") emit("PreToolUse", agent, { tool_name: "DeepSeek Harness" });
    if (status === "idle") emit("Stop", agent);
  });
  ctx.on("agent/error", ({ agent, error }) => emit("Notification", agent, { notification_type: "error", message: String(error?.message || error || "DeepSeek Harness error") }));
}
