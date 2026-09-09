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
  assert.match(panel, /\["usage", t\("toolbox\.usage"\), UsageToolIcon\]/);
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
  // Two localized tabs: overview + sessions.
  assert.match(source, /usage\.tab\.overview/);
  assert.match(source, /usage\.tab\.sessions/);
  // 时间范围切换（PRD：回看几个月的趋势）
  for (const label of ["usage.range.7", "usage.range.30", "usage.range.90"]) assert.match(source, new RegExp(label.replaceAll(".", "\\.")));
  // 趋势图（手写 SVG）与热力图
  assert.match(source, /usage-trend-chart/);
  assert.match(source, /usage-heatmap/);
  // 按 Agent / 按模型表
  assert.match(source, /usage\.section\.byAgent/);
  assert.match(source, /usage\.section\.byModel/);
});

test("usage panel never shows a fake zero cost and marks unknown pricing", () => {
  const source = read("UsagePanel.js");
  assert.match(source, /unknownTokens > 0\) return t\("common\.unknown"\)/);
  assert.match(source, /formatCost/);
  // 会话分类徽章 + remote 标注
  for (const term of ["usage.category.quick", "usage.category.standard", "usage.category.marathon", "usage.category.automation", "usage.remote"]) {
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
  assert.match(source, /usage\.clear\.confirm/);
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
