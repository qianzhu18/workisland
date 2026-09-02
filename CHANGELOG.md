# WorkIsland Changelog

这里记录 WorkIsland 对用户有意义的版本变化。每个版本的安装包与完整说明以 [GitHub Releases](https://github.com/qianzhu18/workisland/releases) 为准；也可以查看[官网更新日志](https://workisland.yanglaishe.cn/changelog/)。

> **版本体系重置（2026-09-02）**：公开版本号统一归位——内测期整理为 `v0.1.0 – v0.10.0`（原 `v0.2.x` 系列与初版 `v0.1.0` 重排，各版本说明注明原版本号）；`v3.0.0 / v3.1.0 / v3.2.0` 分别平移为 `v1.0.0 / v1.1.0 / v1.2.0`；`v3.2.0-rc.1` 与整条 `v1.0.0-alpha`（Windows 试验线）已删除，Windows 支持暂停维护、欢迎社区贡献者主导适配。

## [1.2.0] - 2026-09-02

原 `v3.2.0` 的稳定化版本：合并其后累积的修复，并重新构建使应用内版本号与 1.x 对齐（原 3.x 安装包无需强制更新，建议重装以对齐版本体系）。

### Added（继承自 3.2.0 后合入）

- MCP 产品助手：设置 → MCP 开启本地 MCP 服务并一键连接 Codex，可询问灵动岛功能、查询当前任务状态、诊断模块问题；只开放脱敏工具，开关关闭后立即失效。
- 3.2.0 全部功能（应用内更新闭环、外观模板系统、岛屿背景等）见 [v1.2.0 Release 说明](https://github.com/qianzhu18/workisland/releases/tag/v1.2.0)。

### Fixed

- 修复 ZCode（≥3.10）始终无法连接的问题：新版 ZCode 只执行项目级 Hook，不再读取用户级 `~/.zcode/cli/config.json`。Hook 现在会同步写入最近活跃会话所在项目（git 根目录）的 `.zcode/config.json`（与项目内 MCP 等既有配置合并、互不覆盖），卸载时一并清理；用户级配置仍保留以兼容旧版 ZCode。
- 修复 Windows CI 上 3 个既有单测失败（为后续社区 Windows 适配保留绿色基线）。

## [1.1.0] - 2026-09-01

原 `v3.1.0` 平移（同一构建）。更新说明以 [Release 页](https://github.com/qianzhu18/workisland/releases/tag/v1.1.0)为准。

## [1.0.0] - 2026-08-23

原 `v3.0.0` 平移（同一构建）。更新说明以 [Release 页](https://github.com/qianzhu18/workisland/releases/tag/v1.0.0)为准。

## [1.3.0-beta.1] - 2026-09-02

预发布（先内部实机验证，通过后转 v1.3.0 正式）。

### Added

- **Agent Doctor 一键检测**（B-1）：设置 → 本地 Agent 页「一键检测」扫描全部 Agent 的 Hook 健康，输出结构化状态（正常 / 未安装 / 未运行 / 待修复），汇总条「X 个 Agent · Y 正常 · Z 待修复 · W 未安装」，待修复卡片显示橙色角标与具体原因。
- **Agent Doctor 一键修复**（B-1）：待修复卡片「修复」按钮与「一键修复全部」；修复走既有安装路径（自动备份原配置），修完自动复扫并留痕（修复前后问题清单 + 时间戳）；启动时自动体检并自愈可修复状态（设置可关）。
- 「移除全部 Hook」增加二次确认。

## [Unreleased]

（v1.3.0 正式版待实机回归后发布。）

## [3.2.0] - 2026-09-01

### Added

- 应用内更新闭环：灵动岛顶部的 Codex 额度格子右侧新增版本升级入口，点击可查看新版本、下载与当前芯片匹配的官方安装包（含进度与 SHA-256 校验），并在本机完成安装后自动重启；安装失败自动回退为打开镜像手动拖拽。「设置 → 关于 → 更新」提供同一闭环。
- 更新入口按芯片架构选择安装包：Apple Silicon 下载 `*arm64.dmg`，Intel 芯片下载 `*x64.dmg`；发布流水线同时产出 Apple Silicon 与 Intel 安装包，新增 Intel Mac 兼容性真值表（docs/COMPATIBILITY.md）。
- 新增外观模板系统：官方小宇（守岛人）成为可恢复的默认模板 `builtin:workisland-xiaoyu`；五个会话状态 SVG 在运行时从校验过的模板包加载，损坏时自动回退官方包；模板含清单/哈希校验、SVG 安检、事务化安装与模块级恢复。
- 新增 `workisland-cli template` 命令组：`list` / `inspect` / `preview` / `apply` / `reset` / `validate` / `export` / `skill install` / `download` / `publish`，支持 GitHub 静态目录下载（域名白名单 + 双重哈希校验）与经 `gh` 的显式 `--confirm` 发布。
- 随附 `workisland-template` Agent Skill，提供“检查 → 预览 → 用户确认 → 应用”的模板换装流程，可一键安装到本机 Codex。
- 设置 → 外观新增「外观模板」区块，不使用 Agent 也能完成模板选择与恢复。
- 新增本机 AI 自定义接口：Agent 可通过随附的 `workisland-cli` 修改灵动岛背景（纯色 / 渐变 / 背景图，含透明度与压暗遮罩），并安装、切换桌宠精灵图；全程只走本地 Unix socket，不开放网络端口。
- 设置 → 外观新增「岛屿背景」：预设主题、自定义颜色、透明度与一键重置；AI 写入的外观同样可见、可改。
- 过亮背景会自动压暗以保证浅色文字可读；精灵图安装前强制几何校验（Codex V2 1536×2288 / Orca v1 1024×896）。

### Fixed

- 修复灵动岛弹窗透明区域拦截点击、影响下方应用操作的问题。
- 修复终端工作台交互场景下控制键（如 Ctrl+C）被弹层抢占的问题。

## [1.0.0-alpha.5] - 2026-08-30

### Added

- Windows Alpha 5 同步 v3.1 工作台：接入 Windows 系统媒体会话（GSMTC）、PowerShell 终端、性能进程浏览、Shelf 文件架、私有剪贴板历史、媒体来源图标、Echo 动作与 Codex 生命周期声音。
- Windows 媒体工作台支持系统播放控制、进度、封面与在线歌词；Shelf 支持打开、定位、预览和复制文件路径。
- 新增用量洞察面板：工具箱第五个模块，采集并聚合 Claude 与 Codex 会话的实际 token 用量，基于 LiteLLM 价格数据（带离线缓存）估算费用，支持会话级洞察；统计保留 90 天并记录所用模型。
- 工具箱的工具模块支持拖拽排序，顺序持久化保存在设置中。

### Fixed

- 修复 macOS 路径、Shell、进程采样和媒体适配器假设阻止 Windows 工作台启动的问题。
- 修复窄分屏(左右 Split View)布局下审批按钮被挤压、文字无法阅读的问题。
- 修复 Windows 批处理脚本按注入平台正确引用路径、含空格路径失效的问题。

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

[3.2.0]: https://github.com/qianzhu18/workisland/releases/tag/v3.2.0
[1.0.0-alpha.5]: https://github.com/qianzhu18/workisland/releases/tag/v1.0.0-alpha.5
[3.1.0]: https://github.com/qianzhu18/workisland/releases/tag/v3.1.0
[3.0.0]: https://github.com/qianzhu18/workisland/releases/tag/v3.0.0
[0.3.0-beta.1]: https://github.com/qianzhu18/workisland/releases/tag/v0.3.0-beta.1
