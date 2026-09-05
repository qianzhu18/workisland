"use strict";

/**
 * B-2 Quiet Hours（切片，对标 Vibe Island Quiet 场景 / ping-island 聚焦抑制）。
 *
 * 本切片覆盖「场景级」抑制：勿扰时间段 + 锁屏静音。会话/tab 级聚焦检测
 * （聚焦正在输出的那个会话时不提醒）依赖终端焦点信号，另行交付。
 *
 * 抑制范围 = 本地提示音。Bark 手机推送不受影响——安静时段用户不在电脑前，
 * 推送正是此时的通知出口。岛的行为不变。
 */

function parseClockToMinutes(value) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function isWithinQuietHours(quietHours, now = new Date()) {
  if (!quietHours?.enabled) return false;
  const start = parseClockToMinutes(quietHours.start);
  const end = parseClockToMinutes(quietHours.end);
  if (start === null || end === null || start === end) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  // 支持跨午夜窗口（如 22:00 → 08:00）。
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function shouldSuppressLocalAlert(settings, { locked = false, now = new Date() } = {}) {
  const quietHours = settings?.quietHours;
  if (!quietHours) return false;
  if (isWithinQuietHours(quietHours, now)) return true;
  if (quietHours.suppressOnLockScreen && locked) return true;
  return false;
}

module.exports = { parseClockToMinutes, isWithinQuietHours, shouldSuppressLocalAlert };
