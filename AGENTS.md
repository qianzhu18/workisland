# WorkIsland 协作与看板规则

适用范围：本仓库及其 GitHub Issue、Pull Request 与 WorkIsland 飞书 Base。开始工作前先阅读当前任务对应的 GitHub Issue、milestone 和飞书任务卡；它们共同定义交付边界。

## 看板与版本

- 飞书 Base 是认领、执行状态、排期和验收证据的工作面：<https://fcnulw7a3y1f.feishu.cn/base/KvXEbRlwPadyArsDON9cLtRynqg?from=from_copylink>。
- GitHub Issue 是需求范围、技术讨论和可审查交付物的记录；PR 是实现证据。一次状态变更涉及两处时，同一次工作内同步更新。
- 新需求先进入飞书“需求池”，默认 `目标版本=待排期`。只有在指定版本、关联项目和 GitHub Issue 后，才可以进入开发任务。
- 每张开发任务卡必须具备：目标版本、关联项目、优先级、状态、截止时间、验收标准与关联 Issue。开放认领的任务在认领时填写“任务执行人”，并把状态更新为“已认领”或“进行中”。
- 完成任务时填写实际完成时间，补充可核查的验收证据（PR、commit、构建产物、测试或设备验证），再将任务标记为“已完成”。没有证据不能用完成状态代替进度状态。

## 当前发布边界

- `v1.4.0` 的唯一发布总控是 GitHub #134。发布前必须完成候选范围冻结、真实 macOS 验收、Release Gate、tag/GitHub Release 与 arm64/x64 验证。实际 tag 或 Release 未存在时，不得宣称版本已发布。
- 会话搜索 #115 只有索引、搜索 UI、隐私/跳转与真实 macOS 验收全部通过，才可由 Release Gate 决定提前进入 `v1.4.0`；否则正式交付版本为 `v1.5.0`。
- `v1.5.0` 的跨 Agent 交接由 #126 统筹，按 #128（交接契约）、#130（tmux 定位）、#129（ZCode ↔ Codex）、#131（Claude Code TUI）、#132（端到端验收）推进。
- 远程能力在 `v1.4.0` 仅为 observe-only；远程 tmux 交互、attach 与跳转不应被作为本版本承诺。

## 执行与发布

- 开始编码前确认任务仍在目标 milestone，Issue 没有关闭或重新排期，并检查工作区与当前分支。
- 需要跨客户端接续时，先写入可验证的交接快照、Git HEAD/dirty 状态和目标工作区；不得通过模糊 tmux 匹配接续会话。
- 发布相关变更需运行仓库要求的检查，并将结果回填 Issue 和飞书任务卡。出现阻塞时，将任务设为“已停滞”，说明阻塞原因、下一步和负责人，不保留模糊的“进行中”。
