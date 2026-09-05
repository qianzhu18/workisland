import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { isWithinQuietHours, shouldSuppressLocalAlert } = require("../src/main/quiet-hours.cjs");

const at = (hours, minutes) => new Date(2026, 8, 3, hours, minutes);

test("overnight quiet window covers late night and early morning", () => {
  const quiet = { enabled: true, start: "22:00", end: "08:00" };
  assert.equal(isWithinQuietHours(quiet, at(23, 30)), true);
  assert.equal(isWithinQuietHours(quiet, at(2, 0)), true);
  assert.equal(isWithinQuietHours(quiet, at(8, 0)), false, "end is exclusive");
  assert.equal(isWithinQuietHours(quiet, at(20, 0)), false);
});

test("same-day quiet window and edge cases", () => {
  const quiet = { enabled: true, start: "09:00", end: "12:00" };
  assert.equal(isWithinQuietHours(quiet, at(10, 0)), true);
  assert.equal(isWithinQuietHours(quiet, at(13, 0)), false);
  assert.equal(isWithinQuietHours({ enabled: true, start: "10:00", end: "10:00" }, at(10, 0)), false, "empty window never suppresses");
  assert.equal(isWithinQuietHours({ enabled: false, start: "22:00", end: "08:00" }, at(23, 0)), false);
  assert.equal(isWithinQuietHours({ enabled: true, start: "25:00", end: "08:00" }, at(23, 0)), false, "invalid clock never suppresses");
});

test("shouldSuppressLocalAlert respects quiet window and lock screen independently", () => {
  const windowOn = { quietHours: { enabled: true, start: "22:00", end: "08:00", suppressOnLockScreen: false } };
  // 注入固定时刻：23:30 在窗口内、13:00 在窗口外，不依赖真实时钟。
  assert.equal(shouldSuppressLocalAlert(windowOn, { locked: false, now: at(23, 30) }), true);
  const outside = { quietHours: { enabled: true, start: "09:00", end: "12:00", suppressOnLockScreen: false } };
  assert.equal(shouldSuppressLocalAlert(outside, { locked: false, now: at(13, 0) }), false);

  const lockOnly = { quietHours: { enabled: false, start: "22:00", end: "08:00", suppressOnLockScreen: true } };
  assert.equal(shouldSuppressLocalAlert(lockOnly, { locked: true }), true);
  assert.equal(shouldSuppressLocalAlert(lockOnly, { locked: false }), false);

  assert.equal(shouldSuppressLocalAlert({}, { locked: true }), false);
  assert.equal(shouldSuppressLocalAlert(undefined, { locked: true }), false);
});
