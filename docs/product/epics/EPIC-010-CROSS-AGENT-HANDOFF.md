# EPIC-010：本机跨 Agent 任务交接

状态：`active`  
Owner：待认领  
关联 Roadmap：Agent Core Reliability  
目标版本：待排期；搜索闭环 #115 仍按 v1.4.0 推进  
相关 GitHub Issue：[总 Issue #126](https://github.com/qianzhu18/workisland/issues/126)

## 1. 用户结果

用户能在 WorkIsland 搜索历史工作，找到正确项目和会话后，带着可信的进度交给另一个 Agent 继续。首个完整演示是 **ZCode 与 Codex 双向交接**；Claude Code 作为终端 TUI 目标，通过本机 tmux 定位、恢复或启动。

产品体验只呈现三个动作：**回到任务**、**用其他 Agent 继续**、**查看交接内容**。用户无需查找按日期生成的会话文件夹，也不必重新解释已完成的工作。

## 2. 设计原则

### 任务不是客户端会话

一个工作任务可以先在 ZCode 中讨论，再由 Codex 改代码，最后在 Claude Code 中复核。每个客户端继续管理自己的原生会话；WorkIsland 不合并或共享它们的私有目录与数据库。

WorkIsland 管理的是一次可追溯的**交接快照**，它将原会话和当前工作目录的证据汇总为一个可预览、可失效的任务材料包。

```text
原生会话（ZCode / Codex / Claude）
                 ↓ 只读索引与按需取证
搜索与原会话跳转（#115）
                 ↓ 用户选择“用其他 Agent 继续”
交接快照：会话证据 + 当前 Git/worktree 证据
                 ↓ 预览、确认、交付
目标客户端或本机 tmux TUI
                 ↓
prepared → delivered → read → verified / failed
```

### 事实和总结分开

“下一步建议”可以由人或 Agent 写入；分支、commit、未提交修改、测试结果、工作目录和会话来源必须来自生成交接快照时的可检查证据。目标启动或读取时会重新检查 Git；发现差异时将快照标记为 `stale`，由用户决定是否重新生成。

### 不虚报交接成功

`prepared` 表示包已生成；`delivered` 表示已复制或传给目标入口；`read` 表示目标客户端有可信读取回执；`verified` 表示目标已核对任务和当前工作位置。没有回执能力的客户端只能显示前两个状态。

### 本机与远程分界

本 Epic 只操作本机的 tmux。远程主机状态上岛由 [#116](https://github.com/qianzhu18/workisland/issues/116) 管理，目前仍是 observe-only 范围；本 Epic 不新增 SSH、远程 `send-keys`、relay 或账户服务。

## 3. 交接快照内容

| 字段组 | 内容 | 生成依据 |
| --- | --- | --- |
| 任务理解 | 目标、范围、完成项、待办、决定、失败尝试、下一安全动作 | 用户确认或带来源引用的会话材料 |
| 会话出处 | source、session ID、transcript 路径、关键消息引用 | 统一会话索引 |
| 工作位置 | repo、worktree、branch、HEAD、dirty 摘要 | 实时 Git 检查 |
| 验证证据 | 已运行命令、结果、关联 Issue/PR、采集时间 | 本地可追溯证据 |
| 完整性 | schema 版本、生成时间、过期状态、隐私摘要 | 交接服务 |

交接快照仅保存在应用数据目录。不得默认保存原始 prompt/回复全文、密钥、Cookie、token 或未过滤的工具输出，也不得上传到网络。

## 4. 任务地图与认领顺序

| Issue | 可认领成果 | 依赖 | 推荐分支 |
| --- | --- | --- | --- |
| [#127](https://github.com/qianzhu18/workisland/issues/127) | 搜索 UI、隐私控制与回源跳转 | [#120](https://github.com/qianzhu18/workisland/pull/120) 索引器 | `feature/session-search-ui` |
| [#128](https://github.com/qianzhu18/workisland/issues/128) | 交接快照、Git 证据、过期校验和状态契约 | #115 的统一会话身份 | `feature/handoff-contract` |
| [#129](https://github.com/qianzhu18/workisland/issues/129) | ZCode ↔ Codex 双向交接与状态反馈 | #127、#128 | `feature/zcode-codex-handoff` |
| [#130](https://github.com/qianzhu18/workisland/issues/130) | 本机 tmux 的精确定位、attach 与隔离窗口启动 | 无 | `feature/local-tmux-location` |
| [#131](https://github.com/qianzhu18/workisland/issues/131) | Claude Code TUI 定位、指定会话恢复和新交接启动 | #128、#130 | `feature/claude-tui-handoff` |
| [#132](https://github.com/qianzhu18/workisland/issues/132) | 端到端验收、隐私检查与状态回执矩阵 | #127–#131 | `test/cross-agent-handoff` |

可以立刻并行认领 #127、#128 和 #130。#129 需要前两个任务的接口稳定；#131 等 #128 和 #130；#132 可以先准备 fixture，真实验收放在功能合并后完成。

## 5. 客户端适配规则

每个客户端适配器显式声明能力，而不是由 UI 猜测：能否打开原会话、能否在指定项目启动新会话、能否向目标提供交接包、能否返回读取回执。能力不足时，WorkIsland 仅执行“复制材料 + 打开应用”的可见降级，并准确显示 `prepared` 或 `delivered`。

Claude Code TUI 的本机运行位置分三种处理：运行中则定位已有 tmux pane；会话已结束但可恢复则在匹配项目中执行 `claude --resume <session-id>`；新交接只在用户确认后的隔离 tmux window 中启动。不会向按路径猜测的已有 pane 自动发送文本。

## 6. 验收场景

用三种真实任务复核整个体验：正在开发的功能、带失败尝试的 bug、涉及多个 worktree 或 PR 的任务。每个场景必须证明：

- 搜索命中正确会话和项目；
- 目标 Agent 不需要重新询问已知背景，能准确说出下一步；
- 目标工作目录、branch、HEAD 与交接快照一致，变更会显式提示；
- 原位置存在时会定位而非重复启动；不存在时只在新的受控位置启动；
- 无读取回执时不显示“已接手”；
- 测试材料、日志和快照不含敏感内容。

## 7. 开发与评审约定

- 每个 PR 只关闭一个 Issue，且在 PR 模板中说明交付状态能到达哪一级。
- 从最新 `main` 创建隔离分支或 worktree；不从尚未合并的 #120 直接切分支。需要它的接口时，用 fixture 或与 #120 作者协调。
- 修改主进程 IPC、会话状态、终端跳转时补行为测试；macOS 自动化难覆盖的行为需给出实机录屏或步骤。
- 交接内容是用户工作材料，UI 首次生成和发送前必须可预览，且说明它只保存在本机。
