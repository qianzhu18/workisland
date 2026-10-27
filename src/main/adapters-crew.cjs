"use strict";

// CrewAI（Crew CLI）适配器。
//
// Crew 的事件主通道是 crew-watcher.cjs（轮询 ~/.flux/hooks/crew/events.jsonl），
// 不走本地 hooks HTTP。本适配器保留一个最小的协议入口：如果集成模块未来支持
// 通过 hooks CLI 投递事件，handleHook 的 CrewKickoffStarted 分支可以接收；
// 当前它同时满足 agent-ecosystem 矩阵对「每个 Agent 处理自己的原生事件并 ACK」
// 的一致性要求。

const path = require("node:path");
const ACK = { type: "acknowledged" };

class CrewAdapter {
  agentId = "crew";

  handleHook(clientId, payload, ctx) {
    const eventName = payload?.hook_event_name;
    const now = Date.now();
    if (eventName === "CrewKickoffStarted") {
      const sessionId = payload.session_id;
      if (sessionId) {
        const cwd = typeof payload.cwd === "string" ? payload.cwd : "";
        const project = cwd ? path.basename(cwd) : "";
        ctx.emitEvent?.({
          type: "sessionStarted",
          sessionId,
          tool: this.agentId,
          timestamp: now,
          title: typeof payload.title === "string" && payload.title
            ? payload.title
            : project || "CrewAI run",
          projectPath: cwd
        });
        ctx.updateJumpTarget?.(sessionId, this.agentId);
      }
    }
    ctx.sendResponse?.(clientId, ACK);
  }

  isBlockingEvent() {
    return false;
  }
}

module.exports = { CrewAdapter };
