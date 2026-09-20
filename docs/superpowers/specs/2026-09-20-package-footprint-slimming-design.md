# WorkIsland 安装体积保守瘦身设计

## 目标

在不删除用户功能和中英文支持的前提下，移除 Electron 未使用语言与明确重复的发布资源，降低 DMG 和安装后 App 体积。

## 当前基准

- macOS arm64 App 约 314 MB。
- DMG 约 132 MB。
- Electron Framework 约 273 MB，是无法在本阶段消除的基础成本。
- app.asar 约 31 MB，额外资源约 8 MB；当前 `resources/**/*` 与多个 `extraResources` 条目存在重复打包可能。

## 设计

第一层使用 electron-builder 的 `electronLanguages`，只保留产品支持的英文和简体中文 Electron locale。WorkIsland 自有 `en` 与 `zh-CN` 文案保持完整。

第二层建立资源引用清单，区分三类文件：只在 asar 中使用、只在 `process.resourcesPath` 下使用、开发与打包都需要。把 `build.files` 的宽泛 `resources/**/*` 改成明确白名单，只删除已经由 `extraResources` 提供且打包运行时不从 asar 读取的副本。

不删除 Electron Framework、ICU、V8 snapshot、node-pty、原生 panel 模块、媒体适配器、声音、桌宠、模板、CLI、MCP、诊断脚本或许可证文件。

## 错误处理

- 任一资源无法证明重复或未引用时保留。
- macOS 或 Windows 任一打包烟测找不到资源时回滚对应排除项。
- 不通过压缩图片、降音质或删除模板换取体积。

## 验证

- 构建前后记录 App、DMG、app.asar、Framework Resources 和额外资源大小。
- 检查 App 签名和 DMG 完整性。
- 启动打包 App，验证灵动岛、设置、中英文切换、桌宠、声音、媒体、终端、模板、CLI 和 MCP 入口。
- Windows x64 构建及打包启动/退出烟测通过。

## 完成标准

体积有可复现下降，全部资源功能保持可用。若某项只能节省极小空间却增加平台风险，则保留原资源并在报告中说明。
