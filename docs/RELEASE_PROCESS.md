# WorkIsland 发布与更新流程

本文档是 WorkIsland 的唯一发布规范。正式发布不依赖任何个人电脑，统一由 GitHub Actions 在 macOS Runner 上完成构建、签名、公证和上传。

## 发布渠道

- 稳定版：`vX.Y.Z`，例如 `v3.0.0`
- 预发布版：`vX.Y.Z-rc.N`，例如 `v3.0.1-rc.1`
- 用户端更新检测只读取 GitHub 的稳定版 `releases/latest`
- GitHub Release 是安装包的唯一事实来源，官网只负责展示和引导下载

不要复用已经推送过的 Tag。出现问题时发布新的修复版本，并在 Release Notes 中说明变更。

## 版本 PRD 与用户手册

每个对外预发布或稳定 Release 都必须先有版本 PRD：范围、任务拆分、数据计划、验收与回滚写在同一份文档中。以 [`docs/product/prd/TEMPLATE-VERSION-PRD.md`](./product/prd/TEMPLATE-VERSION-PRD.md) 为模板，并遵守 [`Product Operating System`](./PRODUCT_OPERATING_SYSTEM.md)。

- 预发布版本只用于受邀测试者，GitHub Release 必须标记为 **Pre-release**，不能成为 `releases/latest`。
- 稳定版才可进入自动更新通道。
- 所有用户可见操作变化必须同步到官网 `/guide/`；内部实验数据、访谈名单和运营判断不写入公开手册。

## 发布前检查

在本地完成代码提交后：

```bash
npm ci
npm run check
npm run release:check -- --tag v3.0.0
```

将示例版本替换为 `package.json` 中的实际版本。`release:check` 会确认：

- `package.json` 和 `package-lock.json` 使用 Apache-2.0
- `LICENSE`、`NOTICE` 和第三方声明存在
- electron-builder 会把这些声明放入应用包
- Tag 与 `package.json` 版本完全一致

## 正式发布

1. 修改 `package.json` 和 `package-lock.json` 的版本号。
2. 更新版本 PRD、官网手册和 Release Notes，运行完整检查并提交到 `main`。
3. 创建并推送与版本一致的 Tag：

   ```bash
   git tag -a v3.0.0 -m "Release v3.0.0"
   git push origin v3.0.0
   ```

4. `release.yml` 自动执行：
   - macOS 14 Apple Silicon 构建
   - Developer ID 签名
   - Apple 公证并 Staple
   - DMG 签名校验和 Gatekeeper 校验
   - SHA-256 校验文件生成
   - GitHub Release 创建和附件上传
5. 在 GitHub Actions 和 Release 页面确认产物可下载。

## GitHub Secrets

在仓库的 Settings → Secrets and variables → Actions 中配置：

- `CSC_LINK`：Developer ID Application `.p12` 的 Base64 内容或安全下载地址
- `CSC_KEY_PASSWORD`：证书密码
- `APPLE_API_KEY`：App Store Connect API Key `.p8` 内容
- `APPLE_API_KEY_ID`：API Key ID
- `APPLE_API_ISSUER`：Issuer ID

证书、`.p8` 文件和密码不得提交到仓库、Issue、PR 或日志。证书轮换时只更新 Secrets，不修改代码。

## 更新检测行为

安装版应用启动后延迟检查一次，之后最多每天检查一次。应用只请求：

```text
https://api.github.com/repos/qianzhu18/workisland/releases/latest
```

当前版本低于稳定版时，WorkIsland 会通过 macOS 通知和设置页提醒用户，点击后打开官方 Release 下载页。V1 不自动下载、不自动安装，也不上传会话、项目或使用数据。

用户可以在“关于 → 更新”中关闭自动检查，仍然可以手动检查。网络失败不会影响应用启动和本地 Agent 监控。

另有独立的匿名使用统计通道：默认开启，并在「设置 → 关于」公开披露与提供一键关闭；关闭立即清空未上传队列，此后不再上报白名单事件（见 [遥测说明](./TELEMETRY.md)）。两个通道互不影响，关闭任一通道均不影响应用功能。

## 手动运行工作流

`workflow_dispatch` 只用于验证构建和生成临时 Artifact，不会创建正式 Release，也不会代替 Tag 发布。正式公开版本必须通过版本一致的 `v*` Tag 触发。
