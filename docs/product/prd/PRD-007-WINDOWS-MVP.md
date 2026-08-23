# PRD-007：Windows MVP

状态：`draft implementation`
Owner：WorkIsland contributors
目标版本：v0.3.x Beta
GitHub tracking Issue：待创建

## 1. 用户问题与证据

Windows 上并行使用 Claude Code、Codex、Cursor、VS Code 与 Windows Terminal 的开发者，同样需要在多个 Agent 会话之间识别待审批、待回答和已完成状态。当前发行包、Hook 传输、声音、日志导出和回源跳转均含 macOS 假设，Windows 用户无法形成完整闭环。

## 2. 目标与非目标

### 目标

- Windows 11 x64 用户可以安装并启动 WorkIsland，在屏幕顶部或边缘查看 Agent 状态。
- Claude Code、Codex 等本地 Hook 可通过每用户命名管道连接 WorkIsland。
- 点击会话可以激活 Windows Terminal、PowerShell、Cursor、VS Code 等来源应用；系统声音和诊断日志导出可用。

### 非目标

- 本期不承诺按 `WT_SESSION` 精确切换到 Windows Terminal 的现有标签页；Windows Terminal 尚无对应公开激活接口。
- 本期不支持 Windows 10、32 位 Windows、自动更新、代码签名或 Microsoft Store。
- macOS 专属触觉反馈、刘海检测和 AppleScript 后台文本注入不在 Windows 上模拟。

## 3. 用户旅程与需求

| 用户故事 | 行为要求 | 优先级 | 验收证据 |
| --- | --- | --- | --- |
| 安装应用 | NSIS 安装包与便携版均可生成 | P0 | Windows CI 构建产物 |
| 连接 Agent | Hook 使用稳定、隔离到当前用户的命名管道 | P0 | 单元测试与真实 Hook 事件 |
| 发现任务 | 无 macOS 原生模块时仍显示透明置顶悬浮岛 | P0 | Windows 11 UI 截图 |
| 回到来源 | 优先激活已有窗口，不存在时启动已知应用 | P0 | 自动化命令测试与真机检查 |
| 获得提醒 | WAV 通过系统内置 PowerShell SoundPlayer 播放 | P1 | 服务单元测试 |
| 导出诊断 | 输出不包含会话内容与项目文件的 ZIP | P1 | Windows 真机导出 ZIP |

## 4. 约束与风险

- 交互 / 可访问性：Windows 无刘海，默认使用顶部居中悬浮岛；用户可切换贴边模式。
- 隐私 / 安全：命名管道按用户目录哈希命名；命令调用不经过字符串拼接 Shell；日志规则不扩大。
- 技术 / 兼容性：窗口级激活依赖 Windows 的 `WScript.Shell.AppActivate`，标题冲突时可能只激活应用而非精确会话。
- 发布 / 回滚：Windows 构建为独立 CI job，不改变 macOS DMG；失败时可只撤回 Windows 产物。

## 5. 指标与学习计划

| 要回答的问题 | 指标或定性证据 | 数据来源 | 判定阈值 |
| --- | --- | --- | --- |
| 能否完成首个任务闭环 | 安装→连接→收到完成状态→回到来源 | 5 次真机走查 | 5/5 成功 |
| Hook 是否稳定 | 启动、审批、完成事件到达率 | 脱敏本地测试记录 | 关键事件 100% |
| 回源是否足够有用 | 激活正确来源应用 | 20 次手动点击 | ≥ 95% |

## 6. Task 拆分

| Task Issue | 类型 | 依赖 | 完成定义 |
| --- | --- | --- | --- |
| Windows 运行时与 Hook 传输 | 工程 | 无 | 命名管道和命令测试通过 |
| Windows 桌面集成 | 工程/设计 | 运行时 | 窗口、声音、回源、日志可用 |
| Windows 打包与 CI | 工程/运营 | 前两项 | NSIS 和 portable 产物生成 |
| Windows Beta 真机验收 | 测试 | 构建产物 | 完成上方验收矩阵 |

## 7. 发布与文档影响

- README 与贡献指南增加 Windows 安装、开发和已知限制。
- Release workflow 增加 Windows x64 产物和 SHA-256。
- Beta Release Notes 必须明确未签名构建与 Windows Terminal 精确标签页限制。
