# Grok Build 接入与 Grok Bot 边界

本连接器针对终端里的 **Grok Build（`grok`）**，不是 Grok Bot 桌面客户端。支持提问后的工作状态、工具活动、本轮完成、失败/取消及真正的原生审批等待提示，保留终端来源跳转。审批继续在 Grok 原生终端处理，WorkIsland 不替它输出批准、拒绝或继续执行指令。

在包含此功能的版本中，进入「设置 → 智能体 → Grok Build」主动连接。连接器默认关闭。它只写独立的 `~/.grok/hooks/workisland-status.json`；设置了绝对 `GROK_HOME` 时使用该配置目录。不修改 `config.toml`、其他 Hook、Claude/Cursor 配置或项目的信任状态。连接后开始新 Grok 会话。配置成功先显示待事件，收到有效事件后才标记已验证。

Grok 原生带有会话 ID，不用目录猜身份。一次 `Stop` 是本轮完成，`SessionEnd` 才是会话退出；取消和 API 错误不会被报告成成功。子 Agent 的结束不提前结束父任务；`idle_prompt` 也不当成成功证明。只有 `Notification(permission_prompt)` 表示原生 UI 真正在等待审批，工具执行前的 Hook 不伪造审批。原生等待状态会在下一次工具/结果、用户输入或会话结束事件时清理。

Grok 默认兼容加载 Claude/Cursor Hook。WorkIsland 根据 Grok runner 注入的原生事件/会话元数据，跳过错误来源的兼容 wrapper，避免同一 Grok 任务又出现 Claude 卡片。真正嵌套的其他 Agent、具有不同原生会话 ID 时仍保留。不会通过关闭用户其他兼容钩子来解决串报。

自有配置更新前有 `.workisland.backup`；目标文件碰撞或损坏时不覆盖。卸载保留后来添加的非自有 Hook，包括同一 group 内混入的用户命令。离线、无响应时观察进程安静退出，不向 Grok 发门禁决策。企业策略若禁止普通 Hook，不会被本连接器绕过。

## 当前验证

官方 Grok Build 1.0.70 在临时目录运行，使用本地 OpenAI 兼容测试模型，已收到真实 CLI 发出的原生会话 ID、提问、本轮完成与会话结束事件。曾以故障的测试响应验证失败事件；这里不声称运行过 Grok 云端模型。独立转发测试还覆盖原生审批等待、恢复、兼容 wrapper 跳过、禁用和离线/超时；实际 Electron 设置页的配置/已验证状态切换已检查。

1.0.70 的 `grok inspect --json` 在这组隔离测试中未列出全局 Hook，但实际 headless 执行已触发它们；不使用该命令的空列表作为“未连接”的唯一依据。

开发测试（不会安装 Grok，也不改真实配置）：

```sh
node scripts/smoke-grok-build-hooks.mjs
FLUX_GROK_BINARY=/absolute/path/to/grok node scripts/smoke-grok-build-native.mjs
```

## Grok Bot 暂不接入

Grok Bot 的任务在云电脑中持续执行，关闭本机客户端不代表任务完成。当前公开的 Inference Hooks 是企业模型请求审计；Action Recording / OpenTelemetry 也需要管理员与服务端采集配置，不能直接当作普通账号的本机任务 Hook。此轮不新增一个只能检测到客户端、却伪称知道工作状态的 Bot 连接器。未来若有可用的会话生命周期接口，再单独适配。

参考：[官方 Build Hook 手册](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md)、[官方开源仓库](https://github.com/xai-org/grok-build)、[Bot 概述](https://docs.x.ai/grok-bot/overview)、[Bot Inference Hooks](https://docs.x.ai/grok-bot/inference-hooks)。
