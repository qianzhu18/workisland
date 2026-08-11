"use strict";

/**
 * Agent 事件去重器（hook 通道与 transcript 通道去重）。
 *
 * 背景：orca 现在有两条事件通道——
 *   1. hook 通道：agent 通过 hooks-cli 写 socket → adapter → emitEvent
 *   2. transcript 通道：codex-transcript-watcher / claude-transcript-watcher
 *      主动 tail 文件 → emitEvent
 *
 * 同一个 session 的同一个 turn 完成事件，可能被两条通道同时报告。
 * 本去重器在 AppCoordinator 收到 agentEvent 时做一次"5 秒窗口内同 key 去重"，
 * 让两条通道都跑，但同一逻辑事件只放行第一个，后续的判为 duplicate 丢弃。
 *
 * 设计来源：参考 stow 的 hook-ingress-ring-buffer.ts，clean-room 复刻为纯 JS。
 * orca 事件格式与 stow 不同（无 payload.toolInput），dedup key 改用
 * `${type}:${sessionId}:${turnId ?? ''}`，对 completion/interrupt 这类关键事件
 * 额外纳入 isInterrupt 以区分"成功完成"与"中断完成"。
 */

const DEDUP_WINDOW_MS = 5000;
const CAPACITY = 1024;

/**
 * 计算事件的去重 key。
 * 同 session 同 turnId 的同类型事件视为重复。
 * 对 sessionCompleted，进一步区分 isInterrupt（成功完成 vs 中断）。
 */
function eventDedupKey(event) {
  const type = event.type || "";
  const sessionId = event.sessionId || "";
  const turnId = event.turnId || "";
  if (type === "sessionCompleted") {
    // 区分成功完成与中断：两者不应互相去重
    const variant = event.isInterrupt ? "interrupt" : "complete";
    return `${type}:${sessionId}:${turnId}:${variant}`;
  }
  return `${type}:${sessionId}:${turnId}`;
}

class AgentEventDedup {
  constructor(options = {}) {
    this.capacity = Math.max(1, options.capacity || CAPACITY);
    this.dedupWindowMs = Math.max(0, options.dedupWindowMs || DEDUP_WINDOW_MS);
    this.now = options.now || Date.now;
    /** @type {Map<string, number>} key → 入队时间戳 */
    this.seen = new Map();
    this.deduplicated = 0;
  }

  /**
   * 尝试入队一个事件。
   * 返回 'enqueued' 表示放行，'duplicate' 表示在窗口内重复（应丢弃）。
   * @param {object} event
   * @returns {{ status: "enqueued" | "duplicate", key: string }}
   */
  enqueue(event) {
    const key = eventDedupKey(event);
    this.prune();
    const seenAt = this.seen.get(key);
    if (seenAt !== undefined && this.now() - seenAt < this.dedupWindowMs) {
      this.deduplicated += 1;
      return { status: "duplicate", key };
    }
    this.seen.set(key, this.now());
    // seen 容量保护：超限时清掉最旧的三分之一（简单策略，避免无限增长）
    if (this.seen.size > this.capacity) {
      const entries = Array.from(this.seen.entries()).sort((a, b) => a[1] - b[1]);
      const removeCount = Math.floor(entries.length / 3);
      for (let i = 0; i < removeCount; i++) {
        this.seen.delete(entries[i][0]);
      }
    }
    return { status: "enqueued", key };
  }

  prune() {
    const threshold = this.now() - this.dedupWindowMs;
    for (const [key, at] of this.seen) {
      if (at < threshold) this.seen.delete(key);
    }
  }

  clear() {
    this.seen.clear();
    this.deduplicated = 0;
  }

  stats() {
    return {
      capacity: this.capacity,
      seenKeys: this.seen.size,
      deduplicated: this.deduplicated
    };
  }
}

module.exports = { AgentEventDedup, eventDedupKey };
