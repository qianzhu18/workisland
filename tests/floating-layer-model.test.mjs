import assert from "node:assert/strict";
import { test } from "node:test";
import { placeFloatingLayer } from "../src/renderer/island/components/floating-layer-model.mjs";

test("floating layer stays fully inside the right edge", () => {
  const result = placeFloatingLayer(
    { left: 700, right: 736, top: 20, bottom: 48 },
    { width: 740, height: 750 },
    { width: 246, height: 300 }
  );
  assert.ok(result.left >= 12);
  assert.ok(result.left + 246 <= 728);
});

test("floating layer opens above the trigger when the bottom has no room", () => {
  const result = placeFloatingLayer(
    { left: 500, right: 540, top: 700, bottom: 730 },
    { width: 740, height: 750 },
    { width: 246, height: 300 }
  );
  assert.ok(result.top < 700);
  assert.ok(result.top >= 12);
  assert.ok(result.top + 300 <= 738);
});
