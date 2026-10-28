# Kiro IDE 与 CLI

WorkIsland 的 Kiro 连接器使用 Kiro 自己的生命周期 Hook，显示提问后的工作状态、当前工具和本轮结束，并保留来源跳转。权限确认和问题回答继续在 Kiro 中完成，不会因工具启动就伪造审批提示。暂不提供 Kiro 额度统计。

在包含此功能的版本中，进入「设置 → 智能体 → Kiro（IDE / CLI）」点击连接。初始默认关闭；写好配置会显示等待事件，收到有效会话事件后才标记已验证。当前正式安装是否包含此功能，以该版本日志为准。

| 使用方式 | 配置与启动 |
| --- | --- |
| Kiro IDE 1.x | 新格式全局 `~/.kiro/hooks/workisland-status.json`；连接后在 Kiro 打开有工作区根目录的、已由用户信任的项目，并开始新会话。 |
| Kiro CLI V3 | 复用全局文件；例如 `kiro-cli --v3 chat`。CLI 2.35.1 已包含 V3，引擎与可执行文件版本不是同一个概念。 |
| 经典 CLI 引擎 | 独立 `~/.kiro/agents/workisland-status.json`，启动 `kiro-cli chat --agent workisland-status`；不会改默认 Agent，也不会给已有自定义 Agent 批量追加 Hook。 |

绝对路径 `KIRO_HOME` 会替代默认 `.kiro` 配置目录。不会改 `~/.kiro/settings/cli.json`，也不会自动切换引擎。全局与项目 Hook 会并行加载，不要另在项目复制同一份 WorkIsland Hook。经典 helper 被 V3 加载时跳过现代事件，防止与全局 Hook 重复报告。

已存在的其他 Hook 文件与设置保留；如果目标文件已被其他配置占用或 JSON 损坏，连接失败并说明原因。已有自有配置更新前有 `.workisland.backup`，卸载只移除自有 Hook，保留后来添加的外部条目。WorkIsland 离线或桥接无响应时，观察脚本安静退出，Kiro 仍使用自己的审批与执行规则。

优先使用 Kiro 原生 `session_id`；经典 CLI 缺少该 ID 时仅在确认其 Kiro 父进程后按进程区分，不按工作目录合并并行会话。同一个经典 CLI 进程内、缺少原生 ID 的多次新会话仍归该进程。没有身份的 IDE 事件被忽略，不能据此声称多个会话都已识别。

IDE 1.4.51 安装包中已核对新格式全局加载器与工作区信任检查；未信任的工作区、无根目录会话可能不执行 Hook。配置成功不能替代真实事件验证。

官方依据：[Hooks](https://kiro.dev/docs/hooks/)、[配置作用域](https://kiro.dev/docs/configuration/)、[IDE 1.x 格式](https://kiro.dev/docs/ide/whats-new-v1/hooks/)、[CLI 引擎](https://kiro.dev/blog/cli-3/)、[V3 迁移](https://kiro.dev/docs/cli/v3/hooks-migration/)。开发设计与验证见 [实现计划](superpowers/plans/2026-10-28-kiro-agent-integration.md)。
