# WorkIsland v1.0.0-alpha.5 Release Notes（发布候选）

状态：`release-candidate — 尚未打 Tag、尚未创建 GitHub Release`

本文件登记从 `v1.0.0-alpha.4` 以来进入 `main` 的用户可见变化，同时收拢 Windows Alpha 5 工作台的完整叙事。对外发布前必须完成 `npm run check`、`npm run release:check -- --tag v1.0.0-alpha.5` 和 GitHub Actions 发布门禁（macOS 签名公证 + Windows 冒烟）。

完整历史见仓库根目录的 [`CHANGELOG.md`](../CHANGELOG.md)，官网版本页见 [WorkIsland 更新日志](https://workisland.yanglaishe.cn/changelog/)。

## 本版本范围

### Windows Alpha 5：v3.1 工作台同步

- 接入 Windows 系统媒体会话（GSMTC）：播放控制、进度、封面与在线歌词。
- PowerShell 持久化终端、性能进程浏览、Shelf 文件架与私有剪贴板历史。
- 媒体来源应用图标、Echo 桌宠动作与 Codex 生命周期声音。
- Shelf 支持打开、定位、预览和复制文件路径。
- 修复 macOS 路径、Shell、进程采样和媒体适配器假设阻止 Windows 工作台启动的问题。

### 用量洞察（PRD-015）

- 采集 Claude 与 Codex 会话的实际 token 用量，统计保留 90 天并记录所用模型。
- LiteLLM 价格数据模块带离线缓存，提供费用估算，无网络时面板仍可用。
- 聚合查询 API 输出会话级洞察；用量面板作为工具箱第五个模块提供可视化。
- 正确处理缓存-only 的 token 增量，重启后基线不重复计数。

### 工作台易用性

- 工具箱的工具模块支持拖拽排序，顺序持久化保存在设置中。
- 修复窄分屏（左右 Split View）布局下审批按钮被挤压、文字无法阅读的问题。

### AI 自定义接口

- 本机 Agent 可通过随附的 `workisland-cli` 修改灵动岛背景（纯色 / 渐变 / 背景图，含透明度与压暗遮罩）并安装、切换桌宠精灵图；全部走本地 Unix socket，不开任何网络端口。
- 设置 → 外观新增「岛屿背景」：预设主题、自定义颜色、透明度与一键重置，AI 设置的结果同样在此可见可改。
- 过亮的背景颜色会被自动压暗以保证浅色文字可读；精灵图安装前强制几何校验（Codex V2 1536×2288 / Orca v1 1024×896）。
- 配套 AI 手册见 [AI-CUSTOMIZATION.md](./AI-CUSTOMIZATION.md)，也可用 `workisland-cli manual` 直接输出。

### 稳定性

- 修复 Windows 批处理脚本按注入平台正确引用路径、含空格路径失效的问题。

## 发布前验收

- [ ] `package.json` 与 `package-lock.json` 版本均为 `1.0.0-alpha.5`。
- [ ] `npm run check` 通过。
- [ ] `npm run release:check -- --tag v1.0.0-alpha.5` 通过。
- [ ] GitHub Actions macOS arm64 产物完成签名、公证、Staple、Gatekeeper 校验并生成 `SHA256SUMS.txt`。
- [ ] GitHub Actions Windows x64 产物完成 NSIS 安装包与便携版构建，冒烟测试（含 #56 自退出回归）通过。
- [ ] GitHub Release 标记为 Pre-release，双平台产物与校验文件可公开下载。
- [ ] 官网首页、手册、更新日志和下载链接可访问。

## 已知限制与回滚

- Windows Alpha 未签名：浏览器下载与 SmartScreen 均可能拦截，Release 页内置引导说明。
- 不支持 Windows 10 / 32 位；无法按 `WT_SESSION` 精确切换 Windows Terminal 标签页；暂无自动更新。
- 用户端稳定更新通道仍读取 `releases/latest`（当前为 `v3.1.0`），本版本为 Pre-release，不会推送给稳定版用户。
- 如果发现 P0 问题，发布新的修复版本，不覆盖 `v1.0.0-alpha.5` Tag 或替换既有产物。
