# PRD-021: Grok Build 生命周期接入

- Issue: https://github.com/qianzhu18/workisland/issues/206
- Pull Request: https://github.com/qianzhu18/workisland/pull/207
- 状态：实现与本地验证完成，等待独立 PR 检查；不合并、不更新用户安装版本。

## 问题与目标

用户希望 WorkIsland 识别 Grok Build 终端任务，像现有智能体一样显示工作、工具活动、完成和待审批状态。Grok Bot 与 Build 是不同运行环境，不能把桌面进程存在当成云端任务状态。

## 交付范围

- 默认关闭的 Grok Build 连接器，使用官方原生 JSON Hook，无新依赖或常驻轮询。
- 原生会话 ID 隔离并发任务，区分本轮完成、失败、取消和会话结束；子 Agent 不结束父会话。
- 仅观察真实原生审批等待，用户仍在 Grok 终端批准；观察进程不输出决策且有退出时限。
- 跳过 Grok 兼容加载的重复 Claude/Cursor wrapper，保留具有不同原生 ID 的嵌套 Agent。
- 独立自有配置文件、更新备份、碰撞保护、卸载保留外来命令；不改用户项目信任和既有兼容配置。
- 配置成功与真实事件验证分别显示；保留实际终端跳转信息。

## 不在本轮范围

Grok Bot 云端企业审计/采集接口、远程审批控制、自动安装 Grok、发布安装包及更新用户本机应用。用户先检查 Kiro 与 Build，再决定合并发布。

## 验证与验收边界

- 全量检查：748 项，747 通过，1 项 Windows PowerShell 原生命令测试在 macOS 跳过。
- 生成的 Hook 命令经过真实桥接转发，覆盖双会话、原生审批恢复、兼容去重、禁用及断线超时。
- 官方 Grok Build 1.0.70 (f50904eaee6c) 在隔离目录调用本地测试模型，真实原生提问、完成和退出事件通过；未验证 Grok 云端模型。
- Electron 设置页配置/已验证状态用合成事件检查通过；真实原生审批 UI 和用户 Grok 账号验收仍待执行。
- 最终提交的跨平台 CI 待 PR 执行，不以本机跳过替代 Windows 通过。

## 设计与使用

- [设计](../../superpowers/specs/2026-10-28-grok-build-integration-design.md)
- [实施计划](../../superpowers/plans/2026-10-28-grok-build-integration.md)
- [接入说明与官方来源](../../GROK-BUILD.md)
