# WorkIsland Product Roadmap

状态：`active`  
路线类型：阶段门控，不按日历承诺功能

## Shipped: v3.0.0 Public Stable

目标已完成：核心多 Agent 会话闭环、可审计的匿名统计、操作手册、更新检查和公开 macOS DMG 分发链路已经进入稳定版。

## Now: v3.1.0 Workstation Release

目标：把 main 最近合入的 Workstation 能力整理成一个可安装、可验证、可持续记录的 macOS 版本。

- 范围：PR #45/#47/#52/#51/#40 已进入 main，覆盖 Media、Performance、Shelf、Clipboard、Terminal、Codex 生命周期声音和 Echo 桌宠体验。
- Distribution：增加根目录 CHANGELOG.md 和官网 /changelog/，让功能变化可以被用户、贡献者和搜索引擎持续发现。
- 发布门：npm run check、release:check、本机 arm64 DMG 抽查、GitHub Actions 签名/公证、SHA-256 和官网链接全部通过后才创建稳定 Tag。
- 非范围：Windows Alpha、dock 附件和 token 统计不进入本版本；它们分别等待跨平台验证、冲突解决和原生检查恢复。

## Next: Agent Core Reliability

下一阶段只围绕“用户是否相信 Island 上的状态”推进：Approval 真伪、Session lifecycle、stale/duplicate、完成/失败/失联、跨 Agent 一致性，以及 Agent → Terminal/File/Git context 的回源准确性。

- 每个问题先绑定可复现事件和用户证据，再进入 Feature PRD 或修复版本。
- 优先修复会造成漏提醒、假状态、错误回源或重复打扰的 P0/P1。
- 暂不以“支持 Agent 数量”或通用 Widget 数量作为路线图 KPI。

## Later: Agent-aware Workbench

在 Agent Core 稳定后，把现有工具继续做成 Agent-aware，而不是继续堆通用 Notch 小组件：

- Agent Context Terminal：自动进入当前 Session 的 repo、cwd 和 branch，并提供安全的 diff、test 和 dev server 操作。
- Agent Artifact Shelf：识别 Agent 最近生成或修改的文件，标注来源 Session，支持 Preview、Reveal 和 Drag。
- Project/Git context：把 repo、branch、diff、dirty state 和最近 build/test 纳入 Agent Session 上下文。
- Clipboard → Agent：保留本地优先边界，支持将提示词或结果安全发送到当前 Agent。

## Distribution

每个版本维护根目录 CHANGELOG.md、官网更新日志、README、产品手册和 GitHub Release 的一致入口。稳定版发布后 24 小时和 7 天各做一次安装、激活、回源和阻断问题复盘，再决定下一版本是否扩大分发。

## Later: Compatibility and platform expansion

- 完成 Cursor、Trae、WorkBuddy、智谱和 Kimi 等适配能力分级。
- 提供一致的连接诊断和失败修复建议。
- 皮肤创作、移动端第二显示面和 Windows 仍按独立 PRD 排期，不与 macOS 稳定发布捆绑。

## 分支与 PR 计划

所有分支从最新 main 创建，每个分支只对应一个用户结果：

| 分支 / PR | 目标 | 当前决策 |
| --- | --- | --- |
| #51 | Codex 转录生命周期声音与去重 | 已合并并进入 v3.1.0 |
| #40 | Echo 桌宠导演层 | 已合并并进入 v3.1.0 |
| #36 | 可选 dock 附件 | 暂缓：与当前 main 冲突，且优先级低于核心 Agent 闭环 |
| #38 | Claude/Codex token 采集 | 暂缓：native-macos 检查失败，先修复验证链 |
| #42 | Windows desktop MVP | 暂缓：Draft + 冲突，保持独立 Alpha 版本线 |

皮肤商店服务端、Windows 客户端和支付能力不进入同一个 PR；先完成父 PRD 与 Issue 拆分，再按阶段门推进。
