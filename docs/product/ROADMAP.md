# WorkIsland Product Roadmap

状态：`active`  
路线类型：阶段门控，不按日历承诺功能

## Now: v0.3.0 Beta Pilot

目标：确认真实多 Agent 用户能完成“看得见、叫得回、接得上”的闭环。

- `v0.3.0-beta.1`：首批 5-8 名受邀用户，匿名统计默认关闭、操作手册和反馈入口可用。
- 只围绕最高频阻断问题决定是否发布 `beta.2`；每个 Beta 只验证一个主假设。
- 修正历史 Beta 的 GitHub Release 类型，避免 Beta 占用稳定更新通道。

毕业门槛：激活率至少 70%，D7 至少 40%，活跃日人均 `jump_back` 至少 1 次，且没有未处理的 P0。

### Beta.2 主假设：通知优先，而不是常驻占位

用户反馈表明，顶部 Island 在浏览器/编辑器标签栏场景会造成遮挡和注意力干扰。`v0.3.0-beta.2` 只验证一个体验假设：任务提交和完成各提醒 5 秒，其他时间默认隐藏；审批、提问和错误仍保持可操作。详细范围见 [EPIC-007](./epics/EPIC-007-FOCUS-AWARE-NOTIFICATIONS.md) 和 [PRD-007](./prd/PRD-007-FOCUS-AWARE-NOTIFICATIONS.md)。

交付顺序：

1. 合并独立的 Claude Desktop 会话识别修复（PR #29，已于 2026-08-18 合并）。
2. 合并 `fix/notification-only-default`，完成策略单测和 macOS 窗口验证。
3. 邀请 5-8 名 Beta 用户使用 3 天，收集遮挡、漏提醒和误打扰反馈。
4. 只有门槛达标才创建 `release/v0.3.0-beta.2`；否则只发修复包，不扩展功能面。

## Next: v0.3.0 Stable

目标：在上述门槛达标后形成可信的稳定安装和更新通道。

- 完成签名、公证、校验和、安装/卸载验证和用户手册校对。
- 发布稳定版 PRD、Release Notes 和 24 小时 / 7 天复盘。
- 在稳定产品证据出现后，才开始单渠道公开增长验证。

## Later: v0.4.x

目标：扩展已被用户证据支持的 Agent 兼容和诊断能力，而不是堆叠未经验证的新功能。

- 完成 Cursor、Trae、WorkBuddy、智谱和 Kimi 等适配能力分级。
- 提供一致的连接诊断和失败修复建议。
- 根据用户证据评估跨平台桌宠、第二显示面与更多 Work Agent。

### v0.4.x 候选：皮肤创作与 UGC

先做本地皮肤包，再做 MCP/CLI 创作协议，最后才开放审核后的社区商店。每一步都必须有用户导出/安装证据；不在 Beta 阶段引入支付、推荐或跨设备同步。见 [EPIC-008](./epics/EPIC-008-SKIN-UGC-MARKETPLACE.md)、[PRD-008](./prd/PRD-008-SKIN-MCP-UPLOAD.md)。

## 1.0 Mac App Store

目标：通过 macOS 商业发行验证，形成支持、升级、回滚和隐私事件处理流程。

## Long-term: Windows

Windows 是 `v0.5.x` 之后的独立 Epic，不与 macOS Beta 并行承诺。先抽象原生平台边界，再做 Alpha、Beta 和签名稳定版，详见 [EPIC-009](./epics/EPIC-009-WINDOWS-CROSS-PLATFORM.md)。

## 分支与 PR 计划

所有分支从最新 `main` 创建，每个分支只对应一个用户结果：

| 分支 | 目标 | 合并门 |
| --- | --- | --- |
| `fix/notification-only-default` | 默认隐藏、提交/完成 5 秒提醒 | 单测、双设备窗口验证 |
| `docs/beta2-focus-feedback` | Beta 手册、Release Notes、反馈问卷 | 文档链接和复盘模板齐全 |
| `feature/skin-local-package` | 本地 skin manifest、导入和预览 | validator 测试、恶意资源拒绝 |
| `feature/skin-mcp-tools` | MCP/CLI 模板、校验、导出 | 沙箱路径测试、3 个客户端试用 |
| `feature/windows-platform-shell` | Windows 原生边界和 Alpha 壳 | Windows CI、安装/卸载手测 |

皮肤商店服务端、Windows 客户端和支付能力不进入同一个 PR；先完成父 PRD 与 Issue 拆分，再按表中顺序排期。
