# CrewAI（Crew CLI）接入 WorkIsland

让 CrewAI 的 crew 任务出现在 WorkIsland 灵动岛：任务开始、每个任务完成、整场完成
都会弹出任务卡，点击卡片可回源到终端环境。

## 接入原理（重要，先读）

CrewAI **没有**类似 Claude Code `hooks.json` 那种"外部程序零配置读取"的本地事件协议：

| 通道 | 是否存在 | 说明 |
| --- | --- | --- |
| 本地 hooks 事件文件 | ❌ | 无官方协议 |
| 代码级回调（task/step/before/after kickoff） | ✅ | 开源版免费，跑在你的 crew 进程内，这就是本集成的接入点 |
| Webhooks（`crewWebhookUrl` 等） | ⚠️ | 企业版 CrewAI AMP 云端功能，不适用本地桌面应用 |
| CLI（`crewai traces`、`CREWAI_TRACING_ENABLED`） | ⚠️ | 有 trace 与配置，但没有实时会话清单/事件文件暴露给外部 |

因此 WorkIsland 采用**事件文件观测**：你在自己的 crew 代码里接入本仓库的
`integrations/crewai/workisland_crew.py`（纯标准库、零依赖），它会把任务事件
append 到 `~/.flux/hooks/crew/events.jsonl`；WorkIsland 增量读取该文件，无需
轮询你的终端、不读取任何 LLM 输出或任务正文（observe-only）。

> 无论你的 crew 是从 IDE（如 VS Code / Cursor 内嵌终端）运行，还是用
> `crewai run` 在终端运行，只要 crew 代码里接了本模块，事件都会上报——
> 对运行形态透明。

## 使用步骤

### 1. 把模块放进你的 crew 项目

把 `workisland_crew.py` 复制到你的 crew 项目目录（或 `PYTHONPATH` 可达的位置）。

### 2. 接入你的 crew 代码

**方式 A（推荐，最简单）——包装 `kickoff`：**

```python
from workisland_crew import WorkIsland

wi = WorkIsland(crew_name="我的研究 crew")   # 可省略，默认取当前目录名

result = wi.kickoff(crew, inputs={"topic": "..."})
print(result)
```

`wi.kickoff` 内部会尽力注入 task/step 回调（任务级粒度），并在 kickoff 返回后
自动写整场完成；若 crew 抛异常，会标记 failed 后原样抛出。

**方式 B（显式回调）——把回调挂到 `Crew` 构造参数：**

```python
from workisland_crew import WorkIsland

wi = WorkIsland(crew_name="我的研究 crew")
crew = Crew(
    agents=agents,
    tasks=tasks,
    process=Process.sequential,
    task_callback=wi.hook_task,          # 每个任务完成
    step_callback=wi.hook_step,          # 每一步结束
    before_kickoff_callback=wi.hook_before_kickoff,
    after_kickoff_callback=wi.hook_after_kickoff,
)
result = crew.kickoff(inputs={...})
```

**方式 C（`watch` 便捷入口 + 手动收尾）：**

```python
from workisland_crew import watch

wi = watch(crew, crew_name="我的研究 crew")
result = crew.kickoff(inputs={...})
wi.finish()          # kickoff 返回后手动标记整场完成
```

> 三种方式可组合；事件写入永远静默失败，绝不会影响你的 crew 运行。

### 3. 在 WorkIsland 中连接

1. 打开 WorkIsland → 设置 → Agent 列表 → **CrewAI（Crew CLI）**。
2. 点击「连接」：WorkIsland 会创建事件目录 `~/.flux/hooks/crew/` 并记录安装状态。
3. 回到你的 crew 项目运行一次任务：灵动岛即出现 CrewAI 任务卡，任务逐个完成
   时卡片更新，整场结束显示完成/失败状态；点击卡片回源到终端。

> 提示：如果你的 crew 是 `crewai create` 脚手架生成的项目，把上面的调用写进
> `src/<your_crew>/main.py` 的 `run()` 即可，IDE 内嵌终端与 `crewai run` 都生效。

## 事件协议（v1）

`~/.flux/hooks/crew/events.jsonl`，每行一个 JSON 对象，字段如下：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string | `sessionStarted` / `taskCompleted` / `sessionCompleted` |
| `sessionId` | string | 本次运行唯一 ID（每次 kickoff 一个新 ID） |
| `crewName` | string | crew 名称 |
| `cwd` | string | 项目路径（WorkIsland 用它做回跳与标题） |
| `timestamp` | number | 毫秒时间戳 |
| `taskName` | string | 任务名（taskCompleted 时携带） |
| `failed` | bool | 整场是否失败（sessionCompleted 时携带） |

环境变量 `WORKISLAND_CREW_EVENTS` 可覆盖事件文件路径（默认为
`~/.flux/hooks/crew/events.jsonl`）。

## 局限（v1，如实说明）

- 需要用户显式接入（代码级方案），不是零配置。
- 任务级事件依赖 CrewAI 的 `task_callback` 回调；并行/内部重试场景下任务计数
  可能与 UI 感知有细微出入，整场完成以 `kickoff` 返回为权威。
- 只观测事件文件；若事件文件在 WorkIsland 启动前已有历史内容，历史不会重放
  （从 WorkIsland 运行期间新写入的事件开始播报）。
- 不支持审批/提问（CrewAI 无对应本地通道），完成检测为推断式。
