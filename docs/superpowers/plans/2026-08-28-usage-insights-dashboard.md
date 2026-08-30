# Usage Insights Dashboard（PRD-015）实施计划

日期：2026-08-28
分支：`feature/usage-insights-dashboard`（基于 origin/main @ 2917fcf）
关联：vault `docs/02-prd/PRD-015-Usage-Insights-Dashboard.md`
设计：[2026-08-28-usage-insights-dashboard-design.md](../specs/2026-08-28-usage-insights-dashboard-design.md)

## Goal

在 Island 工具箱内提供「用量」看板：每日 / 每 Agent / 每模型的 token 与成本聚合（缓存感知微美元），90 天保留，会话分类（quick / standard / marathon / automation），活动热力图，JSON 导出与一键清除。不读 prompt / transcript 内容、不新增遥测、不做云同步（ADR-0004）。

## Architecture

- 采集层（已有 + PR #38 合入）：`adapters-extended.cjs` 的 transcript 采集器给出会话累计值，`applyBaselineDiff` 差分为增量；重启基线回落 `StatsService.getTokenTotals` 防重复计数。
- 存储层：`stats-service.cjs`（userData/stats/*.json，原子写，5 分钟防抖，保留期默认 90 天可配 `statsRetentionDays`，上限 10 万条）。维持 JSON，不引入 SQLite（先测再定，PRD 风险 2）。
- 定价层：`usage-pricing.cjs`（LiteLLM 拉取 + 24h TTL 本地缓存 + 内置离线快照；整数微美元；缺价 → unknown 绝不折 0）。
- 聚合层：`usage-service.cjs`（本地时区按日/Agent/模型聚合、会话洞察与分类、导出/清除）。
- 展示层：`UsagePanel.js`（工具箱第 5 模块；手写 SVG 趋势柱 + CSS 网格热力图；中文文案硬编码）。

## Tasks

- [x] T1 合入 PR #38（Claude/Codex token 采集），修复 cache-only 增量丢失口径，补重启基线测试。验证：`node --test tests/token-capture.test.mjs`
- [x] T2 StatsService：DI 构造（`{ statsDir, retentionDays }`）、保留期 8→90 天（钳制 [8,730]）、MAX_RECORDS 1e4→1e5、`recordToken` 持久化 `model`、`recordSession` 记 `sessionId`、旧记录迁移归一化 `model:"unknown"`、ALL_TOOLS 对齐 agent-catalog。验证：`node --test tests/stats-service.test.mjs`
- [x] T3 定价模块 `src/main/usage-pricing.cjs`。验证：`node --test tests/usage-pricing.test.mjs`
- [x] T4 聚合 API `src/main/usage-service.cjs` + IPC 四通道（usage:get-summary / get-session-insights / export-data / clear-data，契约计数 140→144）。验证：`node --test tests/usage-service.test.mjs`
- [x] T5+T6 UsagePanel（总览/会话 tab、7/30/90 天切换、趋势图、热力图、按 Agent/模型表、分类徽章、remote 标注）。验证：`node --test tests/usage-panel-ui.test.mjs tests/productivity-toolbox-model.test.mjs`
- [x] T7 导出（原生保存对话框写 JSON）+ 清除（window.confirm 二次确认）。
- [x] T8 全量验证：`npm run check`（build:renderer + 静态检查 + 源契约 + 单测 272 项全绿）。
- [ ] 实机验证：真实多日使用数据截图 + 抽样核对回写 vault `docs/05-engineering/`（EVD-2026-001 已建骨架，待补真实环境部分）。

## Files

- 主进程：`src/main/stats-service.cjs`、`src/main/usage-pricing.cjs`（新）、`src/main/usage-service.cjs`（新）、`src/main/adapters-extended.cjs`、`src/main/app-coordinator.cjs`、`src/main/ipc-services.cjs`
- 共享/预加载：`src/shared/ipc.cjs`、`src/preload/island.js`
- 渲染层：`src/renderer/island/components/UsagePanel.js`（新）、`IslandPanel.js`、`productivity-toolbox-model.mjs`、`src/renderer/island/app.js`、`src/renderer/island/app.css`、`src/renderer/shared/settings.js`
- 测试：`tests/token-capture.test.mjs`、`tests/stats-service.test.mjs`（新）、`tests/usage-pricing.test.mjs`（新）、`tests/usage-service.test.mjs`（新）、`tests/usage-panel-ui.test.mjs`（新）、`tests/productivity-toolbox-model.test.mjs`、`scripts/test-source.mjs`
