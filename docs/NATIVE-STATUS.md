# macOS 原生系统状态

展开灵动岛后，点击顶部工具栏的电池形状“系统状态”按钮，一次打开全部详情；再次点击返回 Agent 首页。入口可沿用工具栏拖动排序和更多菜单。Agent 首页没有额外的常驻状态行。

在“设置 → 通用 → 系统状态 → 详情”分别配置电池、网络、音频、屏幕捕获、下载和锁屏信息。锁屏展示默认关闭。

## 事件提示

电源插拔、音频输出或耳机连接变化、网络变更、下载开始/结束/取消、录屏或屏幕共享开始/结束会触发紧凑提示，约 5 秒收回。启动读取不触发变化提示。Agent 待审批、锁屏、全屏隐藏、桌面宠物模式和用户正在操作的面板优先；这些情况下仍更新检测状态，不抢占当前界面。

## 数据来源与限制

- 电池：IOPS 与 AppleSmartBattery。电池充电功率、整机 DC 输入和适配器协商容量分别显示；缺失读数为“—”。
- 音频：CoreAudio 默认输出、IOBluetooth 已连接音频设备；设备电量只展示 IORegistry 已提供的值。
- 网络：NWPathMonitor 与 CoreWLAN。连接表示系统网络路径可用，不能证明任意网站可达；网络名称受 macOS 隐私限制时显示连接类型。
- 下载：监听 Downloads 中浏览器临时文件，显示实测速率。无总大小时不显示百分比；取消与写入完成分开识别。启动遗留临时文件需要增长才激活。
- 屏幕捕获：可选私有 CGS 接口，无法保证精确区分录屏和第三方共享，不声称识别捕获所属应用。
- 锁屏：独立 AppKit 面板及可选 SkyLight 空间托管，仅传入媒体文字摘要与系统状态，不传入对话正文和文件路径。预览不等于真实锁定/解锁验收。

## 开发验证

```sh
npm run build:native
npm run check
node scripts/build-system-status.mjs --arch x64
node scripts/build-system-status.mjs --arch arm64
node scripts/dev.mjs --remote-debugging-port=9347
# 在另一个终端执行；--capture 会在本机无声录制 4 秒，完成后删除临时视频
node scripts/smoke-system-status.mjs --capture
```

Smoke 检查真实原生快照、顶部按钮、一次点击详情、真实录屏开始/结束提示及自动收回。截图和读取结果存放在被 Git 忽略的 `.local-data/native-status-evidence/`。

原生 helper 约 204 KB，随 macOS 包分发；NDJSON 消息有大小限制，崩溃时清除过期读数并退避重启。停止、禁用和重新启用均有生命周期检查。SkyLightWindow MIT 许可随应用分发。

## 尚需真实设备验收

实际耳机连接/切换、Wi-Fi 断开/恢复、多显示器与休眠恢复、真实锁定/解锁需要对应设备场景。原生预览、构建和单元测试分别记录，不能代替以上验收。当前本地预览包不代表公证或正式发布。
