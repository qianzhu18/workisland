# PRD-005: Anonymous Telemetry (opt-in)

状态：`in-progress`  
优先级：`P0`  
关联版本：[v0.3.0 Beta Pilot](./PRD-006-v0.3.0-Beta-Pilot.md)  
实现与运维：[Telemetry Guide](../../TELEMETRY.md)

## 1. 问题与目标

Pilot 需要验证首次价值、D7 留存、回源和 Agent 分布，但产品必须保持本地优先。目标是提供默认关闭、明确同意、可审计的匿名统计，而不收集会话内容或身份数据。

## 2. 非目标

- 不收集代码、会话内容、文件路径、项目名、主机名、用户名或设备标识。
- 不做会话录制、热力图、个性化推送或数据售卖。
- 不在开发构建中出网。

## 3. 事件白名单

| 事件 | 触发时机 | 仅允许的属性 |
| --- | --- | --- |
| `app_launched` | 明确同意后的应用启动 | 无 |
| `first_agent_signal` | 安装后首次收到 Agent 信号 | `tool` |
| `session_started` / `session_completed` | 会话开始 / 完成 | `tool` |
| `approval_handled` | 处理审批 | `action`、`tool` |
| `question_answered` | 回答提问 | `tool` |
| `jump_back` | 回到终端或 IDE | `target`、`tool` |
| `settings_changed` | 白名单设置项变更 | `key` |

每条事件仅可附带随机 `distinct_id`、`appVersion`、`osVersion` 与时间戳。扩充事件或属性必须先更新本 PRD，再改 `src/shared/telemetry.cjs` 并补测试。

## 4. 同意与关闭语义

1. 首次启动时同意框默认不勾选，用户点击进入时提交选择；从未记录本通知版本的既有安装会显示一次独立的隐私选择窗口。
2. 设置 -> 关于提供随时可用的开关。
3. 未同意时不写队列、不发网络请求。
4. 关闭时立即清空待上传队列，之后不再采集或上传。

## 5. 验收与指标

- [ ] 默认值为 `telemetryEnabled: false`。
- [ ] 白名单之外的事件和属性不能离开设备。
- [ ] 失败上传保留队列，应用保持可用。
- [ ] 单元测试覆盖未同意、同意、禁用、重试、队列上限和首启选择。
- [ ] PostHog 可形成 `app_launched -> first_agent_signal`、D7、`jump_back` 和 Agent 分布看板。
