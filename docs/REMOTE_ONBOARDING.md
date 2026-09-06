# WorkIsland 远程接入指南（AI 可读版）v1

状态：`v1`（ADR-0005 第一阶段 observe-only 已裁定通过，对应 PRD-016 T4；取代 vault 中的 v0 草稿）
日期：2026-09-07
目标读者：**远程机器上的 AI 编码助手**（Claude Code / Codex CLI / Cursor CLI 等）。人类用户只需把本文档交给远程机器上的 AI，并在 WorkIsland 里生成一次配对令牌。

---

## 给 AI 助手的任务说明

你的任务：让这台远程机器上运行的 AI 编码 Agent 的**状态**（运行中 / 等待审批 / 完成 / 失败）出现在用户本地 Mac 的 WorkIsland 岛上。全程 **observe-only**：只回传状态，不回传代码、prompt、路径；服务端入口也会强制丢弃这些字段。

### 硬性边界（违反即停止）

1. 禁止修改 sshd 全局配置（`/etc/ssh/sshd_config`），也禁止修改 Mac 的系统设置。
2. 禁止把配对令牌写入任何持久化文件（只在 pair 命令参数中一次性使用）。
3. 禁止安装本指南之外的软件包；只需 `bash`、`ssh`、`node ≥ 18`。
4. 禁止把回传内容扩展到状态之外（不要发明新事件类型或额外字段）。
5. 每一步执行后必须运行「自检」；自检不过就停下并向用户报告，重试不超过 2 次。

### 用户侧前置（请向用户确认，不要替用户操作）

1. Mac 已开启「远程登录」：系统设置 → 通用 → 共享 → 远程登录（这会启用系统级 sshd，是用户自管 SSH 的前提）。
2. 用户已告知你 Mac 的登录名与地址（形如 `qianzhu@192.168.1.8`，同局域网或可达）。
3. WorkIsland「设置 → Agents → 远程主机」已开启远程接入，并生成了**配对令牌**（10 分钟内有效、只能用一次）。
4. 脚本已放在本机：`~/workisland-remote/workisland-remote.cjs`（从 WorkIsland 仓库 `resources/remote/` 获取），SHA-256 校验和与文末一致。

### 步骤

1. **环境自检**：`bash`、`ssh`、`node -v`（≥18）可用；记录 OS 与架构。
2. **校验脚本**：`shasum -a 256 ~/workisland-remote/workisland-remote.cjs`，与文末校验和比对，不一致立即停止。
3. **建立身份**：`node ~/workisland-remote/workisland-remote.cjs init`（生成 `~/.workisland-remote/host-id`，已存在则复用）。
4. **建立 SSH 隧道**（注意方向：本机发起 `-L` 本地转发，事件流向 远程 → Mac）：
   ```bash
   ssh -N -L 17878:127.0.0.1:7878 <user>@<mac> -o ServerAliveInterval=15 -o ExitOnForwardFailure=yes
   ```
   用 `nohup` 或 tmux 会话常驻；隧道必须保持存活，断开期间状态会丢失（岛上显示断线，不补发）。
5. **配对**（令牌 10 分钟有效、一次性）：
   ```bash
   node ~/workisland-remote/workisland-remote.cjs pair <配对令牌>
   ```
   成功后会话密钥存入 `~/.workisland-remote/session-key`（0600），令牌即弃，不会落盘。
6. **安装回传 hook**（当前支持 Claude Code）：
   ```bash
   node ~/workisland-remote/workisland-remote.cjs install-hooks
   ```
   这会把 SessionStart / UserPromptSubmit / Notification / Stop / SessionEnd 五个 hook 指向本脚本；安装前自动备份 `~/.claude/settings.json`。
7. **自检清单**：
   - [ ] 隧道进程存活：`nc -z 127.0.0.1 17878` 成功
   - [ ] 手动状态：`node ~/workisland-remote/workisland-remote.cjs send running selftest-0001 claude` 后，用户岛上出现该主机的新会话卡（问用户确认）
   - [ ] 收尾测试：`... send completed selftest-0001 claude` 后卡片转为完成态
   - [ ] 跑一条真实 Agent 命令，岛上状态从 running → completed
   - [ ] 断开隧道 30 秒重连：岛上会话变为「远程连接已断开」，重连后状态恢复，无假 running

### 常见失败与诊断话术

| 现象 | 最可能原因 | 给用户的话术 |
| --- | --- | --- |
| 隧道秒断 | Mac 的 22 端口未开（未开远程登录） | 「请在 Mac 上开启：系统设置 → 通用 → 共享 → 远程登录」 |
| 本机连 17878 超时 | 隧道未建立 / WorkIsland 远程接入未开启 | 「请确认第 4 步 ssh 进程存活，且 WorkIsland 设置里远程接入已启用」 |
| 配对失败 TOKEN_INVALID | 令牌过期或已被使用 | 「请用户在 WorkIsland 设置里重新生成一次性令牌」 |
| 发送失败 HOST_UNKNOWN_OR_REVOKED | 用户撤销了这台主机 | 「请用户重新生成令牌并重跑第 5、6 步」 |
| 岛上无反应 | hook 没触发 | 「请确认 Claude Code 版本支持 hooks 配置，重跑自检第 2 步」 |

### 已知限制（第一阶段）

- observe-only：岛上只展示状态；审批仍在远程终端完成，岛上的远程会话卡没有审批/追问按钮。
- 不支持 tmux attach / 交互式操作（二期另裁，见 ADR-0005）。
- 隧道断开期间的事件会丢失（岛上显示断线，不补发）。
- 自动回传 hook 当前只装 Claude Code；其他 Agent 可用 `send` 子命令手动回传。
- 不支持 Windows 远程侧。

---

脚本 SHA-256：

```
91007ed61900324fe0613ceb6f60bdbd0a14cbcf2f2e36250f38213f79e9d152  workisland-remote.cjs
```

> 校验和对应本文件提交版本的 `resources/remote/workisland-remote.cjs`；脚本随版本更新时此行同步更新。
