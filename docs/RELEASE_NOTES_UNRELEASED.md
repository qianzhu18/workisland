# WorkIsland v1.5.0 Release Notes（发布候选）

状态：`release-candidate — 范围冻结；Tag 推送后由 GitHub Actions 签名公证并创建正式 Release`

本版主题「远程与随手清理」：SSH 远程升级为独立设置页并由 WorkIsland 主动管理反向隧道，会话清理进岛工具栏，修复刘海屏工具栏遮挡。完整历史见仓库根目录的 [`CHANGELOG.md`](../CHANGELOG.md)。

## 中文说明（tag 时粘贴到 Release 页前半）

### SSH 远程：独立设置页 + WorkIsland 管理隧道

- **SSH Config 主机发现**（#150，issue #116）：设置 → SSH 远程，自动扫描 `~/.ssh/config`（支持筛选与重新扫描），常用服务器一键添加；也支持手动填写主机。
- **隧道由 WorkIsland 守护**：添加主机后 WorkIsland 从 Mac 主动 `ssh -R` 建立反向隧道并自动重连——**Mac 不再需要开启「远程登录」**。
- **接入三步走**：复制接入命令 → 第 1 步 Mac 终端拷脚本 → 第 2 步在远程主机执行配对与 hook 安装（可整段交给远程机器上的 AI 助手，指南见 [REMOTE_ONBOARDING.md](./REMOTE_ONBOARDING.md)）。
- **observe-only 边界不变**：只回传运行状态（运行中 / 等待审批 / 完成 / 失败），不回传提示词、代码或路径；一次性配对令牌、按主机分组、随时撤销；tmux attach 等交互式能力属二期另裁。

### 随手清理

- **会话清理进工具栏**（#147/#149，issue #139）：岛工具栏一键清理全部可见会话卡片，设置提供显示开关。

### 修复

- **刘海屏工具栏遮挡**（#152，issue #151）：工具栏刘海禁区两侧各加 8px 安全边距，13/14 寸 MacBook 原生屏上边缘图标不再被刘海物理遮挡；外接屏与无刘海屏行为不变。

### English Summary

Dedicated "SSH Remote" settings page (#150) — discover hosts from `~/.ssh/config` with filtering and one-click add; WorkIsland-managed reverse tunnels remove the macOS Remote Login requirement; copyable setup commands hand the remote steps to the remote machine's AI assistant; observe-only boundaries unchanged. Session cleanup moves into the island toolbar with a settings toggle (#147/#149). An 8px camera-zone safety margin stops the notch from occluding toolbar icons on 13"/14" MacBook displays (#152).

## What's Changed

（tag 时由 GitHub「Generate release notes」自动生成后填充）

## 发布前验收

- [ ] `package.json` 与 `package-lock.json` 均为 `1.5.0`。
- [ ] `npm run check` 通过。
- [ ] `npm run release:check -- --tag v1.5.0` 通过。
- [ ] 真机验收：一台真实 SSH 主机端到端（添加主机 → 隧道建立 → 状态上岛 → 撤销断隧道）；14 寸刘海屏确认清理图标完整可见。
- [ ] Tag 后 GitHub Actions 签名、公证、Staple、Gatekeeper 校验通过，生成 `SHA256SUMS.txt`。
- [ ] Release 成为 `releases/latest`，应用内更新可检测到 v1.5.0。

## 已知限制与回滚

- 隧道固定绑定远程机 17878 端口，被占用时设置页显示「隧道未建立」。
- tmux attach / 交互式操作不在本版（二期另裁）。
- 出现 P0 时发布新的 `v1.5.1`，绝不覆盖既有 Tag 或替换既有产物。
