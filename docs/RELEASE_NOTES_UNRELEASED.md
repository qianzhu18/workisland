# WorkIsland v1.4.0 Release Notes（发布候选）

状态：`release-candidate — 范围冻结；Tag 推送后由 GitHub Actions 签名公证并创建正式 Release`

本版主题「覆盖与留存 · 第一阶段收口」：把已合入 `main` 验证的四个留存/开放特性与远程接入 observe-only 第一阶段正式发出去，并首次公开性能实测数据。范围基线见 [`docs/03-roadmap/v1.4.0-版本规划-2026-09-06.md`](./03-roadmap/v1.4.0-版本规划-2026-09-06.md)；完整历史见仓库根目录的 [`CHANGELOG.md`](../CHANGELOG.md)。

自本版起，GitHub Release 说明采用 **中文全文在前 + `### English Summary` 在后** 的双语结构（英文为摘要，不逐条直译），检查项见 [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md)。

## 中文说明（tag 时粘贴到 Release 页前半）

### 覆盖与留存：四个新特性

- **安静时段与锁屏静音**（#95）：设置 → 声音可配置勿扰时段（如 22:00 → 08:00，支持跨午夜），时段内不播放任务提示音；macOS 锁屏期间同样静音；两项独立开关。手机推送（Bark）刻意不受抑制——安静时段用户不在电脑前，推送正是通知出口。
- **Plan 确认卡 Markdown 渲染**（#92）：Plan 确认文本按 Markdown 渲染（标题、列表、代码块，复用岛上既有渲染样式），默认折叠、一键展开全文；链接点击走系统浏览器。
- **本地开发者 API**（#93）：设置 → 关于可开启只读状态端点 `127.0.0.1:9938/api/status`，返回会话状态 JSON；默认关闭，可选 Bearer 令牌鉴权；响应不含 prompt、路径或会话内容。详见 [DEVELOPER_API.md](./DEVELOPER_API.md)。
- **用量发现通道（首批）**（#94）：zcode / opencode / claude 三个客户端的 token 用量改为主动从本地会话数据发现并入账，不再依赖 Hook 携带 `transcript_path`；此前这些客户端会话能上岛但用量不入账。

### 远程接入：observe-only 第一阶段

- **远程主机状态上岛**（#116，ADR-0005 第一阶段裁定通过）：设置 → Agents → 远程主机生成一次性配对令牌（10 分钟有效、单次使用），远程机器上的 AI 助手按内置指南 [REMOTE_ONBOARDING.md](./REMOTE_ONBOARDING.md) 自助建立 SSH 隧道，远程 Agent 会话状态实时上岛并按主机分组标注。
- **observe-only 安全边界**：只回传运行状态，不回传提示词、代码或路径——入口白名单只读取状态元数据并物理丢弃其余字段；本机仅新增 `127.0.0.1:7878` 一个 loopback 监听；隧道由用户自管 SSH 建立，公网中转不做；令牌可随时撤销，撤销立即生效。
- **断线不骗人**：隧道断开时远程会话以「远程连接已断开」收卡，恢复后自动覆盖，不悬挂假 running。
- tmux attach / 交互式操作超出 observe-only 白名单，属二期另裁，本版不含。

### 性能

- **闲置性能实测数据公开**（#108）：Apple M4 · v1.3.0 实测闲置 CPU 中位 **2.9%**（< 3% 达标，贴线）、内存 top 口径 535 MB / RSS 341 MB；测试方法与原始采样见 [PERFORMANCE.md](./PERFORMANCE.md)，`scripts/perf-idle-benchmark.mjs` 可复现。

### 说明

- 本 DMG 已 Developer ID 签名并通过 Apple 公证，下载后可直接打开（SHA256 见 `SHA256SUMS.txt`）。
- Intel（x64）安装包：#103 已修复 Intel 构建路径，本版 tag 是第一个验证点——x64 DMG 产出并通过签名公证后，才在宣发中解锁「支持 Intel」；发布后回填实际结果。
- 装过 3.x 旧包的同学：由于版本号重置，旧包认不出 1.x 是新版，请手动下载重装这一次；此后应用内自动升级即生效。

### English Summary

Quiet Hours and lock-screen mute for local alert sounds, with Bark push deliberately unsuppressed (#95); Plan confirmations render as collapsible Markdown (#92); opt-in read-only local Developer API at `127.0.0.1:9938/api/status` with Bearer auth, off by default (#93); usage discovery covers zcode / opencode / claude without relying on `transcript_path` (#94); phase 1 of observe-only remote access (#116) — pair a remote machine with a one-time token and stream its agent session status to the Island over a user-managed SSH tunnel, grouped by host; status only with content fields dropped at the entry, tunnel drops surface as explicit disconnected cards, interactive attach deferred; published idle-performance benchmarks — 2.9% median idle CPU, reproducible via `scripts/perf-idle-benchmark.mjs` (#108).

## What's Changed

（tag 时由 GitHub「Generate release notes」自动生成后填充）

## 发布前验收

- [ ] `package.json` 与 `package-lock.json` 均为 `1.4.0`（prepare 提交时更新）。
- [ ] `npm run check` 通过。
- [ ] `npm run release:check -- --tag v1.4.0` 通过。
- [ ] `CHANGELOG.md` 的 `[Unreleased]` 段改名为 `[1.4.0]` + 发布日期，英文摘要保留。
- [ ] Release 页说明 = 本文件中文段在前 + `### English Summary` 在后。
- [ ] 官网 `website/changelog/index.html` 加入 v1.4.0 条目（口径与 Release 页一致），随 Tag 部署，不提前上线。
- [ ] GitHub Actions 双架构签名、公证、Staple、Gatekeeper 校验通过，生成 `SHA256SUMS.txt` / `SHA256SUMS-x64.txt`。
- [ ] **tag 后验证 x64 管线**：确认 x64 DMG 真实产出并通过签名公证（第一个验证点，见上「说明」）。
- [ ] Release 成为 `releases/latest`，应用内更新可检测到 v1.4.0。

## 已知限制与回滚

- Intel 机型的媒体工作台依赖 MediaRemote 私有框架，行为与 Apple Silicon 存在差异，属尽力支持（见 [COMPATIBILITY.md](./COMPATIBILITY.md)）。
- Windows Alpha 为独立版本线，不在本版本范围（见版本规划第五节）。
- 会话/tab 级聚焦抑制（#111）、五大终端 tab 级跳转（#112）、无刘海悬浮条（#109）、应用内 i18n（#110）明确顺延 v1.5+，勿提前开工。
- 出现 P0 时发布新的 `v1.4.1`，绝不覆盖既有 Tag 或替换既有产物。
