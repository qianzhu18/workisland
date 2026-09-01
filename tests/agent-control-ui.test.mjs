import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../src/renderer/island/renderer/settings.html", import.meta.url), "utf8");
const renderer = fs.readFileSync(new URL("../src/renderer/settings-app.js", import.meta.url), "utf8");
const preload = fs.readFileSync(new URL("../src/preload/settings.js", import.meta.url), "utf8");
const ipc = fs.readFileSync(new URL("../src/shared/ipc.cjs", import.meta.url), "utf8");
const services = fs.readFileSync(new URL("../src/main/ipc-services.cjs", import.meta.url), "utf8");

test("Settings names MCP directly and places it immediately before About", () => {
  const tabs = [...html.matchAll(/data-tab="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(tabs.at(-2), "mcp");
  assert.equal(tabs.at(-1), "about");
  assert.match(html, /data-tab="mcp"[^>]*>.*MCP/s);
  assert.doesNotMatch(html, />智能体控制</);
  assert.match(renderer, /function mcpPage\s*\(/);
  assert.match(renderer, /["']mcp["']:\s*mcpPage/);
});

test("MCP explains authorization and configuration as separate steps", () => {
  for (const copy of [
    "启用 WorkIsland MCP",
    "默认关闭",
    "连接 Codex",
    "已配置，等待首次调用",
    "已连接",
    "手动配置",
    "最近活动"
  ]) {
    assert.equal(renderer.includes(copy), true, `missing UI copy: ${copy}`);
  }
  assert.equal(renderer.includes("允许智能体控制 WorkIsland"), false);
});

test("renderer receives only purpose-built Agent Control IPC methods", () => {
  for (const method of [
    "getAgentControlStatus",
    "connectAgentControlClient",
    "disconnectAgentControlClient",
    "getAgentControlManualConfig"
  ]) {
    assert.equal(preload.includes(method), true, `missing preload method: ${method}`);
  }
  for (const channel of [
    "SETTINGS_GET_AGENT_CONTROL_STATUS",
    "SETTINGS_CONNECT_AGENT_CONTROL_CLIENT",
    "SETTINGS_DISCONNECT_AGENT_CONTROL_CLIENT",
    "SETTINGS_GET_AGENT_CONTROL_MANUAL_CONFIG"
  ]) {
    assert.equal(ipc.includes(channel), true, `missing channel: ${channel}`);
    assert.equal(services.includes(`IPC.${channel}`), true, `missing handler: ${channel}`);
  }
});

test("the page supports config copy, errors, and activity without exposing raw settings", () => {
  assert.match(renderer, /copyAgentControlConfig/);
  assert.match(renderer, /agentControl\?*\.error/);
  assert.match(renderer, /(agentControl|control)\.activity/);
  assert.doesNotMatch(preload, /readFile|writeFile|config\.toml/);
});
