import test from 'node:test';
import assert from 'node:assert/strict';
import { systemNoticeLayout, systemPillLayout } from '../src/renderer/island/components/system-notice-layout.mjs';

test('all system HUD content starts below the physical camera including its entry motion', () => {
  for (const notchHeight of [32, 38, 44]) {
    const layout = systemNoticeLayout({ hasNotch: true, notchHeight, notchWidth: 179, maxWidth: 700 });
    assert.ok(layout.contentTop - layout.entryTravel >= notchHeight + 6);
    assert.equal(layout.height, layout.contentTop + layout.rowHeight + layout.bottomInset);
    assert.ok(layout.width >= 179 + 96);
  }
});
test('external displays do not inherit a fictitious physical camera inset', () => {
  const layout = systemNoticeLayout({ hasNotch: false, notchHeight: 24, notchWidth: 126, maxWidth: 700 });
  assert.equal(layout.contentTop, 10);
  assert.equal(layout.height, 68);
});
test('notched status pills reserve both wings and never put an icon inside the camera', () => {
  const layout = systemPillLayout(179);
  assert.ok(layout.iconLeft + layout.iconSize <= -179 / 2 - 6);
  assert.ok(layout.indicatorLeft >= 179 / 2 + 6);
});
