# Orca

Orca 是一个 macOS 本地桌面应用：在刘海区域展示 Coding Agent 会话，处理支持的审批请求，并提供桌宠、声音、快捷键、用量和终端跳转。

当前核心链路均直接从 `src/` 运行：

- 灵动岛原位置、尺寸、展开/收起动画与刘海屏适配
- Agent Hook、Unix socket 会话桥、进程监控与多会话展示
- Island 审批、提问、完成状态和终端跳转
- 桌宠、宠物面板、拖拽、声音和触觉反馈
- 原生 macOS 风格设置页

源码采用 [MIT License](./LICENSE)，可以直接在 GitHub 上使用、修改和分发。
第三方运行时的许可证说明见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

## 开发

要求 Apple Silicon macOS、Node.js 22 或更高版本。

```bash
npm run setup
npm run doctor
npm run check
npm run dev
```

`npm run dev` 使用真实用户目录接入本地 Agent Hook，应用数据仍保存在仓库的 `.local-data`。只调试 UI、不希望修改真实 Hook 配置时使用：

```bash
npm run dev:isolated
```

全部支持可配置审批的 Agent 默认使用 Island 审批，也可在设置页切回终端审批。Hook 配置采用合并和原子写入，不覆盖无关用户配置。

## 仓库边界

项目专注于本地功能。云端账号、远程开发机、遥测和自动更新不属于当前产品边界；应用不会向这些服务建立连接，也不会上传会话内容。

代码结构见 [架构说明](./docs/ARCHITECTURE.md)，不支持功能的完整原因见 [功能边界](./docs/UNAVAILABLE_FEATURES.md)，公开发布前请完成 [发布检查](./docs/RELEASE_CHECKLIST.md)。

应用图标、Orca 桌宠、用量图标和提示音均由仓库内
`npm run build:assets` 可重复生成，详见 [素材审计](./docs/ASSET_AUDIT.md)。
刘海定位、窗口层级、圆角与触觉反馈模块的 Objective-C++ 源码位于
`native/panel-fix/`，可通过 `npm run build:native` 重建。

参与开发前请阅读 [贡献指南](./CONTRIBUTING.md)，安全问题请按
[安全策略](./SECURITY.md) 私下报告。

## 构建与发布

Apple Silicon macOS 安装包可在本机生成：

```bash
npm ci
npm run package:mac
```

产物位于 `release/Orca-<version>-arm64.dmg`。GitHub Actions 的
`release` 工作流支持手动运行；推送与 `package.json` 版本一致的标签（例如
`v0.1.19`）时，会自动创建 GitHub Release 并上传 DMG 与 SHA-256 校验文件。

没有 Apple Developer 证书时仍可生成未签名 DMG，但用户首次打开需要在
系统设置中确认。正式公开分发建议在 GitHub 仓库 Actions Secrets 中配置：

- `CSC_LINK`：Developer ID Application 证书的 Base64 或安全下载地址
- `CSC_KEY_PASSWORD`：证书密码
- `APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`：App Store Connect API Key，用于公证

这些 Secrets 都是可选的；未配置时工作流会跳过签名与公证。
