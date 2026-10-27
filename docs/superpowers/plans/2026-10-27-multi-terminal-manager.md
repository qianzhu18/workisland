# 多终端管理实施计划

Design: `docs/superpowers/specs/2026-10-27-multi-terminal-manager-design.md`

1. **独立会话与生命周期回归** — `tests/terminal-service.test.mjs` 创建三个 fake PTY；验证按 ID 输入/resize/select/close，非当前关闭不变更当前，迟到的 data/exit 不污染重启实例，后台输出保留，大块输出完整传递，有界缓存与资源上限。先运行 `node --test tests/terminal-service.test.mjs`，确认缺少 create/select/close 导致失败。
2. **服务与桥接** — `src/main/terminal-service.cjs` 用 `Map<id,{pty,status,outputBuffer,sequence}>` 管理会话。`create(options)`, `select(id)`, `close(id)`, `rename(id,name)`；`input(value,id)`, `resize(size,id)`, `restart(options,id)`；`snapshot(id)` 返回平铺当前状态、activeId 与轻量 sessions。状态通知不携带全列表输出缓存。新增 IPC 并贯穿 coordinator、ipc-services 与 preload；快捷命令创建具名新终端并输入到返回的明确 ID。
3. **列表与终端画面** — 改造 `src/renderer/island/components/TerminalPanel.js` 和 `app.css`。首页列表＋快捷命令；终端内选择器、新建、返回、关闭。每个访问过的终端保留独立 xterm DOM，数据单次订阅按 ID 分发，初始快照用 sequence 去重，只有当前可见终端获焦点/resize/全局快捷键让渡。重命名和关闭使用内联编辑/确认，移除进程后清理对应 xterm。
4. **外部发现适配** — 复用系统 AppleScript 与现有终端导航；用户主动查找 Terminal/iTerm，返回稳定目标、宿主、明确权限错误与能力。未知/已消失目标不回退到当前窗口。补齐 Apple Events 用途说明与 hardened-runtime entitlement，测试拒绝授权时内部功能仍可用。实际第三方控制与模拟测试结果分别记录。
5. **本地完整验证** — `npm run check`、原生构建、包内容检查；独立用户目录启动 Electron，真实三个 PTY＋xterm 交互、关闭隔离、后台输出/输入保留、快捷命令、键盘焦点、上下文与开关回归。截图验证布局并执行 Impeccable detector。保持用户已安装正式版及数据不变。
6. **交付** — 同步中英界面文案、手册、CHANGELOG；创建功能 PR 并附实际验证范围，等待关联 CI；不发布正式版本、不修改用户系统终端或终止用户现有任务。
