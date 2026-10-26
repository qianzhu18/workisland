# Atoll 原生状态能力迁移评估

日期：2026-10-26。状态：用户已确认实施；已完成原生检测、工具栏详情和状态提示，验证结果另见实施记录。

## 已核实来源

- Atoll 本地源码：`/Users/baojian/Desktop/Atoll`，当前提交 `e1eae8b`。
- origin：`https://github.com/swording-k/Atoll.git`。
- upstream：`https://github.com/Ebullioscopic/Atoll.git`。
- WorkIsland：`/Users/baojian/Desktop/workisland`，当前提交 `0c54f6b`。
- Atoll 标注 GPL-3.0-or-later；WorkIsland 当前声明 Apache-2.0。实施时记录代码来源和依赖许可，不直接将 Atoll 源文件改头后归入 Apache 声明。

## 能力与真实边界

| 能力 | Atoll 源码（相对 DynamicIsland） | 已确认机制与边界 |
| --- | --- | --- |
| 下载 | `managers/DownloadManager.swift` | 下载目录变更通知，识别 `.crdownload`、`.download`、`.opdownload`、`.part`，活动期间采样大小计算速度。需要区分取消、完成及启动前残留文件。不是所有应用的统一下载接口；无总大小时不能编造百分比。 |
| 耳机与设备连接 | `managers/BluetoothAudioManager.swift`、`managers/AudioRouteManager.swift` | 蓝牙连接通知、已连接设备与音频路由读取；连接成功与成为当前输出设备是不同状态。耳机电量按设备可读能力显示。 |
| 网络连接 | `managers/NetworkConnectivityManager.swift` | `NWPathMonitor` 监听路径，CoreWLAN 补充 Wi-Fi 信息。路径可用不代表任意互联网服务可达；热点图标来自路径属性推断。SSID 不可用时仍显示连接类型。 |
| 录屏与共享 | `managers/ScreenRecordingManager.swift` | 私有 `CGSIsScreenWatcherPresent` 和 `CGSRegisterNotifyProc`（1502/1503）。捕获信号不保证精确区分第三方录制与共享，需保留未知状态。私有符号缺失时单独降级。 |
| 电池与瓦数 | `managers/MacBatteryManager.swift`、`managers/BatteryPowerReading.swift`、`models/BatteryStatusViewModel.swift` | IOPS 读电源状态；IORegistry `AppleSmartBattery` 补充遥测。当前实现的电池充电功率为正向有效 `Voltage × Amperage / 1,000,000`，整机 DC 输入为 `PowerTelemetryData.SystemPowerIn / 1,000`。二者均不等于充电器额定功率；不取电流绝对值冒充充电功率；缺值保留未知。 |
| 锁屏信息 | `managers/LockScreenManager.swift`、`managers/LockScreenPanelManager.swift`、`managers/LockScreenLiveActivityWindowManager.swift` | 系统锁定/解锁通知，原生窗口 shielding 层级，配合 `SkyLightWindow` 的 `delegateWindow`。单纯提高 Electron 窗口层级不能作为已实现证明。还需验证解锁、休眠恢复和多屏切换。 |

## 推荐方案

推荐“复用 WorkIsland 架构，移植原生检测机制”。继续以现有 Electron 岛为主界面，增加独立原生状态服务，将类型明确的快照和变化事件通过现有主进程、IPC、渲染层传递；锁屏使用独立原生面板。评估将检测直接扩展到现有 Objective-C++ 模块，或由轻量 Swift helper 承接 Swift/原生窗口依赖，以实际编译与锁屏原型结果选择边界。

相比整体嵌入 Atoll，这条路线避免引入重复的媒体、设置和主窗口体系；相比只在网页层模仿提示，它能保留真实系统事件、音频路由和锁屏能力。

### 展示与调度

- 电源插拔、耳机接入、输出切换、网络变更显示短暂状态提示。
- 下载与录屏/共享作为持续活动，结束后准确撤回。
- 电池详情显示电量、充电状态、可读的实时功率，并区分数据含义。
- Agent 待处理和审批继续保持优先级，系统提示不能覆盖待操作内容。
- 锁屏首批覆盖电池、网络、媒体和活动摘要；沿用现有媒体服务，不在锁屏默认暴露对话正文、命令或下载完整路径。
- 各检测项和锁屏展示独立开关；不支持的能力返回 unavailable，而非 false。
- macOS 为本次迁移目标；现有 Windows 核心功能保持可运行，不伪装支持 macOS 专属信号。

### 生命周期与性能

系统通知优先；只在下载活动或电源详情确有需要时采样。合并重复事件并取消过期任务，停止服务时移除监听与定时器，防止休眠恢复后重复订阅。对私有接口动态检查并提供局部失败隔离。

### 实施顺序与完成判据

1. 建立原生状态服务和数据合同，完成电池/功率、网络、音频连接与路由。
2. 加入下载识别与录屏/共享事件，完成岛内展示、设置和调度。
3. 验证原生锁屏窗口及其依赖，再接入信息面板与恢复生命周期。
4. 为功率缺值/符号、下载取消/完成、重复事件和能力缺失增加必要回归；执行项目检查和原生构建。
5. 真实验证插拔电源、耳机连接与路由切换、网络变化、浏览器下载完成/取消、录屏开始/结束、锁屏/解锁及多屏。需要物理设备或用户解锁的步骤单列为未完成门槛，自动测试不能替代。

在独立工作区实施，保留当前未跟踪文件。源码、构建、真实系统事件验证和安装到日常应用分别记录；构建与事件验证以实施记录中的实际结果为准。
