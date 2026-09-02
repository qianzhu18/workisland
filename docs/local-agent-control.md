# WorkIsland MCP 产品助手

WorkIsland MCP 让 Codex 等本机智能体理解 WorkIsland 的产品功能、查询 WorkIsland 已观察到的智能体状态与接入状态，并诊断常见的“为什么没有显示”问题。修改设置、切换显示载体或聚焦会话仍然可用，但只有用户明确要求时才应该执行。

它不是进程注入、远程控制或通用终端接口。MCP 适配器只负责把经过校验的请求转交给正在运行的 WorkIsland；设置权限、脱敏、审计和撤销都由 WorkIsland 主进程决定。

## 适合怎样提问

连接后可以直接问智能体：

- “灵动岛有哪些扩展功能？”
- “现在有哪些智能体正在运行？”
- “有没有智能体在等我处理？”
- “WorkIsland 支持哪些智能体，哪些已经连接成功？”
- “为什么性能监控没有显示进程详情？”
- “文件架和剪贴板历史有什么区别？”

MCP 返回的会话是 **WorkIsland 已观察到并仍在展示范围内的会话**，不是系统进程清单。没有结果只代表 WorkIsland 当前没有观察到可见会话，不能据此断言某个智能体或进程没有运行。

## 开启与连接 Codex

此功能**默认关闭**。MCP 位于设置导航的**倒数第二**项，仅高于“关于”。开启需要两个独立步骤：

1. 打开「设置 → MCP」中的“MCP 服务”，开启“启用 WorkIsland MCP”。
2. 点击“连接 Codex”。WorkIsland 会先备份 `~/.codex/config.toml`，再写入 `mcp_servers.workisland`，并开启当前 Codex 版本加载本机 MCP 所需的 `features.mcp_2026_07_28` 兼容开关。已有模型、其他 MCP 和其他配置会保留。

“已配置，等待首次调用”表示配置文件已写好；只有 Codex 真正成功调用过 WorkIsland 工具后，页面才显示“已连接”。配置后请新建一个 Codex 会话，让客户端重新加载 MCP 列表。Codex 使用本地 stdio MCP 配置，WorkIsland 以 Electron 的 Node 模式启动随应用打包的 `workisland-mcp` 入口。

## MCP 工具

| 工具 | 类型 | 能力 |
| --- | --- | --- |
| `list_capabilities` | 只读 | 列出 WorkIsland 的功能、可用平台、当前启用状态、使用方法和隐私说明 |
| `get_capability` | 只读 | 查看一个具体功能的详细说明与相关设置 |
| `list_active_sessions` | 只读 | 返回 WorkIsland 当前观察到的脱敏会话状态 |
| `list_integrations` | 只读 | 返回支持的智能体接入、安装状态和真实事件验证状态 |
| `diagnose` | 只读 | 诊断智能体、媒体、性能、文件架、剪贴板、终端或用量为何没有显示 |
| `get_product_state` | 只读 | 读取显示载体、模块状态及脱敏会话计数 |
| `describe_settings` | 只读 | 描述允许读取或修改的设置、约束和默认值 |
| `get_settings` | 只读 | 读取全部或指定的允许设置 |
| `update_settings` | 动作 | 在用户明确要求后原子修改最多 20 个允许设置，并返回撤销 ID |
| `undo_settings_change` | 动作 | 在没有新修改冲突时撤销一次近期修改 |
| `focus_session` | 动作 | 使用临时公开 ID 跳回一个仍可见、可聚焦的会话 |
| `open_settings` | 动作 | 打开白名单内的 WorkIsland 设置页面 |
| `set_display_surface` | 动作 | 在灵动岛和桌宠之间切换 |

智能体回答“有什么功能”时应先调用 `list_capabilities`，而不是把可修改设置当成功能清单。遇到具体异常时可调用只读的 `diagnose`；只有用户明确要求改变产品行为时才调用设置动作。

智能体修改设置后，WorkIsland 会显示低优先级的“设置已改变”卡片。连续修改会合并，5 秒后自动收起；审批、提问等需要用户处理的状态优先。卡片提供“撤销”和“查看设置”。

## 高级设置与手动配置

其他支持本地 stdio MCP 的客户端可以展开 MCP 页面底部的**高级设置 → 手动配置**。不要照抄固定的应用路径：页面展示的是当前安装位置、可直接使用的 command、args 和 env。等价结构如下：

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

## CLI

CLI 与 MCP 共用同一套主进程权限边界，不会直接读写设置文件：

```bash
workisland settings list
workisland settings get completionPopupDurationSec
workisland settings set completionPopupDurationSec 8
workisland settings undo <change-id>
workisland sessions list
workisland session focus <public-session-id>
workisland settings open mcp
workisland surface set pet
workisland state
```

成功时 stdout 输出一个 JSON 文档；参数错误退出码为 2，WorkIsland 拒绝或不可用时退出码为 1，错误 JSON 写入 stderr。

## 隐私边界与安全限制

- 仅使用当前用户可访问的 Unix Socket 或 Windows 命名管道，不监听 TCP 端口；macOS Socket 目录权限为 `0700`，Socket 为 `0600`。
- 主开关在 WorkIsland 主进程的每次请求上检查。关闭后立即返回 `LOCAL_CONTROL_DISABLED`。
- 产品能力目录只返回公开说明、启用状态和相关设置，不返回内部路径或敏感运行数据。
- 设置采用显式白名单。智能体不能开启隐私收集、修改 Hook、改变审批策略、写任意文件路径或 URL，也不能执行终端命令。
- 会话仅返回临时不透明 ID、智能体类型、阶段、更新时间、是否需要注意和能否聚焦；不会返回提示词、回答、项目路径、终端 ID、PID 或原始 Hook 数据。
- 接入状态不暴露配置路径或原始诊断报告；“已验证”需要 WorkIsland 收到真实事件，配置文件存在本身不等于连接成功。
- MCP 不能批准或拒绝请求、代替用户回答问题、删除会话、结束进程或读取项目内容。
- 最近活动只保存固定字段，最多 100 条；设置撤销记录只在当前 WorkIsland 进程中保留最近 50 条。

常见错误包括：`LOCAL_CONTROL_DISABLED`（开关关闭）、`WORKISLAND_UNAVAILABLE`（应用未运行）、`CAPABILITY_NOT_FOUND`、`DIAGNOSIS_NOT_ALLOWED`、`SETTING_NOT_ALLOWED`、`INVALID_SETTING_VALUE`、`UNDO_CONFLICT`、`CHANGE_UNAVAILABLE` 和 `SESSION_UNAVAILABLE`。

## 移除

在「设置 → MCP」点击“断开 Codex”，WorkIsland 只会移除 `mcp_servers.workisland`，不会删除其他 MCP，也不会替用户关闭可能已被其他 MCP 使用的兼容开关。然后关闭 MCP 服务；正在运行的客户端会从下一次请求开始立即失去权限。最后重启或新建 Codex 会话刷新工具列表。

如需手动移除，先备份 `~/.codex/config.toml`，只删除 `[mcp_servers.workisland]` 及其 env 子表。WorkIsland 自动生成的备份文件名包含 `.workisland-backup-<时间戳>`。
