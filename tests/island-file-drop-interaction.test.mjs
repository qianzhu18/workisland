import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  createFileDropInteraction,
  normalizeIslandInteractionBounds,
  resolveDropProximityMouseMode
} = require("../src/main/island-file-drop-interaction.cjs");

test("visible interaction bounds accept finite positive rectangles and reject unsafe input", () => {
  assert.equal(typeof normalizeIslandInteractionBounds, "function");
  assert.deepEqual(normalizeIslandInteractionBounds({ x: 20, y: 0, width: 700, height: 320 }), {
    x: 20,
    y: 0,
    width: 700,
    height: 320
  });
  assert.equal(normalizeIslandInteractionBounds({ x: 0, y: 0, width: -1, height: 20 }), null);
  assert.equal(normalizeIslandInteractionBounds({ x: 0, y: 0, width: Infinity, height: 20 }), null);
});

test("ending a drag re-evaluates the real pointer position instead of keeping the drag mouse mode", () => {
  const samePointerPosition = { panelExpanded: false, concealed: false, pointerInside: false };

  assert.equal(resolveDropProximityMouseMode({ ...samePointerPosition, fileDragActive: true }), "interactive");
  assert.equal(resolveDropProximityMouseMode({ ...samePointerPosition, fileDragActive: false }), "forward");
});

test("an expanded panel only captures the pointer inside its visible bounds", () => {
  assert.equal(resolveDropProximityMouseMode({
    fileDragActive: false,
    panelExpanded: true,
    concealed: false,
    pointerInside: true
  }), "interactive");
  assert.equal(resolveDropProximityMouseMode({
    fileDragActive: false,
    panelExpanded: true,
    concealed: false,
    pointerInside: false
  }), "forward");

  const interaction = createFileDropInteraction();
  assert.equal(interaction.shouldForwardMouseEventsOnLeave({ panelExpanded: true }), true);
});

test("an active Finder drag keeps the Island interactive until drop finishes", () => {
  const interaction = createFileDropInteraction();

  assert.equal(interaction.shouldForwardMouseEventsOnLeave(), true);
  interaction.setActive(true);
  assert.equal(interaction.shouldForwardMouseEventsOnLeave(), false);
  interaction.setActive(false);
  assert.equal(interaction.shouldForwardMouseEventsOnLeave(), true);
});

test("a lost drag end expires its lease and restores Island interaction", () => {
  let scheduled = null;
  let cancelled = 0;
  let expired = 0;
  const interaction = createFileDropInteraction({
    timeoutMs: 1234,
    scheduleTimeout(callback, delay) {
      assert.equal(delay, 1234);
      scheduled = callback;
      return 7;
    },
    cancelTimeout(id) {
      assert.equal(id, 7);
      cancelled += 1;
    },
    onExpire() { expired += 1; }
  });

  interaction.setActive(true);
  assert.equal(interaction.shouldForwardMouseEventsOnLeave(), false);
  scheduled();
  assert.equal(expired, 1);
  assert.equal(interaction.shouldForwardMouseEventsOnLeave(), true);

  interaction.setActive(true);
  interaction.setActive(false);
  assert.equal(cancelled, 1);
});
