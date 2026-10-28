# 桌面终端模式验证记录 · 2026-10-28

实现：[PR #203](https://github.com/qianzhu18/workisland/pull/203)，基于多终端管理 [PR #201](https://github.com/qianzhu18/workisland/pull/201)。本轮是本地签名预览，等待用户验收后合并；未发布或替换正式安装。

## 自动与真实进程检查

- `npm run check`：737 项通过。控制器测试覆盖同一视图转移、PTY 不重启、过期和跨会话请求拒绝、关闭窗口收回、失败回退、代际更换、显示器边界约束、取消拖动及延迟焦点竞争。
- 源码 Electron 与最终 Developer ID 签名包均使用独立配置和合成终端任务运行 `scripts/smoke-terminal-docking.mjs`：双向指针拖动、20 次往返保持 PID/webContents/DOM/半行输入/滚动/选区、备用屏幕 TUI、三个桌面窗口独立输入和后台输出、实时语言切换、原生关闭收回、定向终止、退出重启及关闭功能清理通过。
- 分别观测了未访问终端、三个和八个已访问终端。视图懒创建，每个保留独立 renderer；八个任务并不等同于一个终端的内存成本。Electron working-set 进程数据包含共享页面，不作为独占内存总量承诺。
- 原有多终端管理与 Agent 提醒回归在打包版本顺序执行，检查多个 PTY、目录/输入隔离、后台输出、快捷命令、自然退出重启、收起恢复，以及正在查看终端时提醒不切页、不抢半行输入，仍可主动进入待处理事项。
- `codesign --verify --deep --strict` 通过；235 个打包 `src/` 文件逐一 SHA-256 对比与源码一致。Developer ID 已签名，本轮没有公证或制作公开更新包。

## 原生交互与问题修复

macOS 原生桌面窗口移动、桌面抓手拖回灵动岛已通过真实系统输入验证，任务 PID 不变。Island → desktop 通过 Chromium 指针事件和真实 Electron/PTY 验证。自动化工具对 Island NSPanel 的坐标输入返回 `noWindowsAvailable`，因此不将这一路径描述为完整原生系统输入验证。

开发期间修复了两个实际的状态保持问题：标题栏显隐的中间尺寸触发 xterm 重排，现按主进程提交的 viewport 才调整尺寸；父页面向内嵌视图切换焦点误取消拖动，现区分 DOM 焦点与真正原生窗口失焦，并在拖动期间阻止延迟布局抢焦点。异步 IPC 使用事件当时的屏幕坐标；指针释放由窗口捕获监听处理。自动化手势等待目标窗口焦点和桌面抓手就绪，避免在上一轮原生焦点切换尚未完成时发出下一轮合成输入。

## 用户验收和未覆盖设备项

请使用 WorkIsland 自建终端检查拖出、拖回、关闭窗口收回、多 Agent 输入和待处理提醒。普通 Terminal/iTerm2 会话仍由原应用持有，本期不接管任意外部 PTY。

真实硬件输入法组合输入、触控板手势、Spaces/全屏切换、跨屏拖动及物理拔除显示器仍需设备验收；单元测试中的屏幕移除/约束不替代真实外接屏验证。未更改正式应用及旧预览中已有的用户任务。

本地证据保存在 `.local-data/terminal-docking-packaged/`、`terminal-docking-packaged-*.log` 和 `terminal-docking-final-check.log`。CI 状态以 PR 最新提交的 GitHub Checks 为准。
