# -*- coding: utf-8 -*-
"""WorkIsland x CrewAI 集成模块。

把 CrewAI（Crew CLI）任务的开始 / 任务完成 / 整场完成事件写入 WorkIsland
本地事件文件，WorkIsland 增量读取后会在灵动岛显示任务卡、完成状态并支持回跳。

设计原则
--------
- 纯标准库、零依赖：不需要 import crewai 也能 import 本模块，事件写入失败
  绝不打断你的 crew（静默降级）。
- observe-only：只写事件字段（crew 名、任务名、cwd、失败标记），不写任何
  LLM 输出或任务正文。

用法 A（最简单，推荐）——包装 kickoff：
    from workisland_crew import WorkIsland
    wi = WorkIsland(crew_name="我的研究 crew")
    result = wi.kickoff(crew, inputs={"topic": "..."})

用法 B（任务级粒度）——把回调挂到 Crew 构造参数：
    from workisland_crew import WorkIsland
    wi = WorkIsland(crew_name="我的研究 crew")
    crew = Crew(agents=..., tasks=...,
                task_callback=wi.hook_task, step_callback=wi.hook_step)
    result = crew.kickoff(inputs={...})

两种可组合。事件文件默认
    ~/.flux/hooks/crew/events.jsonl
可用环境变量 WORKISLAND_CREW_EVENTS 覆盖（如指向自定义路径）。

局限（v1）
----------
- CrewAI 没有本地 hooks 事件协议；本模块是「代码级回调」方案，需要用户在自己
  crew 代码里显式接入（对比 Claude Code hooks.json 的零配置方案）。
- 任务级事件依赖 CrewAI 的 task_callback 回调；部分内部重试/并行场景下任务数
  可能与 UI 感知有细微出入，整场完成以 kickoff 返回为权威。
"""

from __future__ import annotations

import json
import os
import pathlib
import time
import uuid
from typing import Any, Optional


def _default_events_file() -> pathlib.Path:
    override = os.environ.get("WORKISLAND_CREW_EVENTS")
    if override:
        return pathlib.Path(override)
    return pathlib.Path.home() / ".flux" / "hooks" / "crew" / "events.jsonl"


class WorkIsland:
    """向 WorkIsland 本地事件文件上报 crew 运行事件。"""

    def __init__(
        self,
        crew_name: Optional[str] = None,
        cwd: Optional[str] = None,
        events_file: Optional[pathlib.Path] = None,
    ) -> None:
        self.session_id = uuid.uuid4().hex[:12]
        self.crew_name = crew_name or "crew"
        self.cwd = cwd or os.getcwd()
        self.events_file = pathlib.Path(events_file or _default_events_file())
        self._started = False
        self._completed = False

    # -- 内部工具 -----------------------------------------------------------

    def _write(self, event_type: str, **extra: Any) -> None:
        """append 一行事件；任何失败都不影响 crew 运行。"""
        try:
            self.events_file.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "type": event_type,
                "sessionId": self.session_id,
                "crewName": self.crew_name,
                "cwd": self.cwd,
                "timestamp": int(time.time() * 1000),
                **extra,
            }
            with self.events_file.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(payload, ensure_ascii=False) + "\n")
        except Exception:  # noqa: BLE001 - 观测通道必须静默
            pass

    def _ensure_started(self, task_name: str = "") -> None:
        if not self._started:
            self._started = True
            self._write("sessionStarted", taskName=task_name)

    # -- CrewAI 回调入口（可传给 Crew 构造参数） ------------------------------

    def hook_task(self, task: Any, output: Any) -> None:
        """task_callback(task, output)：每个任务完成时调用。"""
        self._ensure_started(_task_name(task))
        name = _task_name(task)
        self._write("taskCompleted", taskName=name)

    def hook_step(self, agent: Any, task: Any, output: Any) -> None:
        """step_callback(agent, task, output)：每一步结束时调用。"""
        self._ensure_started(_task_name(task))

    def hook_before_kickoff(self, crew: Any) -> None:
        """before_kickoff_callback(crew)：kickoff 开始前调用。"""
        self._ensure_started()

    def hook_after_kickoff(self, crew: Any, output: Any) -> None:
        """after_kickoff_callback(crew, output)：kickoff 正常返回后调用。"""
        self._finish(failed=False)

    # -- 包装入口 -----------------------------------------------------------

    def kickoff(self, crew: Any, **kwargs: Any) -> Any:
        """包装 crew.kickoff：前后记录事件，失败标记 failed 并原样抛出。

        同时尽力注入 task/step 回调以获得任务级粒度（属性注入对 CrewAI 的
        Crew 实例通常有效；注入失败不影响整体流程）。
        """
        self._try_inject_callbacks(crew)
        self._ensure_started()
        try:
            result = crew.kickoff(**kwargs)
        except Exception:
            self._finish(failed=True)
            raise
        self._finish(failed=False)
        return result

    def finish(self, failed: bool = False) -> None:
        """手动收尾（可选）：在非包装调用场景下显式标记整场完成。"""
        self._finish(failed=failed)

    # -- 内部 ---------------------------------------------------------------

    def _try_inject_callbacks(self, crew: Any) -> None:
        try:
            if getattr(crew, "task_callback", None) is None:
                crew.task_callback = self.hook_task
            if getattr(crew, "step_callback", None) is None:
                crew.step_callback = self.hook_step
        except Exception:  # noqa: BLE001
            pass

    def _finish(self, failed: bool) -> None:
        if self._completed:
            return
        self._completed = True
        self._write("sessionCompleted", failed=failed)


def _task_name(task: Any) -> str:
    """从 Task 对象取名字；拿不到就用描述前缀，保证字段非空。"""
    try:
        name = getattr(task, "name", None)
        if name:
            return str(name)
    except Exception:  # noqa: BLE001
        pass
    try:
        desc = str(getattr(task, "description", "") or "")
        return desc[:80] or "task"
    except Exception:  # noqa: BLE001
        return "task"


def watch(crew: Any, **wi_kwargs: Any) -> WorkIsland:
    """便捷入口：注入回调并返回 recorder（与 kickoff 包装二选一）。

    用法：
        from workisland_crew import watch
        wi = watch(crew, crew_name="我的研究 crew")
        result = crew.kickoff(inputs={...})
        wi.finish()   # kickoff 返回后手动收尾

    若 crew 内部会调用 task_callback，则任务级事件也会出现。
    """
    recorder = WorkIsland(**wi_kwargs)
    recorder._try_inject_callbacks(crew)
    return recorder


# 兼容别名：WorkIslandCrew 与 WorkIsland 等价。
WorkIslandCrew = WorkIsland

__all__ = ["WorkIsland", "WorkIslandCrew", "watch"]
