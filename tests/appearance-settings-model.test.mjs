import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appearanceForMaterial,
  materialForAppearance,
  withAppearanceColor,
  withAppearanceOpacity
} from "../src/renderer/shared/appearance-settings-model.mjs";

test("default appearance becomes an immediately adjustable black solid", () => {
  assert.deepEqual(appearanceForMaterial({ kind: "default" }, "solid"), {
    kind: "solid",
    color: "#000000",
    opacity: 1
  });
  assert.deepEqual(withAppearanceColor({ kind: "default" }, "#ffffff"), {
    kind: "solid",
    color: "#ffffff",
    opacity: 1
  });
  assert.deepEqual(withAppearanceOpacity({ kind: "default" }, 0), {
    kind: "solid",
    color: "#000000",
    opacity: 0
  });
});

test("material transitions preserve useful values without leaking incompatible fields", () => {
  assert.equal(materialForAppearance({ kind: "gradient" }), "solid");
  assert.equal(materialForAppearance({ kind: "image" }), "image");
  assert.equal(materialForAppearance({ kind: "glass" }), "glass");
  assert.deepEqual(appearanceForMaterial({ kind: "solid", color: "#123456", opacity: 0.4 }, "glass"), {
    kind: "glass",
    color: "#123456",
    opacity: 0.4
  });
  assert.deepEqual(appearanceForMaterial({ kind: "image", imageRef: "bg-a.png", imageDim: 0.6 }, "solid"), {
    kind: "solid",
    color: "#000000",
    opacity: 1
  });
  assert.deepEqual(appearanceForMaterial({ kind: "default" }, "glass"), {
    kind: "glass",
    color: "#dbeafe",
    opacity: 0.18
  });
});

test("color and opacity edits retain the selected color material", () => {
  assert.deepEqual(withAppearanceColor({ kind: "glass", color: "#111111", opacity: 0.25 }, "#abcdef"), {
    kind: "glass",
    color: "#abcdef",
    opacity: 0.25
  });
  assert.deepEqual(withAppearanceOpacity({ kind: "solid", color: "#abcdef", opacity: 1 }, 0.55), {
    kind: "solid",
    color: "#abcdef",
    opacity: 0.55
  });
});
