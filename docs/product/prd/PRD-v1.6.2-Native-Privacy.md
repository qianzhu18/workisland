# Version PRD: v1.6.2 Native Privacy

Tracking Issue: [#198](https://github.com/qianzhu18/workisland/issues/198)

目标：正式签名版开启音频检测后，系统状态助手持续运行，Codex 固定额度与其他插件正常显示。

证据：本机正式 v1.6.1 的 TCC 崩溃报告明确指出缺失 NSBluetoothAlwaysUsageDescription；历史 afterPack 会删除该说明。直接运行助手与未签名预览不能复现负责应用的权限检查。

范围与任务：保留打包中的蓝牙用途说明；配对设备列表仅在已有授权时读取，CoreAudio 当前输出照常提供；以闭包调用计数验证拒绝、受限、未决定时不调用受保护接口；运行实际 afterPack 验证用途说明保留。发布工作流校验实际 Info.plist，并从签名 Electron 父进程运行原生状态冒烟测试。

验收：完整检查、Swift 权限分支回归与双架构编译；本机签名候选运行；正式 Actions 双架构签名、公证、Staple、Gatekeeper；v1.5.1 原始更新代码实际下载并校验 arm64 安装包；正式本机安装后固定 Codex、图标、用量收纳、六项开关和真实录屏检测通过。耳机实体切换、网络断开、多屏与锁屏仍有设备验证限制。

物料与数据：同步双语 Release Notes、CHANGELOG 和官网更新日志，手册操作不变；不新增遥测。维护者通过现有反馈与版本号在 24 小时、7 天复盘。失败则保留旧应用和用户数据备份，发布新修复版本，不覆盖现有 Tag。
