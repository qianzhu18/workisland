import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../src/renderer/settings-app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../src/renderer/island/renderer/settings.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/renderer/settings-app.css", import.meta.url), "utf8");

test("Agent descriptions wrap instead of truncating long guidance", () => {
  const rule = css.match(/\.agent-detail\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(rule, /white-space:\s*normal/);
  assert.match(rule, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(rule, /white-space:\s*nowrap/);
  assert.doesNotMatch(rule, /overflow:\s*hidden/);
  assert.doesNotMatch(rule, /text-overflow:\s*ellipsis/);
});

test("general settings expose all completion notification duration options", () => {
  assert.match(source, /完成通知停留时间/);
  for (const seconds of [5, 10, 20, 30]) {
    assert.match(source, new RegExp(`\\["${seconds}", "${seconds} 秒"\\]`));
  }
  assert.match(source, /save\(\{ completionPopupDurationSec: Number\(v\) \}\)/);
});

test("the default General page offers a confirmed safe quit action", () => {
  assert.match(source, /function requestQuitApp\(\)/);
  assert.match(source, /window\.confirm\("退出 WorkIsland？\\n\\n这会关闭 Island、桌宠与后台监听。"\)/);
  assert.match(source, /section\("应用", "关闭 WorkIsland 会同时关闭 Island、桌宠与后台监听。"\)/);
  assert.match(source, /button\("退出应用", requestQuitApp, "danger"\)/);
  assert.doesNotMatch(source, /button\("退出应用", \(\) => api\.quitApp\(\), "danger"\)/);
});

test("about settings route the manual, feedback and community through stable website URLs", () => {
  assert.match(source, /帮助与社区/);
  assert.match(source, /https:\/\/workisland\.yanglaishe\.cn\/guide\//);
  assert.match(source, /产品手册/);
  assert.match(source, /https:\/\/workisland\.yanglaishe\.cn\/#feedback/);
  assert.match(source, /https:\/\/workisland\.yanglaishe\.cn\/#community/);
  assert.match(source, /提交反馈/);
  assert.match(source, /加入社区/);
});

test("settings use product images instead of letter placeholders", () => {
  assert.match(html, /class="brand-mark"[^>]+src="\.\.\/assets\/workisland-icon\.png"[^>]+draggable="false"/);
  assert.doesNotMatch(html, /class="brand-mark">O</);
  assert.match(source, /AGENT_ICON_URLS/);
  assert.match(source, /DEFAULT_AGENT_ICON_URL/);
  assert.match(source, /agent-icon-image/);
  assert.match(source, /icon\.draggable = false/);
  assert.match(source, /el\("img", "app-mark"\)/);
  assert.match(source, /appMark\.draggable = false/);
  assert.doesNotMatch(source, /el\("div", "app-mark", "O"\)/);
});

test("DeepSeek Harness distinguishes a written config from a verified connection", () => {
  assert.match(source, /VERIFY_ON_REAL_EVENT_AGENT_IDS/);
  assert.match(source, /配置已写入/);
  assert.match(source, /已连接/);
  assert.match(source, /report\?\.connectionState === "verified"/);
});

test("an open Agents page refreshes connection state after real Hook events", () => {
  assert.match(source, /AGENT_STATUS_REFRESH_INTERVAL_MS/);
  assert.match(source, /setInterval\([\s\S]*state\.activeTab === "agents"[\s\S]*refreshAgents/);
});

test("agents page does not advertise speculative custom Hook connections", () => {
  const preloadSource = readFileSync(new URL("../src/preload/settings.js", import.meta.url), "utf8");
  const ipcSource = readFileSync(new URL("../src/shared/ipc.cjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /接入我的智能体|DISCOVERY_PROMPT|customConnections/);
  assert.doesNotMatch(preloadSource, /CustomAgentConnection/);
  assert.doesNotMatch(ipcSource, /CUSTOM_AGENT_CONNECTION/);
});

test("DeepSeek Harness remains opt-in until the user clicks connect", () => {
  const settingsSource = readFileSync(new URL("../src/shared/settings.cjs", import.meta.url), "utf8");
  assert.match(settingsSource, /dsh:\s*false/);
});

test("current TraeCode Hooks are offered without advertising unsupported TraeWork or Trae CN", () => {
  const catalogSource = readFileSync(new URL("../src/shared/agent-catalog.cjs", import.meta.url), "utf8");
  const coordinatorSource = readFileSync(new URL("../src/main/app-coordinator.cjs", import.meta.url), "utf8");
  assert.match(catalogSource, /descriptor\("trae",\s*"TraeCode"/);
  assert.match(catalogSource, /启用“已配置的 Hooks”/);
  assert.match(catalogSource, /“本地自动运行”/);
  assert.doesNotMatch(catalogSource, /descriptor\("trae-cn",/);
  assert.doesNotMatch(catalogSource, /descriptor\("traework",/);
  assert.doesNotMatch(source, /traework:/);
  assert.match(source, /VERIFY_ON_REAL_EVENT_AGENT_IDS = new Set\(\["dsh", "trae"\]\)/);
  assert.match(coordinatorSource, /\["trae", new TraeHookManager\(\)\]/);
  assert.doesNotMatch(coordinatorSource, /\["traework", new TraeWorkHookManager\(\)\]/);
  assert.match(coordinatorSource, /manager\.uninstall\(\{ preserveVerification: true \}\)/);
  assert.match(coordinatorSource, /agentId === "trae"[\s\S]*health\?\.installed[\s\S]*preserving user approval/);
  assert.doesNotMatch(coordinatorSource, /UNSUPPORTED_HOOK_SOURCES/);
  const managerSource = readFileSync(new URL("../src/main/hooks-editors.cjs", import.meta.url), "utf8");
  assert.match(managerSource, /existing\?\.lastVerifiedAt[\s\S]*lastVerifiedEvent: existing\.lastVerifiedEvent/);
  assert.doesNotMatch(managerSource, /class TraeWorkHookManager/);
});
