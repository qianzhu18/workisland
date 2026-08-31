# 本地智能体控制（MCP 与 CLI）

WorkIsland 可以把一小组本地功能提供给 Codex 等支持 MCP 的智能体：读取或修改安全设置、查看脱敏后的可见会话、跳回会话、打开设置，以及切换灵动岛/桌宠。它不是远程控制接口，也不能执行任意终端命令。

## 开启与连接 Codex

此功能**默认关闭**。开启需要两个独立步骤：

1. 在 WorkIsland 打开「设置 → 智能体控制」，开启“允许智能体控制 WorkIsland”。
2. 点击“连接 Codex”。WorkIsland 会先备份 `~/.codex/config.toml`，再写入 `mcp_servers.workisland`，并开启当前 Codex 版本加载用户 MCP 所需的 `features.mcp_2026_07_28` 兼容开关。已有模型、其他 MCP 和其他配置会保留。

“已配置，等待首次调用”表示配置文件已写好；只有 Codex 真正成功调用过 WorkIsland 工具后，页面才显示“已连接”。配置后请新建一个 Codex 会话，让客户端重新加载 MCP 列表。Codex 使用本地 stdio MCP 配置，WorkIsland 以 Electron 的 Node 模式启动随应用打包的 `workisland-mcp` 入口。

## 手动配置

其他支持本地 stdio MCP 的客户端可以使用「智能体控制」页面生成的**手动配置**。不要照抄固定的应用路径：页面展示的是当前安装位置、可直接使用的 command、args 和 env。等价结构如下：

```toml
[features]
mcp_2026_07_28 = true

[mcp_servers.workisland]
command = "/Applications/WorkIsland.app/Contents/MacOS/WorkIsland"
args = ["/Applications/WorkIsland.app/Contents/Resources/app.asar/src/island/workisland-mcp/index.mjs"]

[mcp_servers.workisland.env]
ELECTRON_RUN_AS_NODE = "1"
WORKISLAND_MCP_CLIENT = "Codex"
```

应用移动位置或更新安装方式后，应回到设置页重新生成配置。

## MCP 工具

| 工具 | 能力 |
| --- | --- |
| `describe_settings` | 返回允许控制的设置、约束、默认值与当前值 |
| `get_settings` | 读取全部或指定的允许设置 |
| `update_settings` | 原子修改最多 20 个允许设置，并返回撤销 ID |
| `undo_settings_change` | 在没有新修改冲突时撤销一次智能体设置修改 |
| `get_product_state` | 读取显示载体、模块状态及脱敏会话计数 |
| `list_visible_sessions` | 返回不含内容和本机标识的可见会话列表 |
| `focus_session` | 使用临时公开 ID 跳回一个仍可见的会话 |
| `open_settings` | 打开白名单内的 WorkIsland 设置页面 |
| `set_display_surface` | 在灵动岛和桌宠之间切换 |

智能体修改设置后，WorkIsland 会显示一张低优先级“设置已改变”卡片。连续修改会合并，5 秒后自动收起；审批、提问等需要用户处理的状态优先。卡片提供“撤销”和“查看设置”。

## CLI

CLI 与 MCP 共用同一套主进程权限边界，不会直接读写设置文件：

```bash
workisland settings list
workisland settings get completionPopupDurationSec
workisland settings set completionPopupDurationSec 8
workisland settings undo <change-id>
workisland sessions list
workisland session focus <public-session-id>
workisland settings open agent-control
workisland surface set pet
workisland state
```

成功时 stdout 输出一个 JSON 文档；参数错误退出码为 2，WorkIsland 拒绝或不可用时退出码为 1，错误 JSON 写入 stderr。

## 隐私边界与安全限制

- 仅使用当前用户可访问的 Unix Socket 或 Windows 命名管道，不监听 TCP 端口；macOS Socket 目录权限为 `0700`，Socket 为 `0600`。
- 主开关在 WorkIsland 主进程的每次请求上检查。关闭后立即返回 `LOCAL_CONTROL_DISABLED`。
- 设置采用显式白名单。智能体不能开启隐私收集、修改 Hook、改变审批策略、写任意文件路径或 URL，也不能执行终端命令。
- 会话仅返回临时不透明 ID、智能体类型、阶段、更新时间、是否需要注意和能否聚焦；不会返回提示词、回答、项目路径、终端 ID、PID 或原始 Hook 数据。
- MCP 不能批准/拒绝请求、回答问题、删除会话、结束进程或读取项目内容。
- 最近活动只保存固定字段，最多 100 条；设置撤销记录只在当前 WorkIsland 进程中保留最近 50 条。

常见错误包括：`LOCAL_CONTROL_DISABLED`（开关关闭）、`WORKISLAND_UNAVAILABLE`（应用未运行）、`SETTING_NOT_ALLOWED`、`INVALID_SETTING_VALUE`、`UNDO_CONFLICT`、`CHANGE_UNAVAILABLE` 和 `SESSION_UNAVAILABLE`。

## 移除

在「设置 → 智能体控制」点击“断开 Codex”，WorkIsland 只会移除 `mcp_servers.workisland`，不会删除其他 MCP，也不会替用户关闭可能已被其他 MCP 使用的兼容开关。然后关闭主开关；正在运行的客户端会从下一次请求开始立即失去权限。最后重启或新建 Codex 会话刷新工具列表。

如需手动移除，先备份 `~/.codex/config.toml`，只删除 `[mcp_servers.workisland]` 及其 env 子表。WorkIsland 自动生成的备份文件名包含 `.workisland-backup-<时间戳>`。
