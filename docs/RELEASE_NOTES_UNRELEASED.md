# WorkIsland v1.6.1

会话搜索与回源更顺手，Agent 接入更省心，系统状态融入灵动岛。本版包含 v1.5.1 之后已经合并的功能与修复。

## 更新校验修复

- 校验文件改用纯安装包文件名，让旧版客户端可以正确匹配并校验新包。
- 新版客户端兼容历史校验文件中的 `release/` 前缀；校验文件缺失、无法读取或找不到对应条目时停止安装，不再跳过校验。
- 本版包含以下 v1.6.0 功能与修复。

## 新功能

- **会话搜索与回源**：搜索历史会话，点击结果优先回到仍在运行的原会话；ZCode 可打开会话所在工作区，千问办公、DuMate 等回到对应客户端。搜索跳转沿用日常会话卡的回源路径。
- **DeepSeek Harness 自动接入**：检测已初始化的 DSH profile 后自动配置，无需手动点连接；后台巡检补齐升级或重置后丢失的配置，兼容 DSH 0.2.1，连接状态区分“已写入配置”和真实事件确认。
- **macOS 系统状态**：顶部工具栏的电池按钮一次查看电池与充电功率、音频输出/耳机、网络、下载、屏幕捕获；电源、连接、下载、录屏等变化可显示短暂提示。各项可在设置中单独关闭，锁屏信息默认关闭。

## 改进与修复

- Codex 订阅额度保留左侧固定的周期、已用百分比与重置倒计时；图标随安装包提供。用量看板独立可收纳，新安装默认放入“更多”。

- 系统提示和收起图标避开 MacBook 摄像头区域；修复进出动画跳动与内容闪回，Agent 待处理和用户正在操作的面板优先。
- 会话索引与用量解析改为流式处理，合并重复扫描并串行处理启动回填，降低大历史记录下的内存峰值。
- 修复搜索结果渲染导致岛窗口退出的问题；减少隐藏状态下的性能采样并精简安装包资源。
- 改善自定义背景设置，修复“主屏”选择随设置窗口焦点漂移的问题。

## 更新方式与已知范围

应用会自动检查稳定版并提醒；点击顶部更新入口或“设置 → 关于 → 更新”后才下载安装，校验 SHA-256 后安装并重启。也可下载与芯片匹配的官方 DMG 手动安装。

下载识别基于浏览器临时文件；网络连接不代表任意网站可达。设备电量与瓦数仅在系统提供时显示。屏幕捕获提示不识别所属应用；锁屏展示使用可选系统接口，默认关闭。真实耳机切换、Wi-Fi 断开恢复、多屏休眠及真实锁定/解锁仍需更多设备反馈。布局用例与原生预览不能替代这些场景的真机验收。

ZCode ↔ Codex 双向交接仍在开发，不包含在本版。

### English Summary

v1.6.1 fixes installer integrity checks: published checksum manifests use bare filenames for older clients, legacy release-directory entries remain readable, and missing/unreadable/unmatched checksums stop installation. It includes v1.6.0 features: session search with live-session-first navigation, automatic DeepSeek Harness setup and repair (including DSH 0.2.1), and native macOS battery/power, audio, network, download and screen-capture status in the Island toolbar. Camera-safe transient notices respect agent attention and active panels. Streaming transcript processing, coalesced scans and serialized startup backfill reduce memory spikes; search rendering, display selection and custom backgrounds are improved. Codex quota retains its fixed left period/usage/reset display; the separate usage dashboard can be stored in More (the default on new installs). Updates are checked automatically but download/install require a click. Lock-screen information is off by default; hardware-specific audio/network/sleep/lock scenarios still need broader device validation. The unmerged ZCode–Codex handoff is excluded.
