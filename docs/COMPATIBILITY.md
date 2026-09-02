# WorkIsland 兼容性真值表

本表是 WorkIsland 各平台与芯片架构的官方兼容性口径，供用户选购/排障、官网与手册引用。安装包统一从 [GitHub Releases](https://github.com/qianzhu18/workisland/releases) 下载，macOS 提供 Apple Silicon（`*arm64.dmg`）与 Intel（`*x64.dmg`）两种安装包，Windows 提供 x64 安装包与便携版。

最后更新：2026-09（v3.2.0 前后口径）。

## macOS

### 芯片与安装包

| 平台 | 芯片 | 安装包 | 支持状态 |
| --- | --- | --- | --- |
| Apple Silicon | M1 / M2 / M3 / M4 及后续 | `*arm64.dmg` | ✅ 完整支持（主力平台） |
| Intel | x86_64（2016 年及之后多数 MacBook / iMac / Mac mini） | `*x64.dmg` | ✅ 支持，个别能力有差异（见功能矩阵） |
| 通用二进制 | — | `*universal.dmg`（如发布） | ✅ 双架构均可安装 |

- 自动更新会按当前芯片选择对应安装包：Apple Silicon 下载 `*arm64.dmg`，Intel 下载 `*x64.dmg`；若发布 universal 包则优先 universal。
- 下载完成后会对照 Release 内的 `SHA256SUMS.txt`（或 `SHA256SUMS-<arch>.txt`）校验，再进入本机安装。

### macOS 版本

| macOS 版本 | Apple Silicon | Intel |
| --- | --- | --- |
| macOS 26（Tahoe）及更新 | ✅ | ✅（如硬件可升级至该版本） |
| macOS 13 – 15 | ✅ | ✅ |
| macOS 11 – 12 | ✅ | ✅（遵循 Electron 运行时最低系统要求） |
| macOS 10.15 及更早 | ❌ | ❌ |

> 最低系统版本跟随应用内打包的 Electron 运行时官方要求，随版本升级可能上移；安装时若系统过旧，应用将无法启动。

### 功能矩阵（macOS）

| 功能 | Apple Silicon | Intel | 说明 |
| --- | --- | --- | --- |
| 灵动岛 / 刘海融合 | ✅ 刘海机型；✅ 悬浮岛 | ✅ 悬浮岛 | Intel 机型均无刘海，WorkIsland 以顶部悬浮岛形态呈现，功能一致 |
| 会话状态监控（Claude / Codex / Cursor / Kimi 等接入） | ✅ | ✅ | 纯本地文件与终端观察，无架构差异 |
| 审批 / 提问 / 回源跳转 | ✅ | ✅ | 无架构差异 |
| 终端工作台（持久化 PTY） | ✅ | ✅ | node-pty 自带 darwin-arm64 与 darwin-x64 预编译 |
| Shelf 文件架 | ✅ | ✅ | 无架构差异 |
| 私有剪贴板历史 | ✅ | ✅ | 无架构差异 |
| 性能进程浏览 | ✅ | ✅ | 无架构差异 |
| 桌宠 Echo / Codex 桌宠 | ✅ | ✅ | 无架构差异 |
| 声音与生命周期提示音 | ✅ | ✅ | 无架构差异 |
| 用量洞察（token 统计与费用估算） | ✅ | ✅ | 无架构差异 |
| 媒体工作台（系统播放状态、歌词、封面） | ✅ | ⚠️ 待验证 | 依赖 MediaRemote 私有框架适配器，适配器源码按目标架构编译（x64 构建产物已产出）；Apple 在 Intel 机型上对 MediaRemote 的支持口径不同，Intel 上以实测为准 |
| 面板修补原生模块（panel_fix） | ✅ | ✅ | 构建脚本按目标架构编译（`--arch x64` / `WORKISLAND_NATIVE_ARCH=x86_64`） |
| 应用内更新闭环（下载 / 校验 / 安装 / 重启） | ✅ | ✅ | 按芯片自动选择 arm64/x64 安装包并校验 SHA-256 |
| 灵动岛背景 / 模板自定义（含 AI 接口） | ✅ | ✅ | 无架构差异 |

### Intel 已知限制

1. 媒体工作台依赖的 MediaRemote 私有框架在 Intel 机型上的行为与 Apple Silicon 存在差异，属「尽力支持」，出现取不到播放状态时其他功能不受影响。
2. Intel 机型均无刘海，灵动岛以悬浮岛形态显示，不支持刘海融合布局。
3. 若未来 Electron 运行时放弃 x64 macOS，将在此表提前公告并冻结 Intel 安装包通道。

## Windows

| 项目 | 支持状态 |
| --- | --- |
| Windows 11 x64（NSIS 安装包 / 便携版） | ✅ Alpha 内测 |
| Windows 10 及更早 / 32 位 / ARM | ❌ |
| 自动更新 | ❌ 暂无（Windows Alpha 阶段请从 Release 页手动更新） |

- Windows Alpha 安装包未签名：浏览器下载与 SmartScreen 会拦截，Release 页内置逐步引导。
- 已知限制：无法按 `WT_SESSION` 精确切换 Windows Terminal 标签页。

## 开发者参考

- macOS Apple Silicon 构建：`npm run package:mac`
- macOS Intel 构建：`npm run package:mac:intel`（在 Apple Silicon 上交叉编译原生模块，产物为 `*x64.dmg`）
- 原生模块按架构编译：`node scripts/build-native.mjs --arch x64`（或 `WORKISLAND_NATIVE_ARCH=x86_64`），同时作用于 `panel_fix.node` 与 `MediaRemoteAdapter.framework`
- 发布流水线（`release.yml`）按 `arm64` / `x64` 矩阵分别出 DMG，并生成 `SHA256SUMS.txt` / `SHA256SUMS-x64.txt`
