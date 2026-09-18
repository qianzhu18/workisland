import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appearanceForMaterial,
  materialForAppearance,
  rememberedImageAppearance,
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
  assert.equal(materialForAppearance({ kind: "glass" }), "solid");
  assert.deepEqual(appearanceForMaterial({ kind: "image", imageRef: "bg-a.png", imageDim: 0.6 }, "solid"), {
    kind: "solid",
    color: "#000000",
    opacity: 1
  });
});

test("remembered image survives while another material is active", () => {
  assert.deepEqual(rememberedImageAppearance({
    islandAppearance: { kind: "solid", color: "#123456", opacity: 1 },
    lastIslandImageAppearance: { kind: "image", imageRef: "bg-a.png", imageDim: 0.6 }
  }), { kind: "image", imageRef: "bg-a.png", imageDim: 0.6 });
  assert.deepEqual(rememberedImageAppearance({
    islandAppearance: { kind: "image", imageRef: "bg-current.png", imageDim: 0.25 }
  }), { kind: "image", imageRef: "bg-current.png", imageDim: 0.25 });
  assert.equal(rememberedImageAppearance({ islandAppearance: { kind: "solid" } }), null);
});

test("color and opacity edits normalize retired glass backgrounds to solid", () => {
  assert.deepEqual(withAppearanceColor({ kind: "glass", color: "#111111", opacity: 0.25 }, "#abcdef"), {
    kind: "solid",
    color: "#abcdef",
    opacity: 0.25
  });
  assert.deepEqual(withAppearanceOpacity({ kind: "solid", color: "#abcdef", opacity: 1 }, 0.55), {
    kind: "solid",
    color: "#abcdef",
    opacity: 0.55
  });
});
