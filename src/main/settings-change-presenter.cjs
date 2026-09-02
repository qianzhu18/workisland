"use strict";

const DEFAULT_GROUP_DELAY_MS = 1_000;
const DEFAULT_EXPIRY_MS = 5_000;
const ATTENTION_RETRY_MS = 250;

class SettingsChangePresenter {
  constructor(options) {
    if (!options?.hasAttention || !options?.present) {
      throw new TypeError("SettingsChangePresenter requires attention and presentation callbacks");
    }
    this.hasAttention = options.hasAttention;
    this.present = options.present;
    this.now = options.now || Date.now;
    this.setTimer = options.setTimer || setTimeout;
    this.clearTimer = options.clearTimer || clearTimeout;
    this.groupDelayMs = options.groupDelayMs ?? DEFAULT_GROUP_DELAY_MS;
    this.expiryMs = options.expiryMs ?? DEFAULT_EXPIRY_MS;
    this.pending = null;
    this.timer = null;
  }

  enqueue(notice) {
    const safeNotice = {
      changeId: String(notice?.changeId || ""),
      client: String(notice?.client || "Local agent").slice(0, 80),
      changes: Array.isArray(notice?.changes) ? notice.changes.slice(0, 20) : []
    };
    if (!safeNotice.changeId) return;

    if (this.pending && this.pending.client === safeNotice.client) {
      this.pending.changeIds.push(safeNotice.changeId);
      this.pending.changes.push(...safeNotice.changes);
    } else {
      this.flushPending();
      this.pending = {
        client: safeNotice.client,
        changeIds: [safeNotice.changeId],
        changes: [...safeNotice.changes],
        createdAt: this.now()
      };
    }
    this.schedule(this.groupDelayMs);
  }

  schedule(delay) {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.tryPresent();
    }, delay);
  }

  tryPresent() {
    if (!this.pending) return;
    if (this.now() - this.pending.createdAt >= this.expiryMs) {
      this.pending = null;
      return;
    }
    if (this.hasAttention()) {
      this.schedule(ATTENTION_RETRY_MS);
      return;
    }
    const pending = this.pending;
    this.pending = null;
    this.present({
      type: "settingsChange",
      client: pending.client,
      changeIds: pending.changeIds,
      changes: pending.changes,
      autoDismissMs: DEFAULT_EXPIRY_MS
    });
  }

  flushPending() {
    if (!this.pending) return;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.tryPresent();
  }

  dispose() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.pending = null;
  }
}

module.exports = { SettingsChangePresenter };
