# WorkIsland 远程接入指南（AI 可读版）v1.1

状态：`v1.1`（v1.5.0 起：WorkIsland 主动连接远程主机并管理反向隧道，Mac 不再需要开启「远程登录」； observe-only 边界不变）
日期：2026-09-10（v1：2026-09-07）
目标读者：**远程机器上的 AI 编码助手**（Claude Code / Codex CLI / Cursor CLI 等）+ 负责 Mac 侧操作的人类用户。推荐路径：设置 → SSH 远程 → 从 SSH Config 添加主机 → 复制接入命令，把命令块交给本机上的 AI 执行。

---

## 给 AI 助手的任务说明

你的任务：让这台远程机器上运行的 AI 编码 Agent 的**状态**（运行中 / 等待审批 / 完成 / 失败）出现在用户本地 Mac 的 WorkIsland 岛上。全程 **observe-only**：只回传状态，不回传代码、prompt、路径；服务端入口也会强制丢弃这些字段。

**隧道已由 WorkIsland 建好**：WorkIsland 会从用户 Mac 主动 `ssh -N -R 17878:127.0.0.1:7878 <主机>`（复用 `~/.ssh/config` 与用户密钥），把本机 17878 反向指向 Mac 的 observe-only 入口。你只需要完成配对与 hook 安装，不需要自己建隧道。

### 硬性边界（违反即停止）

1. 禁止修改 sshd 全局配置（`/etc/ssh/sshd_config`），也禁止修改 Mac 的系统设置。
2. 禁止把配对令牌写入任何持久化文件（只在 pair 命令参数中一次性使用）。
3. 禁止安装本指南之外的软件包；只需 `bash`、`ssh`、`node ≥ 18`。
4. 禁止把回传内容扩展到状态之外（不要发明新事件类型或额外字段）。
5. 每一步执行后必须运行「自检」；自检不过就停下并向用户报告，重试不超过 2 次。

### 用户侧前置（WorkIsland 设置页完成，无需 Mac「远程登录」）

1. WorkIsland「设置 → SSH 远程」已开启远程接入。
2. 「待添加主机」里从 SSH Config 选中目标主机点「添加」（或手动填写），WorkIsland 自动建立并守护反向隧道。
3. 点「复制接入命令」得到命令块（含一次性配对令牌，10 分钟有效、只能用一次）；第 1 行 scp 在 Mac 终端执行，其余在远程主机执行。

### 步骤（远程机器上的 AI 助手执行）

1. **环境自检**：`bash`、`node -v`（≥18）可用；确认接入脚本已存在：`ls ~/workisland-remote.cjs`。
2. **校验脚本**：`shasum -a 256 ~/workisland-remote.cjs`，与文末校验和比对，不一致立即停止。
3. **配对**（令牌 10 分钟有效、一次性；隧道由 WorkIsland 侧守护）：
   ```bash
   node ~/workisland-remote.cjs pair <配对令牌>
   ```
   成功后会话密钥存入 `~/.workisland-remote/session-key`（0600），令牌即弃，不会落盘。
4. **安装回传 hook**（当前支持 Claude Code）：
   ```bash
   node ~/workisland-remote.cjs install-hooks
   ```
   这会把 SessionStart / UserPromptSubmit / Notification / Stop / SessionEnd 五个 hook 指向本脚本；安装前自动备份 `~/.claude/settings.json`。
5. **自检清单**：
   - [ ] 反向隧道端口可达：`nc -z 127.0.0.1 17878` 成功（不通 = WorkIsland 侧隧道未建立，请用户在设置页看隧道状态或点「重连隧道」）
   - [ ] 手动状态：`node ~/workisland-remote.cjs send running selftest-0001 claude` 后，用户岛上出现该主机的新会话卡（问用户确认）
   - [ ] 收尾测试：`... send completed selftest-0001 claude` 后卡片转为完成态
   - [ ] 跑一条真实 Agent 命令，岛上状态从 running → completed

### 常见失败与诊断话术

| 现象 | 最可能原因 | 给用户的话术 |
| --- | --- | --- |
| `nc -z 127.0.0.1 17878` 不通 | WorkIsland 侧隧道未建立（Mac 连不上这台主机） | 「请在 WorkIsland 设置 → SSH 远程 看这台主机的隧道状态；必要时点「重连隧道」，并确认 Mac 终端能免密 `ssh <主机>`」 |
| 配对失败 TOKEN_INVALID | 令牌过期或已被使用 | 「请用户重新点「复制接入命令」获取新令牌」 |
| 发送失败 HOST_UNKNOWN_OR_REVOKED | 用户撤销了这台主机 | 「请用户重新添加主机并重跑配对与 hook 安装」 |
| 岛上无反应 | hook 没触发 | 「请确认 Claude Code 版本支持 hooks 配置，重跑自检」 |

### 已知限制（第一阶段）

- observe-only：岛上只展示状态；审批仍在远程终端完成，岛上的远程会话卡没有审批/追问按钮。
- 不支持 tmux attach / 交互式操作（二期另裁，见 ADR-0005）。
- 隧道由 WorkIsland 守护（断开按指数退避自动重连）；断开期间的事件会丢失（岛上显示断线，不补发）。
- 反向隧道固定绑定远程机的 17878 端口：若该端口被占用，隧道会持续失败，设置页可见「隧道未建立」。
- 自动回传 hook 当前只装 Claude Code；其他 Agent 可用 `send` 子命令手动回传。
- 不支持 Windows 远程侧。

---

脚本 SHA-256：

```
91007ed61900324fe0613ceb6f60bdbd0a14cbcf2f2e36250f38213f79e9d152  workisland-remote.cjs
```

> 校验和对应本文件提交版本的 `resources/remote/workisland-remote.cjs`；脚本随版本更新时此行同步更新。
