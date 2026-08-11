# 源码结构

- `main/index.cjs`：约 1,200 行的应用组合入口，只负责装配服务与生命周期。
- `main/app-coordinator.cjs`：本地会话、窗口和设置之间的协调。
- `main/adapters-*.cjs`：各 Coding Agent 的事件适配器。
- `main/hooks-*.cjs`：各 Agent Hook 的安装、迁移与卸载。
- `main/bridge-*.cjs`：Unix socket 协议、连接与权限响应。
- `main/session-state.cjs`：会话状态机和派生状态。
- `main/windows.cjs`、`display-manager.cjs`、`pet-mode-controller.cjs`：窗口、屏幕和桌宠生命周期。
- `main/ipc-services.cjs`、`shared/ipc.cjs`：IPC 实现及统一通道定义。
- `main/settings-repository.cjs`、`shared/settings.cjs`：设置默认值、迁移与原子持久化。
- `preload/`：所有窗口的 context-isolated bridge。
- `renderer/settings-app.js`、`settings-app.css`：可直接维护的原生 macOS 风格设置页。
- `renderer/island/`：灵动岛入口、Pill、面板、会话模型、样式和语义化资源。
- `renderer/pet/`：桌宠入口、状态模型、宠物面板、精灵图、字体和样式。
- `renderer/shared/`：Renderer 共用设置、格式化、i18n 与用量展示资源。
- `renderer/vendor/`：React、Markdown 和状态容器的固定浏览器运行时；业务代码不得写入这里。
- `renderer/assets/`：欢迎页的独立入口和样式资源。

主进程已按职责拆分，不再把业务继续堆入入口文件。所有新增功能应进入对应模块，并补充 `scripts/test-source.mjs` 或冒烟测试。
