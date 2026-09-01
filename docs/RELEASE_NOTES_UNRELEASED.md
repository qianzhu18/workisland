# WorkIsland v3.2.0 Release Notes（发布候选）

状态：`release-candidate — 本地打包验证中；Tag 推送后由 GitHub Actions 签名公证并创建正式 Release`

这是 macOS `v3.x` 正式版本线的 `v3.2.0`。它包含 rc.1 的外观模板系统、本次迭代的两个 P0（应用内更新闭环与 Intel 芯片兼容），以及终端/弹窗交互修复。Windows `v1.0.0-alpha.*` 为独立内测线，不包含在本版本中。

完整历史见仓库根目录的 [`CHANGELOG.md`](../CHANGELOG.md)，版本 PRD 见 [PRD-011](./product/prd/PRD-011-v3.2.0-macOS-Template-Appearance-Release.md)。

## 本版本范围

### 应用内更新闭环（P0）

- 灵动岛顶部的 Codex 额度格子右侧新增版本升级入口，点击展开更新弹层。
- 完整闭环：下载与当前芯片匹配的官方安装包（含进度）→ SHA-256 校验 → 本机挂载安装 → 自动重启；任一步骤失败自动回退为打开 DMG 手动拖拽。
- 下载完成后弹出「点击立即安装」系统通知。
- 「设置 → 关于 → 更新」提供同一状态机（下载并安装 / 进度 / 重启并完成安装 / 重试）。

### Intel 芯片兼容与兼容性真值表（P0）

- 首次提供 Intel（x64）macOS 安装包：`*-x64.dmg`；原生模块按目标架构编译，node-pty 使用 darwin-x64 预编译。
- 发布流水线按 arm64 / x64 矩阵出包，Intel 校验文件为 `SHA256SUMS-x64.txt`。
- 新增 [兼容性真值表](./COMPATIBILITY.md)：芯片、macOS 版本与功能级矩阵，Intel 机型以悬浮岛形态呈现灵动岛；媒体工作台在 Intel 上为「尽力支持」。
- 应用内更新按芯片自动选择 arm64 / x64 安装包并校验对应校验文件。

### 外观模板与恢复（rc.1 内容）

- 新增外观模板系统。官方小宇（守岛人）是可恢复默认模板；五个会话状态 SVG 在运行时从校验过的模板包加载，损坏时回退官方包。
- 模板包包含清单、文件哈希、许可证与 SVG 安检；安装采用事务化写入，不完整或篡改内容不会替换现有配置。
- 设置 → 外观新增「外观模板」区块，可选择、检查和恢复模板，无需使用终端。

### 本机 AI 外观自定义（rc.1 内容）

- 本机 Agent 可使用 `workisland-cli` 预览并在明确确认后修改 Island 背景、透明度、渐变、背景图和桌宠精灵图。
- `workisland-cli template` 支持检查、预览、应用、重置、导出、下载与受限发布；GitHub 下载使用域名白名单与双重哈希校验。
- 所有控制通过本机 Unix socket 完成，不开放网络端口；详细边界见 [AI Customization](./AI-CUSTOMIZATION.md)。

### 稳定性

- 修复灵动岛弹窗透明区域拦截点击、影响下方应用操作的问题。
- 修复终端工作台交互场景下控制键被弹层抢占的问题。

## 发布前验收

- [ ] `package.json` 与 `package-lock.json` 均为 `3.2.0`。
- [ ] `npm run check` 通过。
- [ ] `npm run release:check -- --tag v3.2.0` 通过。
- [ ] 本地完成 arm64（Apple Silicon）与 x64（Intel 交叉编译）打包验证。
- [ ] GitHub Actions 完成双架构签名、公证、Staple、Gatekeeper 校验，并生成 `SHA256SUMS.txt` / `SHA256SUMS-x64.txt`。
- [ ] GitHub Release `v3.2.0` 为正式版（非 Pre-release），成为 releases 页 Latest 置顶。
- [ ] 官网首页、手册、更新日志和下载链接可访问。

## 已知限制与回滚

- Intel 机型媒体工作台依赖的 MediaRemote 私有框架行为与 Apple Silicon 存在差异，属尽力支持（见 [COMPATIBILITY.md](./COMPATIBILITY.md)）。
- Windows Alpha 不在本版本范围，自动更新暂不覆盖 Windows 通道。
- 模板远程下载仅支持受限 GitHub 静态目录；不会执行模板中携带的脚本。
- 出现 P0 时发布新的 `v3.2.1`，绝不覆盖既有 Tag 或替换既有产物。
