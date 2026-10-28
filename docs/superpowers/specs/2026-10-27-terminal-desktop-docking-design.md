# 桌面终端与灵动岛收放

用户已要求编写开发计划并开始实现此前讨论的新终端模式。本期把 WorkIsland 创建的终端变成可在灵动岛和桌面之间移动的同一会话，沿用现有多终端列表、配色、快捷命令和提醒避让；不重做产品视觉。

## 用户结果与交互

- 列表和完整终端标题提供拖拽抓手。拖到灵动岛外并松手后，终端出现在可移动、可调整大小的桌面窗口；简单点击不会分离。提供「放到桌面」作为键盘入口。
- 桌面窗口内有明确的拖动抓手，拖到灵动岛吸附区后松手，收回原终端；经过吸附区但尚未松手不会提前迁移。原生标题栏可普通移动窗口，不通过 `moved` 事件猜测释放。
- 拖动期间保持源视图和指针捕获；Escape、pointercancel、lostpointercapture、失焦、来源销毁或超时均取消。桌面自定义抓手可以移动原桌面窗口；取消时恢复开始位置。
- 桌面窗口关闭按钮默认收回，不结束任务。真正终止仍经已有列表「关闭终端」确认。自然退出保留输出与退出码；重启是新一代 PTY，但保留桌面模式。
- 列表显示终端位于灵动岛还是桌面；点击桌面条目回到对应窗口，也能显式收回。支持多个桌面窗口，任何操作只针对稳定 ID。
- 查看岛内终端或在桌面终端输入时，自动 Agent 提醒不抢页、不抢键盘。待处理事项继续由原列表访问。离开终端后恢复既有提醒设置。

## 架构与选型

保留 node-pty、xterm、FitAddon，新增依赖为零。每个首次访问的终端拥有一个长期存活的 `WebContentsView`，主进程把同一视图从岛窗口 `contentView` 移到桌面宿主，收回时反向执行。PTY PID、webContents ID、xterm 实例、滚动、选区和 alternate screen 不因正常收放改变。首次进入才创建视图，不预先创建 24 个 renderer；实际进程和内存成本纳入验证。

不采用在新窗口重建 xterm 并重放 512K 输出的办法：有界原始历史不足以证明完整 TUI、选区和滚动状态可恢复。独立终端页面只负责一个明确会话；专用 preload 不暴露完整 islandBridge。主进程按 sender webContents → terminal ID/generation 绑定所有输入、resize、历史和收放命令，拒绝越界 ID、过期视图和导航。

岛页面负责列表、待处理提醒、切换器和内容占位区域，向主进程报告实际可见 bounds；原生终端视图只覆盖终端内容，不遮住头部和弹层。隐藏、换插件、收起只隐藏视图，不销毁。异步加载、重启、关闭和收放都校验视图仍属当前代次；失败时保持原宿主，不杀任务。

拖拽使用已有 pointer capture 模式，随事件保存 `screenX/screenY` 的 DIP 坐标；主进程校验来源与有限坐标、负责目标命中和窗口迁移，缺少事件坐标时回退 `screen.getCursorScreenPoint()`。这避免快速拖动在异步 IPC 到达前已移动光标而丢失起点。macOS 原生辅助操作的 move 事件可能缺少 buttons 标记，生命周期以捕获、窗口级松手、取消与超时为准。桌面位置约束到光标所在显示器 workArea；显示器移除时修正不可达窗口。自定义抓手为 `app-region: no-drag`，不可同时启用原生 app-region 拖动。吸附碰撞使用岛内实际 pill / panel 的可见区域，不把整块透明窗口当目标。

关闭、禁用和应用退出显式清理每个 native view、桌面窗口和拖动状态。窗口关闭与真正结束任务使用不同路径。位置与提交的 viewport 尺寸一同传给终端，FitAddon 只在实际尺寸匹配后拟合，避免标题切换过程中的临时增减行清掉选区。

全局 Escape/方向/确认键让渡独立追踪桌面焦点，不会被岛收起时的旧交互状态清除。

## 外部终端范围

普通 Terminal/iTerm2 已有 PTY 与原生视图由其他应用持有，不能由 Electron 直接迁移。现有外部发现继续负责回源。未来 tmux 模式需任务已在可连接的 server/session 中运行，另做协议与身份验证；不承诺把任意普通 Shell 无损改造成 tmux。

## 证据来源

- [Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)、[View](https://www.electronjs.org/docs/latest/api/view)、[BaseWindow 资源管理](https://www.electronjs.org/docs/latest/api/base-window#resource-management)。
- [自定义窗口交互](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions)：原生 drag 区域忽略 pointer 事件。
- [Electron 43.3.0 BrowserWindow events](https://github.com/electron/electron/blob/v43.3.0/docs/api/browser-window.md)：macOS moved 不能当可靠松手事件。
- [MooTool 持久视图宿主管理](https://github.com/rememberber/MooTool/blob/4f3b1f13fa7ebecb8cde9fdede44aac0500073d2/next/electron/main/toolWindowManager.ts)：MIT 项目架构参考，不引入项目或依赖。

## 验收与边界

自动回归覆盖单一宿主、按 ID/代次路由、并发关闭/加载、迁移失败回滚、桌面关闭收回、禁用/退出释放、拖拽取消、几何与焦点。真实 Electron 验证持续输出下反复收放至少 20 次，比较 PID/webContents/xterm 标记；保留半行输入、滚动、选区、TUI，多个终端互不串线；验证标题抓手真正越过窗口边界并松手、Escape 与失焦取消、点击后备操作。最后验证签名包、原有多终端和提醒路径。

多屏缩放、外接屏移除、Spaces/全屏、中文输入法组合输入和触控板未实机覆盖时逐项记录，不能以 mock 代替。交付独立 stacked PR，基于尚未合并的 PR #201；不改现有安装和正在运行的旧预览，不自动合并或发布。
