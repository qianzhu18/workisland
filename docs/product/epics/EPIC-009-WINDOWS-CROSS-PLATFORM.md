# EPIC-009: Windows Cross-Platform Client

状态：`draft`
目标阶段：`v0.5.x`（在 macOS 稳定版和皮肤 Phase A 有证据后）

## 1. 目标

让 Windows 用户获得同样的低干扰通知、会话聚合和桌宠体验，同时明确 Windows 与 macOS 的窗口、权限、Agent hook 和安装差异。

## 2. 里程碑

1. **架构抽象**：隔离 `native-platform-service`、窗口定位、活动空间和深链跳转接口，保持 renderer/状态机跨平台。
2. **Windows Alpha**：托盘、顶部工作区窗口、焦点隐藏、开机启动、基本 Claude/Codex 连接。
3. **Windows Alpha**：多显示器、全屏检测、安装/卸载、自动更新、崩溃恢复和桌宠拖拽。
4. **稳定发布**：签名安装包、回滚、隐私说明、兼容矩阵和真实用户验证。

## 3. 不提前承诺

不在 Windows Alpha 前承诺完整 Agent 适配、Windows Store 发布、跨设备同步或与 macOS 共用云端会话数据。
