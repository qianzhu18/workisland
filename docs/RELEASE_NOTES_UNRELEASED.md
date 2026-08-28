# WorkIsland v3.1.0 Release Notes（发布候选）

状态：`release-candidate — 尚未打 Tag、尚未创建 GitHub Release`

本文件登记从 `v3.0.0` 以来进入 `main` 的用户可见变化。对外发布前必须完成 `npm run check`、`npm run release:check -- --tag v3.1.0`、macOS arm64 DMG 抽查和 GitHub Actions 发布门禁。

完整历史见仓库根目录的 [`CHANGELOG.md`](../CHANGELOG.md)，官网版本页见 [WorkIsland 更新日志](https://workisland.yanglaishe.cn/changelog/)。

## 本版本范围

### Agent Core 与状态可靠性

- Codex 转录 watcher 的开始、完成和错误事件现在可以触发对应声音。
- Hook 与转录双通道使用短窗口去重，避免同一会话重复播放声音。
- 继续保留“没有可靠事件就不伪造状态”的本地优先原则。

### Agent-aware Workstation

- Media 工作台支持同步歌词、当前行高亮和专辑封面动效。
- Shelf 持久化安全的本地文件引用，Clipboard 提供本地历史，Terminal 提供持久化本地 PTY 工作区。
- Performance 支持按 CPU 或内存浏览进程，媒体状态显示来源应用图标。
- 工具箱的展开、收起和设置导航生命周期统一，修复点击 Shelf 文件后 Island 卡死的问题。

### 桌面陪伴

- Echo 桌宠在空闲时轮换情绪并执行轻量动作。
- 任务完成、需要处理、睡醒、拖拽和点击都会有对应转场反馈。
- Echo 模式下支持受节流的视线跟随；其他桌宠素材不受影响。

### Distribution

- 增加根目录 `CHANGELOG.md` 与官网 `/changelog/`，集中展示用户可读的版本变化。
- README、官网首页和产品手册均提供更新日志入口。

## 发布前验收

- [ ] `package.json` 与 `package-lock.json` 版本均为 `3.1.0`。
- [ ] `npm run check` 通过。
- [ ] `npm run release:check -- --tag v3.1.0` 通过。
- [ ] `npm run package:mac` 成功生成 Apple Silicon DMG；抽查 asar 中的歌词、音频策略、工具箱和桌宠资源。
- [ ] DMG 完成签名、公证、Staple、Gatekeeper 校验，并生成 `SHA256SUMS.txt`。
- [ ] GitHub Release 为稳定版，DMG 和 SHA-256 校验文件可公开下载。
- [ ] 官网首页、手册、更新日志和下载链接可访问。

## 已知限制与回滚

- 本版本仍只发布 macOS Apple Silicon 稳定包；Windows Alpha 线不随本版本发布。
- #36 dock 附件、#38 token 统计和 #42 Windows Draft 不在本版本范围内，等待各自的冲突/验证/产品决策闭环。
- 如果发现 P0 问题，发布新的修复版本，不覆盖 `v3.1.0` Tag 或替换既有 DMG。
