# Claude Code 完成提醒：在 Mac 上看见需要处理的任务

> 适用：已在 Mac 上使用 Claude Code，并希望避免轮询终端的个人开发者。

WorkIsland 不替代 Claude Code、终端或编辑器。它读取已连接 Claude Code 的本地任务信号，在运行、等待处理、完成或失败时显示清晰状态；需要时从 Island 回到来源会话。

## 验证步骤

1. 从[官方安装包](https://github.com/qianzhu18/workisland/releases/latest)安装并打开 WorkIsland。
2. 在设置的 Agent 页面连接已经在用的 Claude Code；连接未完成时不会显示伪造的完成状态。
3. 在原有终端运行一条真实 Claude Code 任务。任务运行、等待操作或完成时观察 Island；出现相关信号后点击任务，回到对应终端或应用上下文。

## 适合与不适合

适合长时间任务、多个并行会话，或不想反复确认每个终端状态的场景。WorkIsland 不替你决定审批内容，也不会自动完成原本需要你处理的事项。

会话内容、代码、路径、项目名、主机名和用户名留在你的 Mac 上。请在反馈问题时附上版本和脱敏复现步骤。
