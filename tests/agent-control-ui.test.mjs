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
  for (const key of [
    "settings.mcp.service.sectionTitle",
    "settings.mcp.service.enable.title",
    "settings.mcp.client.sectionTitle",
    "settings.mcp.client.connectCodex",
    "settings.mcp.client.configured",
    "settings.mcp.client.connected",
    "settings.mcp.examples.sectionTitle",
    "settings.mcp.privacy.sectionTitle",
    "settings.mcp.activity.sectionTitle",
    "settings.mcp.advanced"
  ]) {
    assert.equal(renderer.includes(key), true, `missing catalog key: ${key}`);
  }
  assert.equal(renderer.includes("允许智能体控制 WorkIsland"), false);
});

test("MCP leads with product questions and keeps manual configuration collapsed", () => {
  for (const key of [
    "settings.mcp.examples.features",
    "settings.mcp.examples.running",
    "settings.mcp.examples.attention",
    "settings.mcp.examples.performance"
  ]) {
    assert.equal(renderer.includes(key), true, `missing MCP example key: ${key}`);
  }
  assert.match(renderer, /document\.createElement\("details"\)/);
  assert.match(renderer, /advanced\.open\s*=\s*false/);
  const order = ["settings.mcp.service.sectionTitle", "settings.mcp.client.sectionTitle", "settings.mcp.examples.sectionTitle", "settings.mcp.privacy.sectionTitle", "settings.mcp.activity.sectionTitle", "settings.mcp.advanced"]
    .map((key) => renderer.indexOf(key));
  assert.equal(order.every((position) => position >= 0), true);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
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
