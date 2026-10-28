# PRD-020：Kiro IDE / CLI 接入

状态：`implemented — IDE native-turn acceptance pending`
Owner：WorkIsland maintainers
目标版本：下一次功能迭代，未发布
跟踪：[Issue #204](https://github.com/qianzhu18/workisland/issues/204)、[PR #205](https://github.com/qianzhu18/workisland/pull/205)

## 用户问题与目标

用户需要像其他智能体一样识别 Kiro IDE 与 CLI，会话工作、工具活动及本轮完成应进入现有 Island 管线，点击能返回正确来源。不能把发现进程、写好配置和收到真实事件混为一谈。

## 行为与边界

- IDE 1.x / CLI V3 使用独立的新格式全局 Hook；经典 CLI 提供显式 `workisland-status` profile，不改默认 Agent 或引擎。
- 使用原生会话 ID；经典 CLI 缺失 ID 时仅在确认 Kiro 父进程后按该进程区分。不同目录不是唯一身份，相同目录不能吞并并行任务。
- `Stop` 代表本轮结束；`SessionStart` 单独到达时不伪报工作中。工具事件只表示活动，审批和提问留在 Kiro。
- 默认关闭，用户主动连接。其他 Hook 文件和配置保留，碰撞/损坏不覆盖，失败回退、卸载保留非自有条目。

## 实施与验证

[设计](../../superpowers/specs/2026-10-28-kiro-agent-integration-design.md)与[计划](../../superpowers/plans/2026-10-28-kiro-agent-integration.md)记录模块和测试。用户手册见 [Kiro 接入](../../KIRO.md)。

748 项本地检查通过；生成命令经真实 Unix bridge 的合成生命周期测试通过，覆盖来源跳转、禁用、离线及无响应退出。Kiro CLI 2.35.1 已通过 profile 格式校验；隔离配置下 V3 实际模型任务成功，收到原生 session ID 及 prompt/Stop 对应事件。本机 IDE 1.4.51 的新格式全局加载链和工作区信任分支已静态核对，WorkIsland 设置页入口及配置后待事件、收到有效事件后已验证的状态切换，已通过实际 Electron 预览的合成事件检查。

IDE 原生对话和真实工具审批仍需验收；没有声称已在 IDE 中收到完整任务事件，也没有声称提供 Island 审批。此轮只交付分支/PR，没有改用户真实 Kiro 配置、默认引擎或安装中的 WorkIsland，不自动合并发布。
