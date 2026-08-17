# 匿名遥测说明（opt-in）

状态：`active` · 对应 [PRD-005](./product/prd/PRD-005-ANONYMOUS-TELEMETRY.md)

WorkIsland 内置一套**默认关闭**的匿名使用统计。本文说明它采集什么、不采集什么，以及如何配置接收端（PostHog Cloud）和查看内测指标。

## 隐私承诺（对用户的完整承诺，也是实现的验收标准）

- **默认关闭**。首次启动欢迎页提供一次性勾选；升级后若尚未确认当前通知，也会显示一次独立的隐私选择窗口；设置 → 关于 → 匿名使用统计可随时开关。
- **关闭即真关闭**：关闭开关的瞬间，本地未上报队列被清空，之后不再产生任何网络请求。
- **白名单最小化**：只上报事件类型、Agent 名称、动作类型、终端类型、App/macOS 版本和一串随机匿名编号。**绝不包含**会话内容、代码、文件路径、项目名、主机名、用户名。
- **代码开源可审计**：全部逻辑在 `src/main/telemetry-service.cjs` 与 `src/shared/telemetry.cjs`，无闭源 SDK；渲染层 CSP 保持 `connect-src 'none'`，出网只发生在主进程。
- 开发构建（未打包）**从不上传**。

## 事件清单

| 事件 | 含义 | 属性 |
| --- | --- | --- |
| `app_launched` | 应用启动 | — |
| `first_agent_signal` | 本次安装首次收到 Agent 事件（激活信号，仅一次） | `tool` |
| `session_started` / `session_completed` | 会话开始 / 完成 | `tool` |
| `approval_handled` | 处理审批 | `action`、`tool` |
| `question_answered` | 回答提问 | `tool` |
| `jump_back` | 回源跳转（北极星指标） | `target`、`tool` |
| `settings_changed` | 白名单设置项变更（只发 key） | `key` |

## 部署：接入 PostHog Cloud（一次性，约 10 分钟）

1. 注册 [PostHog Cloud](https://posthog.com) 免费版，创建 Project（如 `workisland-telemetry`）。
2. 在 Settings → Project → API Keys 复制 **Project API key**（`phc_` 开头，只写权限，可随时轮换）。
3. 填入 `src/shared/telemetry.cjs` 的 `POSTHOG_API_KEY`。**当前已配置（2026-08-17，key 已通过 `/batch/` 端到端验证）**；如使用 EU 区，把 `POSTHOG_HOST` 改为 `https://eu.i.posthog.com`。
4. 打包构建（`app.isPackaged` 为 true）后，勾选同意开关即可在 PostHog Live events 看到 `app_launched`。
5. 开发调试：开发模式不出网，但同意后事件会写入 `<userData>/telemetry/pending.json`，可直接检查将要上报的内容。

免费版额度备忘：1 个 Project、约 2 万事件/月。内测 50 人 × 每天约 10–20 个事件 ≈ 1.5–3 万/月，可能触顶；触顶时优先做事件降频（如 `session_started` 聚合为按天计数）或迁移自建端（见下）。单 Project 足够：多版本用 `appVersion` 属性区分。

## 推荐 Insight 配置（对应内测毕业标准）

在 PostHog 中创建：

1. **激活漏斗（Funnel）**：`app_launched` → `first_agent_signal`，按 distinct_id 去重，7 天窗口。
   - 毕业线：≥ 70%（对应"5 分钟内看到真实 Island"）。
2. **D7 留存（Retention）**：按 `app_launched` 的 distinct_id 首日分组，第 7 天回访以任一事件计。
   - 毕业线：≥ 40%。
3. **回源强度（Trend）**：`jump_back` 总数 ÷ 活跃 distinct_id 数（按天）。
   - 毕业线：活跃日人均 ≥ 1。
4. **Agent 分布（Trend，breakdown by `tool`）**：`session_started` 按 `tool` 分解——反哺适配优先级。
5. **审批漏斗**：`session_started` → `approval_handled`，观察 Island 审批采用率。

## 扩充事件 / 属性的流程

白名单是唯一数据出口。任何扩充必须：先更新 PRD-005 的事件表 → 再改 `src/shared/telemetry.cjs`（`EVENTS` / `PROPERTY_WHITELIST` / `SETTINGS_KEY_WHITELIST`）→ 补测试。`sanitizeProps` 会静默丢弃白名单之外的一切字段，这是设计上的失败安全（fail-closed）。

## 运维备忘

- 队列文件：`<userData>/telemetry/pending.json`（上限 500 条，超限丢最旧）；匿名编号：`telemetry/state.json`。
- 上报节奏：每 5 分钟批量 flush（每批 ≤100 条），8s 超时，失败静默保留重试，退出前尽力 flush 一次。
- Key 泄露处置：PostHog 控制台轮换 key，更新常量发版即可——旧 key 无法读取任何数据。
