# WorkIsland

> AI 原生时代的 macOS 工作界面。工作需要你时，不必四处寻找。

WorkIsland 是一款免费、本地优先的 macOS 原生应用。它当前从 Claude Code、Codex、Cursor 等 AI 编程 Agent 开始：在一个低干扰的桌面界面中呈现运行、待审批、待回答、完成和失败等本地任务状态；支持时可就地操作，并一键回到触发事件的终端或应用会话。

## 适合谁

适合会并行运行多个 AI 编程任务、又不想反复轮询终端的人。WorkIsland 不取代 Agent、终端或 IDE；它让工作留在原来的地方，只在需要你参与时给出状态、上下文和下一步。

## 当前边界

- 只有已连接且真实上报的 Agent 任务才会显示状态；连接未完成时，WorkIsland 不会伪造完成或审批结果。
- 是否可就地处理审批或问题，取决于具体 Agent 与事件类型；不能精确回源时会给出后备路径。
- 会话内容、代码、路径、项目名、主机名和用户名留在本机；本地工作流不需要云端账户。
- 邮件、日历和通用通知不是当前已交付功能。

## 开始

1. 从[官方 Release](https://github.com/qianzhu18/workisland/releases/latest)安装 WorkIsland。
2. 在设置中连接你已经使用的 Agent。
3. 运行一条真实任务，确认 Island 信号和回源路径。

## 更多资料

- [Agent 产品说明](https://workisland.yanglaishe.cn/skill.md)
- [快速开始](https://workisland.yanglaishe.cn/guide/index.md)
- [Claude Code 完成提醒指南](https://workisland.yanglaishe.cn/guides/claude-code-notifications/index.md)
