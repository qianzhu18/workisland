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

function deploymentUrl(current) {
  const portIndex = process.argv.findIndex((arg) => arg === "--port");
  const inlinePort = process.argv.find((arg) => arg.startsWith("--port="))?.slice("--port=".length);
  const port = inlinePort || (portIndex >= 0 ? process.argv[portIndex + 1] : "") || current?.port || 3080;
  return `http://127.0.0.1:${port}/`;
}

function emit(event, agent, extra = {}) {
  const current = config();
  if (!current?.command || !agent?.id) return;
  const payload = JSON.stringify({
    session_id: String(agent.id),
    cwd: agent.session?.header?.cwd,
    dsh_url: deploymentUrl(current),
    ...extra,
    hook_event_name: event
  });
  const child = spawn(current.command, { shell: true, stdio: ["pipe", "ignore", "ignore"] });
  child.stdin.end(payload);
  child.on("error", () => {});
}

function approvalOutcome(directive) {
  const decision = directive?.decision
    || directive?.hookSpecificOutput?.decision?.behavior
    || directive?.hookSpecificOutput?.permissionDecision;
  if (decision === "allow") return "allowed-once";
  if (decision === "deny") return "rejected";
  return null;
}

function requestApproval(req) {
  const current = config();
  if (!current?.command || !req?.agent?.id) return Promise.resolve(null);
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      session_id: String(req.agent.id),
      cwd: req.agent.session?.header?.cwd,
      dsh_url: deploymentUrl(current),
      hook_event_name: "PermissionRequest",
      tool_name: req.toolName,
      call_id: req.callId,
      reason: req.reason
    });
    const child = spawn(current.command, { shell: true, stdio: ["pipe", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stdin.end(payload);
    child.on("error", () => resolve(null));
    child.on("close", () => {
      try {
        const line = stdout.trim().split(/\r?\n/).find(Boolean);
        resolve(line ? approvalOutcome(JSON.parse(line)) : null);
      } catch { resolve(null); }
    });
    if (req.signal) {
      req.signal.addEventListener("abort", () => {
        child.kill("SIGTERM");
        resolve("cancelled");
      }, { once: true });
    }
  });
}

export function apply(ctx, options = {}) {
  const askWorkIsland = options.requestApproval || requestApproval;
  ctx.on("agent/session-start", ({ agent }) => emit("SessionStart", agent));
  ctx.on("agent/inbox/claimed", ({ agent, message }) => emit("UserPromptSubmit", agent, { prompt: text(message?.content) }));
  ctx.on("agent/status", ({ agent, status }) => {
    if (status === "running") emit("PreToolUse", agent, { tool_name: "DeepSeek Harness" });
    if (status === "idle") emit("Stop", agent);
  });
  ctx.on("agent/error", ({ agent, error }) => emit("Notification", agent, { notification_type: "error", message: String(error?.message || error || "DeepSeek Harness error") }));
  ctx.on("approval/request", async (req, next) => {
    const outcome = await askWorkIsland(req);
    return outcome || next();
  });
}

export { approvalOutcome };
