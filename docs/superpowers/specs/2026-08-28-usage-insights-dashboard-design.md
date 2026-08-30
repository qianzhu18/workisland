# Usage Insights Dashboard 设计说明

日期：2026-08-28
分支：`feature/usage-insights-dashboard`

## 目标与非目标

见 vault PRD-015。核心边界：看板只消费 `StatsService` 的聚合 token 记录；采集侧（PR #38）仅在会话完成时解析 agent 自己的 transcript 提取 usage 数字，不落盘任何内容；不做云同步/账户/团队报表；不新增遥测。

## 默认交互

- 入口：Island 面板顶部工具行第 4 个模块按钮「用量」（与文件架/剪贴板/终端同级）。Agent Center 独立窗口（路线图 M2）落地后迁移。
- 打开后默认「总览」tab、7 天范围：统计卡（总 token / 成本（估）/ 会话数 / 远程用量）→ 趋势柱状图（蓝=输入、绿=输出、黄=缓存，悬停显示明细）→ 活动热力图（按日强度四级）→ 按 Agent 表 → 按模型表。
- 「会话」tab：最近会话列表（Agent + 模型、输出 token、峰值上下文（估计）、时长、分类徽章；remote 会话标「远程」）。
- 时间范围切换 7/30/90 天；token 有新增（今日烧量推送）自动刷新。
- 标题行操作：「导出」（原生保存对话框，JSON 含 token/session 记录与定价元信息）、「清除」（`window.confirm` 二次确认后清空本地记录并刷新）。

## Settings 语义

- `usageDashboardEnabled`（默认 true）：控制模块按钮与聚合查询入口；关闭后模块不出现。
- `statsRetentionDays`（默认 90，主进程钳制 [8, 730]）：token/session 记录保留期。

## 成本口径

- 单位：整数微美元；表内价格换算为「每百万 token 美元」，`microUsd = perMillionUsd × tokens`，逐条取整后累加。
- 缓存感知：新鲜输入、缓存读、缓存写、输出四类分别计价（LiteLLM `input_price` / `cached_input_price` / `cache_creation_input_price` / `output_price`）。
- 定价缺失：记录标记 unknown，聚合中单列 `unknownCostTokens`；UI 显示「未知」或「$X+未知」，绝不显示假 0。
- 定价源：LiteLLM `model_prices_and_zero_day_markups.json`（MIT），24h TTL 本地缓存（`userData/usage/pricing-cache.json`），内置精简快照离线兜底；刷新失败静默。模型名归一化（小写、去厂牌前缀、最长前缀匹配带日期变体）。

## 会话分类（保守初版，待真实数据校准）

| 分类 | 规则 |
| --- | --- |
| automation | 会话任一 token 记录带 remote 标记 |
| marathon | 活跃跨度 ≥ 60 分钟 或 总 token ≥ 200k |
| quick | 活跃跨度 < 10 分钟 且 总 token < 50k |
| standard | 其余 |

- 时长优先 join `session_records`（含 sessionId），否则退回 token 记录活跃跨度（首尾时间差，属低估）。
- peak context 为估计值：会话内单条记录的 `input + cacheRead + cacheCreation` 峰值。

## 数据规模决策

90 天估算 < 10 万条记录：内存聚合无压力，维持 JSON 原子写，不引入 SQLite 原生依赖（local-first；性能不佳再评估，PRD 风险 2）。
