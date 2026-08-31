import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../src/renderer/island/renderer/settings.html", import.meta.url), "utf8");
const renderer = fs.readFileSync(new URL("../src/renderer/settings-app.js", import.meta.url), "utf8");
const preload = fs.readFileSync(new URL("../src/preload/settings.js", import.meta.url), "utf8");
const ipc = fs.readFileSync(new URL("../src/shared/ipc.cjs", import.meta.url), "utf8");
const services = fs.readFileSync(new URL("../src/main/ipc-services.cjs", import.meta.url), "utf8");

test("Settings has a dedicated Agent Control navigation page", () => {
  assert.match(html, /data-tab="agent-control"/);
  assert.match(html, />智能体控制</);
  assert.match(renderer, /function agentControlPage\s*\(/);
  assert.match(renderer, /["']agent-control["']:\s*agentControlPage/);
});

test("Agent Control explains authorization and configuration as separate steps", () => {
  for (const copy of [
    "允许智能体控制 WorkIsland",
    "默认关闭",
    "连接 Codex",
    "已配置，等待首次调用",
    "已连接",
    "手动配置",
    "最近活动"
  ]) {
    assert.equal(renderer.includes(copy), true, `missing UI copy: ${copy}`);
  }
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
