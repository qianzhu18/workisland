# PRD-013：多终端管理

状态：`implemented / PR review pending`  
Owner：WorkIsland maintainers  
目标版本：下一版，尚未排期  
GitHub tracking Issue：[\#200](https://github.com/qianzhu18/workisland/issues/200)  
Pull Request：[\#201](https://github.com/qianzhu18/workisland/pull/201)
设计：[多终端管理](../../superpowers/specs/2026-10-27-multi-terminal-manager-design.md)

## 用户问题与目标

同时运行多个 CLI / Agent 时，原有入口只能进入一个内置终端，无法从首页识别任务或单独关闭。用户已确认「上方终端列表、下方快捷命令」布局，要求能进入、关闭和新建，外部系统终端作为可选增强。

目标是让三个以上任务独立运行、快速切换并定向关闭，同时保留已有工作上下文。不做终端复用器、外部 PTY 嵌入、命令内容采集或跨重启恢复。

## 用户旅程与验收

| 场景 | 行为 | 验收 |
| --- | --- | --- |
| 创建多个任务 | 独立 Shell、名称、启动目录和运行状态；最多 24 个条目 | 三个真实 PTY 分别执行命令，输入输出不串线 |
| 切换与返回 | 列表进入、内部选择器、返回首页、工具切换 | 半行输入、后台输出、历史滚动和 alternate screen 保留 |
| 收尾任务 | 运行中确认关闭、只结束指定任务；退出后重启 | 关闭中间会话及其子进程，其他会话继续执行；保留退出码 |
| 使用快捷命令 | 每次在具名新终端执行 | 原有终端不收到命令 |
| 多 Agent 提醒 | 查看终端时所有 Agent 自动提醒不切页；保留待处理入口，点击才进入 | 旧提醒倒计时与失效会话不关闭终端；真实 PTY 半行输入跨提醒和手动切页保留 |
| 发现外部终端 | 用户主动查找 Terminal/iTerm2，按身份回原应用 | 元数据限定、过期身份不回退、拒绝权限可理解 |

## 约束与验证边界

沿用现有工具栏入口和配色，中英文文案齐全，支持键盘重命名、确认和取消。隐藏终端保留 xterm 实例；输出缓存、初始队列和会话数量有界。只使用现有 node-pty、xterm 和官方 FitAddon，新增 FitAddon 用于公开尺寸接口。

外部发现只在 macOS 用户主动操作时运行 Apple Events；签名包保留用途说明和自动化 entitlement。Terminal 不支持可靠的单标签关闭，禁止回退关闭整个窗口。iTerm2 关闭只针对唯一会话；宿主读取失败不能算关闭成功。iTerm2 的真实设备行为仍需可用安装验证，协议和权限边界有注入回归。

## 实施与发布

任务通过 #200 统一跟踪：会话生命周期与 IPC、列表及持久画面、外部发现、签名包交互验证与文档。详见[实施计划](../../superpowers/plans/2026-10-27-multi-terminal-manager.md)与[验证记录](../../superpowers/plans/2026-10-27-multi-terminal-validation.md)。

更新 [用户手册](../../TERMINAL-MANAGER.md)、CHANGELOG 和第三方许可。先交付功能 PR 与本地隔离预览，不更换用户当前安装、不发布正式版。后续正式发布沿用现有签名、公证、更新校验流程；24 小时 / 7 天复盘重点是错关、上下文丢失、后台资源占用和外部权限困惑。此次不新增遥测事件。
