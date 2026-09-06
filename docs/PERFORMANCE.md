# WorkIsland 性能数据

本文沉淀 WorkIsland 的公开性能实测数据与测试方法。所有数据由仓库内脚本实测产出，可复现、可验证；不达标或存在口径限制时如实标注。

## 闲置实测（2026-09-06 · Apple M4）

### 结论速览

| 指标 | 实测值 | 口径 |
| --- | --- | --- |
| 闲置 CPU（中位） | **2.9%** ✅ | 全部 WorkIsland 进程逐轮合计，44 轮 × 2s，`top` 瞬时口径 |
| 闲置 CPU（P95） | 4.44% | 同上，含灵动岛偶发动画等瞬时活动 |
| 闲置 CPU（峰值） | 6.8% | 同上 |
| 内存（top 口径合计中位） | 535 MB | 与活动监视器「内存」列同源（物理占用） |
| 内存（`ps` RSS 口径合计） | 341 MB | 常驻集合计，不含压缩/换出部分 |

**判定（依据 issue #108 阈值：闲置 CPU < 3%）**：达标，但中位数贴线。中位 2.9% 与阈值 3% 之间余量很小，视为「达标 + 待优化」而非安全达标，优化路径见下文。

### 测试环境与方法

- 机型：Apple M4（Mac16,12），24 GB，macOS 15.6 (24G84)
- 被测版本：WorkIsland **v1.3.0**（生产签名版，`/Applications/WorkIsland.app`）
- 运行形态：外接 1920×1080 显示器（无刘海），灵动岛以悬浮窗形态运行、处于收起态；无进行中的会话
- 采样：`top -l 45 -s 2`，丢弃 macOS `top` 的第 1 轮（该轮为「自进程启动以来的平均值」，不代表瞬时值），有效 44 轮；`-n` 覆盖系统全部进程，避免 WorkIsland 子进程按 pid 排序被截断导致合计低估
- CPU 合计口径：逐轮将全部 WorkIsland 进程（主进程、Helper、Renderer、MCP 子进程，本机共 12 个）CPU 相加后取中位/P95；单进程动画尖峰不污染中位数
- 复现：

```bash
node scripts/perf-idle-benchmark.mjs --rounds 45 --interval 2 --json out.json
```

原始采样数据存档：[`docs/perf/2026-09-06-apple-m4.json`](perf/2026-09-06-apple-m4.json)。

### 进程级分解（44 轮中位数）

| 进程 | CPU | 内存（top 口径） | 说明 |
| --- | --- | --- | --- |
| 主进程 | 1.20% | 127 MB | Electron main |
| 灵动岛 Renderer | 1.15% | 125 MB | 悬浮窗渲染 |
| GPU 进程 | 0.40% | 74 MB | Electron GPU |
| 第二 Renderer | 0% | 64 MB | 辅助窗口常驻 |
| workisland-mcp × 4 | 0% | 各 32 MB（约 129 MB） | MCP 子进程，多个会话时按连接派生 |
| 其余 Helper | 0% | 16 MB | |
| **合计** | **≈2.9%** | **≈535 MB** | |

### 与竞品宣传值对比

| 产品 | 宣传数据 | 来源与口径说明 |
| --- | --- | --- |
| Vibe Island | RAM < 100 MB、非 Electron | 对方公开宣传页；非 Electron 架构，内存口径与 Electron 应用不直接可比 |
| CodeIsland | Idle CPU 10% → 1% | 对方 Release Notes；机型、采样方法未公开，未独立复测 |
| WorkIsland | 闲置 CPU 中位 2.9%（Apple M4，44 轮实测） | 本文，方法与原始数据公开 |

竞品数据引用自对方公开宣传与发布说明，未经独立复测，机型与方法学未知，仅供方向性参考。

## 优化项与路径

当前架构为 Electron（多进程模型），12 个常驻进程是内存合计的主要构成。按实测证据排序：

1. **workisland-mcp 子进程合并/懒加载**（内存收益约 100 MB）：4 个常驻子进程各 ~32 MB、CPU 均为 0。可改为按 MCP 连接需要时拉起，或单进程复用多连接。
2. **第二 Renderer 按需创建**（内存收益约 64 MB）：辅助窗口当前常驻 64 MB，可延后到首次使用时创建。
3. **main + Renderer 稳态底噪 ~2.4%**（CPU 余量）：中位 2.9% 贴线的主要构成。路径：周期任务定时器聚合（usage 扫描、转录监听、会话计时器统一到同一 tick 并在空闲期降频）、校验 Renderer `backgroundThrottling` 行为、避免高分辨率空闲动画。
4. V8 快照等启动期优化对冷启动有益，但不降低稳态底噪，不在本轮范围。

## 待补机型

issue #108 要求至少两台 M 系列不同代次的机型数据。当前完成 Apple M4 一台；脚本可直接复现，欢迎用另一台 Mac 跑一遍并回贴到 [issue #108](https://github.com/qianzhu18/workisland/issues/108)。
