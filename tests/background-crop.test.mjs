import test from "node:test";
import assert from "node:assert/strict";
import { coverCrop } from "../src/renderer/shared/background-crop.mjs";

test("coverCrop matches the Island frame and centers the source", () => {
  assert.deepEqual(coverCrop({ width: 2000, height: 1000 }, { width: 740, height: 430 }, 1, 0, 0), {
    x: 139.53488372093022,
    y: 0,
    width: 1720.9302325581396,
    height: 1000
  });
});

test("coverCrop zooms and pans without leaving the image", () => {
  const crop = coverCrop({ width: 1000, height: 2000 }, { width: 740, height: 430 }, 2, 1, -1);
  assert.equal(crop.width, 500);
  assert.ok(crop.height < 500);
  assert.equal(crop.x, 500);
  assert.equal(crop.y, 0);
});
