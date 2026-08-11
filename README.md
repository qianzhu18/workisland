# WorkIsland

WorkIsland 是一个 macOS 本地桌面应用：在刘海灵动岛区域展示 Coding Agent 会话状态，处理支持的审批请求，并提供桌宠、声音、快捷键、用量统计和终端跳转。

它解决一个具体的工作流问题——**当你同时让多个 AI 编程任务在后台运行时，不用逐个翻找终端和 IDE，就知道哪个任务需要你处理，并能安全地回到正确会话继续工作。**

## 核心能力

- **灵动岛任务状态**：运行、等待审批、等待回答、完成、失败，在刘海区域实时展示
- **双通道完成检测**：Hook 通道 + Transcript 文件监听，即使没装 Hook 也能监控到 Claude Code / Codex 的任务完成
- **审批与提问**：在灵动岛直接处理 Agent 的权限请求和提问
- **终端跳转**：把用户带回正确的源会话（Terminal / iTerm2 / Ghostty / Warp）
- **桌宠**：可拖拽的桌面伴侣，状态随任务变化，兼容 Codex V2 桌宠 sprite 协议
- **声音通知**：任务开始、完成、失败、需要审批时播放提示音
- **用量统计**：Token 燃烧追踪

## 开发

要求 Apple Silicon macOS、Node.js 22 或更高版本。

```bash
npm run setup
npm run doctor
npm run check
npm run dev
```

`npm run dev` 使用真实用户目录接入本地 Agent Hook，应用数据保存在仓库的 `.local-data`。只调试 UI、不希望修改真实 Hook 配置时使用：

```bash
npm run dev:isolated
```

全部支持可配置审批的 Agent 默认使用灵动岛审批，也可在设置页切回终端审批。Hook 配置采用合并和原子写入，不覆盖无关用户配置。

## 仓库边界

项目专注于本地功能。云端账号、远程开发机、遥测和自动更新不属于当前产品边界；应用不会向这些服务建立连接，也不会上传会话内容。

代码结构见 [架构说明](./docs/ARCHITECTURE.md)，不支持功能的完整原因见 [功能边界](./docs/UNAVAILABLE_FEATURES.md)，公开发布前请完成 [发布检查](./docs/RELEASE_CHECKLIST.md)。

应用图标、用量图标和提示音由仓库内 `npm run build:assets` 可重复生成（应用图标由设计师提供的 logo 生成，不会被覆盖）。刘海定位、窗口层级、圆角与触觉反馈模块的 Objective-C++ 源码位于 `native/panel-fix/`，可通过 `npm run build:native` 重建。

参与开发前请阅读 [贡献指南](./CONTRIBUTING.md)，安全问题请按 [安全策略](./SECURITY.md) 私下报告。

## Roadmap

WorkIsland 的长期愿景是成为**本地优先的多 Agent AI 编程任务监控与注意力路由器**，并逐步扩展到更多显示面：

### 短期（当前）
- 巩固 macOS 灵动岛任务监控的可靠性：状态不漏、提醒不扰、回源不误
- 支持更多 Coding Agent（通过 adapter 扩展）

### 中期
- **移动端任务副屏**：把闲置的手机变成第二显示面。横屏后化身时钟 + 任务监视器，任务完成时滑下预览，需要修改时用语音输入下达指令，监控更多平台
- **跨平台桌宠**：桌宠从 macOS 扩展到 Windows，作为独立的桌面伴侣产品线

### 长期
- 探索更多注意力路由场景（不只是编程任务）

## 构建与发布

Apple Silicon macOS 安装包可在本机生成：

```bash
npm ci
npm run package:mac
```

产物位于 `release/WorkIsland-<version>-arm64.dmg`。GitHub Actions 的 `release` 工作流支持手动运行；推送与 `package.json` 版本一致的标签（例如 `v0.1.0`）时，会自动创建 GitHub Release 并上传 DMG 与 SHA-256 校验文件。

没有 Apple Developer 证书时仍可生成未签名 DMG，但用户首次打开需要在系统设置中确认。正式公开分发建议在 GitHub 仓库 Actions Secrets 中配置：

- `CSC_LINK`：Developer ID Application 证书的 Base64 或安全下载地址
- `CSC_KEY_PASSWORD`：证书密码
- `APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`：App Store Connect API Key，用于公证

这些 Secrets 都是可选的；未配置时工作流会跳过签名与公证。

## 许可证

源码采用 [MIT License](./LICENSE)，第三方运行时的许可证说明见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
