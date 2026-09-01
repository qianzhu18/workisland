# WorkIsland v3.2.0-rc.1 Release Notes（macOS 候选）

状态：`release-candidate — 仅可生成本机未签名验证包；尚未打 Tag、尚未创建 GitHub Release`

这是 macOS Apple Silicon 的 `v3.2.0-rc.1` 候选版本。它延续 macOS `v3.x` 正式版本线；Windows `v1.0.0-alpha.*` 为独立内测线，不包含在本版本或本次 DMG 中。

完整历史见仓库根目录的 [`CHANGELOG.md`](../CHANGELOG.md)，版本范围、验收与回滚见 [PRD-011](./product/prd/PRD-011-v3.2.0-macOS-Template-Appearance-Release.md)。

## 本版本范围

### 外观模板与恢复

- 新增外观模板系统。官方小宇（守岛人）是可恢复默认模板；五个会话状态 SVG 在运行时从校验过的模板包加载，损坏时回退官方包。
- 模板包包含清单、文件哈希、许可证与 SVG 安检；安装采用事务化写入，不完整或篡改内容不会替换现有配置。
- 设置 → 外观新增「外观模板」区块，可选择、检查和恢复模板，无需使用终端。

### 本机 AI 外观自定义

- 本机 Agent 可使用 `workisland-cli` 预览并在明确确认后修改 Island 背景、透明度、渐变、背景图和桌宠精灵图。
- `workisland-cli template` 支持检查、预览、应用、重置、导出、下载与受限发布；GitHub 下载使用域名白名单与双重哈希校验。
- 所有控制通过本机 Unix socket 完成，不开放网络端口；详细边界见 [AI Customization](./AI-CUSTOMIZATION.md)。

## 发布前验收

- [ ] `package.json` 与 `package-lock.json` 均为 `3.2.0-rc.1`。
- [ ] `npm run check` 通过。
- [ ] `npm run release:check -- --tag v3.2.0-rc.1` 通过。
- [ ] Apple Silicon 本机生成未签名 DMG，并完成新装、升级、模板切换、恢复、CLI 确认和首个 Agent 事件走查。
- [ ] `release.yml` 已验证：macOS 仅处理非 Alpha Tag；Windows 仅处理 Alpha Tag。
- [ ] RC 仅标记为 GitHub Pre-release；通过验收后才以 `v3.2.0` 推送稳定版。

## 已知限制与回滚

- 本机生成的未签名 DMG 只供受邀验证，可能被 Gatekeeper 拦截；不得当作公开安装包分发。
- 模板远程下载仅支持受限 GitHub 静态目录；不会执行模板中携带的脚本。
- Windows 11 x64 Alpha 的限制、SmartScreen 指引和验收独立记录在 PRD-010。
- 出现 P0 时撤回 RC 下载入口或发布新的 `v3.2.0-rc.N` / `v3.2.1`，绝不覆盖既有 Tag。
