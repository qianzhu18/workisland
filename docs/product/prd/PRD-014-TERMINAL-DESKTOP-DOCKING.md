# PRD-014：可收放的桌面终端

状态：`in progress`

Owner：WorkIsland maintainers

目标版本：下一次功能迭代，未发布

跟踪：[Issue #202](https://github.com/qianzhu18/workisland/issues/202)

依赖：[PR #201](https://github.com/qianzhu18/workisland/pull/201)、[PRD-013](./PRD-013-MULTI-TERMINAL-MANAGER.md)

## 用户问题与结果

多 Agent 使用者既需要灵动岛集中管理，也需要把终端展开到桌面并排工作。用户要求可随意拖出、拖回，任务继续而不是重新启动。成功标准是同一任务与终端画面在两种位置间持续存在，而不是只复制一个窗口或命令。

| 场景 | 要求 | 验收 |
| --- | --- | --- |
| 从岛上拿出终端 | 抓手越过窗口边界，松手后桌面化；键盘按钮同一路径 | PID/webContents/xterm 实例不变 |
| 从桌面收回 | 专用抓手拖至岛上松手；按钮后备 | 滚动、选区、半行输入、TUI 保留 |
| 同时管理多个任务 | 列表标注位置、定向激活或关闭 | 不串输入/输出、不误关其他项 |
| 关闭窗口与结束任务 | 关闭窗口收回，终止会话需明确确认 | 任务生命周期与窗口独立 |
| 取消与异常 | Escape、失焦、丢失捕获、加载失败安全回退 | 无孤儿窗口或被意外终止的 PTY |

## 约束

沿用现有视觉和提醒规则；新增运行时依赖为零；视图懒创建、输出与数量有界。外部普通原生终端不能直接接管，tmux 属后续独立集成。只操作 WorkIsland 自有窗口与会话，不采集或上传额外终端内容。

## 任务与发布

按[设计](../../superpowers/specs/2026-10-27-terminal-desktop-docking-design.md)与[实施计划](../../superpowers/plans/2026-10-27-terminal-desktop-docking.md)推进：持久视图与生命周期、最小 IPC 与独立页面、拖拽和焦点、真实包验证与文档。GitHub issue 和 PR 负责最终进度与验证状态。

合并前需要 source/native/Windows 检查、真实 macOS UI 证据及明确未覆盖设备项。此轮交付源码、隔离签名预览和 PR，不替换正式安装或公开发布。后续发布按现有版本 PRD、签名、公证及更新校验流程；回滚恢复 PR #201 的岛内终端方式。
