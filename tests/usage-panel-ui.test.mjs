import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(`../src/renderer/island/components/${name}`, import.meta.url), "utf8");

test("usage dashboard is registered as a fifth toolbox module", () => {
  const model = read("productivity-toolbox-model.mjs");
  assert.match(model, /"usage"/);
  assert.match(model, /usageDashboardEnabled !== false/);

  const panel = read("IslandPanel.js");
  assert.match(panel, /import \{ UsagePanel \} from "\.\/UsagePanel\.js"/);
  assert.match(panel, /function UsageToolIcon/);
  assert.match(panel, /\["usage", "用量", UsageToolIcon\]/);
  assert.match(panel, /activeModule === "usage" && \/\* @__PURE__ \*\/ React\.createElement\(UsagePanel\)/);
  assert.match(panel, /usageDashboardEnabled/);

  const app = readFileSync(new URL("../src/renderer/island/app.js", import.meta.url), "utf8");
  assert.match(app, /usageDashboardEnabled/);
  const settings = readFileSync(new URL("../src/renderer/shared/settings.js", import.meta.url), "utf8");
  assert.match(settings, /usageDashboardEnabled: true/);
  assert.match(settings, /statsRetentionDays: 90/);
});

test("usage panel renders overview and sessions from the aggregation API", () => {
  const source = read("UsagePanel.js");
  assert.match(source, /getUsageSummary/);
  assert.match(source, /getSessionInsights/);
  assert.match(source, /onTodayBurnUpdate/);
  // 两个 tab：总览 + 会话
  assert.match(source, /总览/);
  assert.match(source, /会话/);
  // 时间范围切换（PRD：回看几个月的趋势）
  for (const label of ["7 天", "30 天", "90 天"]) assert.match(source, new RegExp(label));
  // 趋势图（手写 SVG）与热力图
  assert.match(source, /usage-trend-chart/);
  assert.match(source, /usage-heatmap/);
  // 按 Agent / 按模型表
  assert.match(source, /按 Agent/);
  assert.match(source, /按模型/);
});

test("usage panel never shows a fake zero cost and marks unknown pricing", () => {
  const source = read("UsagePanel.js");
  assert.match(source, /unknownTokens > 0\) return "未知"/);
  assert.match(source, /formatCost/);
  // 会话分类徽章 + remote 标注
  for (const term of ["快速", "标准", "马拉松", "自动化", "远程"]) {
    assert.match(source, new RegExp(term));
  }
  assert.match(source, /CATEGORY_LABELS/);
  assert.match(source, /peakContextTokens/);
  assert.match(source, /durationMs/);
});

test("usage panel supports JSON export and confirmed clear", () => {
  const source = read("UsagePanel.js");
  assert.match(source, /exportUsageData/);
  assert.match(source, /clearUsageData/);
  assert.match(source, /window\.confirm/);
  assert.match(source, /不可恢复/);
  const ipc = readFileSync(new URL("../src/shared/ipc.cjs", import.meta.url), "utf8");
  for (const channel of ["usage:get-summary", "usage:get-session-insights", "usage:export-data", "usage:clear-data"]) {
    assert.match(ipc, new RegExp(channel.replace(/:/g, "\\:")));
  }
  const preload = readFileSync(new URL("../src/preload/island.js", import.meta.url), "utf8");
  assert.match(preload, /getUsageSummary\(days\)/);
  assert.match(preload, /exportUsageData\(\)/);
  const css = readFileSync(new URL("../src/renderer/island/app.css", import.meta.url), "utf8");
  assert.match(css, /\.usage-trend-bar-input/);
  assert.match(css, /\.usage-heatmap-cell/);
});

test("usage panel only consumes aggregated bridge data (no transcript/path access)", () => {
  const source = read("UsagePanel.js");
  // ADR-0004 边界：看板不读 prompt/transcript/文件路径/密钥（只匹配真实 API 调用形态）
  for (const forbidden of ["transcriptPath", "readFile", "writeFile", "apiKey", "process\\.env", "require\\("]) {
    assert.doesNotMatch(source, new RegExp(forbidden));
  }
  assert.match(source, /window\.islandBridge/);
});
