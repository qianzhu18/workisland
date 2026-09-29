# 跨 Agent 交接（Cross-Agent Handoff）

WorkIsland 的「无感」跨 Agent 任务交接：一个 Agent 的会话完成或失败后，一键把任务材料交给
另一个 Agent 接着干——不用重新解释背景，不用手动翻会话目录。首个闭环是 **ZCode ↔ Codex**
（issue [#126](https://github.com/qianzhu18/workisland/issues/126) / [#129](https://github.com/qianzhu18/workisland/issues/129)）。

## 用户视角

会话完成卡上点「交接」：

1. WorkIsland **当场组装交接包**（对话尾部 + Git 证据），弹出预览：任务目标、Git 状态、
   可选目标 Agent 及各自能达到的交付级别；
2. 点「交给 Codex / ZCode」——这一次点击即授权交付；
3. 接收方启动后先读交接包，用不超过 3 行复述「任务目标 / 当前 Git 位置 / 下一步」，等确认
   后再动文件；
4. 岛上源会话卡显示「已交接 → Codex」，接手的新会话上岛后显示「接手自 ZCode」。

## 交付级别（诚实原则）

| 级别 | 方向 | 行为 |
| --- | --- | --- |
| 自动注入（inject） | 任意 → Codex | 新开 Terminal.app / iTerm2 窗口，在项目目录执行 `codex "$(cat prompt.txt)"`，初始指令已提交。只在 WorkIsland 自己新建的窗口里注入，绝不向未知 pane 发送文本 |
| 复制+打开（copy-open） | 任意 → ZCode；codex CLI 缺失时降级 | 接手指令写入剪贴板 + `zcode://workspace/open?path=` 深链打开工作区（降级时开终端到项目目录），用户粘贴发送 |

没有读取回执的能力就显示为「需要粘贴」，不伪造「已接手」状态。

## 交接包

点击时惰性构建（无后台预生成，闲置零成本），落在 `~/.flux/handoff/<handoffId>/`：

- `HANDOFF.md`——任务目标（标题或首条用户提问）、最近状态（最后用户提问 + 最后 Agent 回复）、
  对话尾部（时间正序，user/assistant 混排）、**生成时实拍的 Git 证据**（分支 / commit /
  未提交改动前列）、来源引用（工具 / 会话 id / transcript 路径）；
- `prompt.txt`——接手初始指令（指向 HANDOFF.md + 复述要求 + 暂停等确认，中英跟随应用语言）；
- `launch.sh`——Level A 启动器（`cd <项目目录> && exec codex "$(cat prompt.txt)"`）；
- `~/.flux/handoff/log.json`——交接回执（上限 100 条）。

### 数据来源（全部本机只读）

| 工具 | 对话尾部来源 |
| --- | --- |
| Claude Code | `transcript_path` 指向的 jsonl（首尾 64KB/256KB 窗口读，取 user/assistant 文本） |
| Codex | rollout jsonl（`event_msg·user_message` / `agent_message`，`response_item` 兜底） |
| ZCode | `~/.zcode/cli/db/db.sqlite`：用户提问在 `message.data.metadata.inputIntent.text`，Agent 正文在 `part` 表 `type:"text"` 分片 |

transcript 不可用时降级为仅会话状态字段 + Git 证据，并在预览中明示。

## 去重与接手链接

- **去重**：同一会话 + 同一目标，且源会话在上次交接后没有新的完成事件 → 拒绝重复交付
  （预览里可显式「仍要重新交付」）；
- **接手链接**：交付后 30 分钟内，目标工具在同目录启动的新会话（创建时间晚于交付时间）
  自动标记「接手自 X」，源会话标记「已交接 → Y」。

## 隐私

交接包只保存在本机（`~/.flux/handoff`），不默认保存密钥 / token / 未过滤的工具输出，
不上传。深链只携带项目路径（与既有搜索跳转同口径）。删除 `~/.flux/handoff` 目录即清除
全部交接记录。

## 后续方向

- Claude Code TUI 作为交接目标（claude CLI 同样支持位置参数，机制就绪，issue #131）；
- 搜索结果卡上的交接入口、交接包智能摘要（done/todo 抽取）→ #140 上下文库；
- Warp 终端协议支持。
