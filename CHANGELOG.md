# WorkIsland Changelog

这里记录 WorkIsland 对用户有意义的版本变化。每个版本的安装包与完整说明以 [GitHub Releases](https://github.com/qianzhu18/workisland/releases) 为准；也可以查看[官网更新日志](https://workisland.yanglaishe.cn/changelog/)。

## [Unreleased]

### Added

- Windows Alpha 5 同步 v3.1 工作台：接入 Windows 系统媒体会话（GSMTC）、PowerShell 终端、性能进程浏览、Shelf 文件架、私有剪贴板历史、媒体来源图标、Echo 动作与 Codex 生命周期声音。
- Windows 媒体工作台支持系统播放控制、进度、封面与在线歌词；Shelf 支持打开、定位、预览和复制文件路径。
- 新增 AI 自定义接口:本机 Agent 可通过随附的 `workisland-cli` 修改灵动岛背景(纯色 / 渐变 / 背景图,含透明度与压暗遮罩)并安装、切换桌宠精灵图,全部走本地 Unix socket,不开任何网络端口;配套 AI 手册见 [docs/AI-CUSTOMIZATION.md](docs/AI-CUSTOMIZATION.md),也可用 `workisland-cli manual` 直接输出。
- 设置 → 外观新增「岛屿背景」:预设主题、自定义颜色、透明度与一键重置,AI 设置的结果同样在此可见可改。
- 过亮的背景颜色会被自动压暗以保证浅色文字可读;精灵图安装前强制几何校验(Codex V2 1536×2288 / Orca v1 1024×896)。

### Fixed

- 修复 macOS 路径、Shell、进程采样和媒体适配器假设阻止 Windows 工作台启动的问题。
- 修复窄分屏(左右 Split View)布局下审批按钮被挤压、文字无法阅读的问题。

## [3.1.0] - 2026-08-28

### Added

- 媒体工作台新增自适应同步歌词和专辑封面动效，让播放状态更容易被一眼理解。
- 新增 Shelf 文件架、私有剪贴板历史和持久化 Terminal 工作区，常用工具可以围绕当前工作流快速展开。
- 新增性能进程浏览与媒体来源应用图标。
- Echo 桌宠新增空闲情绪轮换、状态转场动作、点击反馈和视线跟随。
- Codex 转录事件补齐开始、完成和错误声音，并对 Hook 与转录双通道做去重。

### Changed

- 统一工具箱的展开、收起和导航生命周期，减少工作台交互状态不一致。
- 公开文档与官网增加更新日志入口，后续版本变化集中在这里维护。

### Fixed

- 修复点击 Shelf 文件后整座 Island 可能卡死的问题。
- 修复媒体来源应用图标未按声明资源加载的问题。

## [3.0.0] - 2026-08-24

首个公开稳定版：完善多 Agent 会话状态、审批/提问与回源体验；加入本地优先的遥测披露与关闭入口、用户手册、更新检查和公开 macOS DMG 分发。

## [0.3.0-beta.1] - 2026-08-18

首轮 macOS Pilot Beta，验证安装、Agent 连接、任务状态、回源和反馈闭环。

[3.1.0]: https://github.com/qianzhu18/workisland/releases/tag/v3.1.0
[3.0.0]: https://github.com/qianzhu18/workisland/releases/tag/v3.0.0
[0.3.0-beta.1]: https://github.com/qianzhu18/workisland/releases/tag/v0.3.0-beta.1
