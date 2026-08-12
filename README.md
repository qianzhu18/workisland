# WorkIsland

WorkIsland 是一款面向 macOS 的本地桌面效率工具：在灵动岛区域展示 Coding Agent 会话状态，并在需要时提醒你回到正确的工作会话。

## 当前版本

最新公开版本：**v0.2.6**

v0.2.6 修复了失去焦点后仅缩成黑色胶囊、没有真正隐藏的问题：开启设置后，
整个 Island 会进入透明热区，鼠标移到顶部后恢复。并保留 v0.2.4/v0.2.5
带来的提醒声音、Warp 内 Claude Code 会话识别与 Codex Hook 启动入口修复。
更新后请退出旧版本并重新启动 WorkIsland；如 Agent Hook 未刷新，请在设置页重新安装一次对应 Hook。

- [下载 macOS Apple Silicon 安装包](https://github.com/qianzhu18/workisland/releases/latest)
- [查看所有 Releases](https://github.com/qianzhu18/workisland/releases)

安装包适用于 Apple Silicon Mac（M1 / M2 / M3 / M4）。下载 DMG 后，将 `WorkIsland.app` 拖入“应用程序”。

## 主要能力

- 展示 Coding Agent 的运行、等待、审批、完成和失败状态
- 从灵动岛快速回到对应的终端或工作会话
- 支持桌宠、声音提醒、快捷键和用量提示
- 本地运行，不要求配置云端账号，不上传会话内容

## 首次启动测试

当前公开安装包可能未配置 Apple Developer 签名。若 macOS 阻止打开，请先把应用复制到“应用程序”，再执行：

```bash
xattr -c "/Applications/WorkIsland.app"
```

如果仍然显示“无法验证开发者”，可以执行：

```bash
xattr -dr com.apple.quarantine "/Applications/WorkIsland.app"
```

如果 DMG 文件本身被隔离，也可以先执行：

```bash
xattr -c "/path/to/WorkIsland-0.2.6-arm64.dmg"
```

以上命令仅用于本机测试未签名安装包。正式签名和公证版本应优先按 macOS 系统提示打开。

## 校验下载文件

Release 同时提供 `SHA256SUMS.txt`。下载 DMG 后，可在终端运行：

```bash
shasum -a 256 WorkIsland-0.2.6-arm64.dmg
```

将结果与校验文件中的值进行比对。

## 隐私与产品边界

WorkIsland 以本地运行为核心，不建立云端账号体系，不上传 Agent 会话内容，也不包含远程开发机、遥测或自动更新服务。

## 关于本仓库

WorkIsland 是闭源产品。本仓库仅用于发布产品说明、下载入口和 Release 安装资产，不包含应用源码。
