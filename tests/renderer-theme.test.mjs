import { test } from "node:test";
import assert from "node:assert/strict";

// theme.mjs is authored renderer ESM with zero imports, so it loads directly
// under node — same trick the pet model tests use.
const { islandBackgroundCss, resolveIslandBackground, DEFAULT_ISLAND_APPEARANCE } = await import(
  "../src/renderer/island/theme.mjs"
);

test("islandBackgroundCss mirrors the main-process compiler", () => {
  assert.equal(islandBackgroundCss(undefined), "#000");
  assert.equal(islandBackgroundCss({ kind: "default" }), "#000");
  assert.equal(
    islandBackgroundCss({ kind: "solid", color: "#0b1e3a", opacity: 0.72 }),
    "rgba(11,30,58,0.72)"
  );
  assert.equal(
    islandBackgroundCss({ kind: "gradient", color: "#1f1330", color2: "#0b0716", angle: 120, opacity: 1 }),
    "linear-gradient(120deg, rgba(31,19,48,1), rgba(11,7,22,1))"
  );
});

test("islandBackgroundCss layers dim + image only when a data url exists", () => {
  const withImage = islandBackgroundCss({ kind: "image", imageDim: 0.45 }, "data:image/webp;base64,QQ");
  assert.ok(withImage.startsWith("linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url("));
  assert.equal(
    islandBackgroundCss({ kind: "image", imageDim: 0.35 }),
    "linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.35)), #000"
  );
});

test("resolveIslandBackground fetches images and survives getter failures", async () => {
  const css = await resolveIslandBackground(
    { kind: "image", imageRef: "bg-test.png", imageDim: 0.4 },
    async (ref) => {
      assert.equal(ref, "bg-test.png");
      return "data:image/png;base64,ZZ";
    }
  );
  assert.ok(css.includes("data:image/png;base64,ZZ"));

  const failed = await resolveIslandBackground(
    { kind: "image", imageRef: "bg-test.png", imageDim: 0.4 },
    async () => {
      throw new Error("ipc down");
    }
  );
  assert.equal(failed, "linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.4)), #000");

  const solid = await resolveIslandBackground({ kind: "solid", color: "#123456", opacity: 1 }, async () => "unused");
  assert.equal(solid, "rgba(18,52,86,1)");
});

test("DEFAULT_ISLAND_APPEARANCE stays frozen default", () => {
  assert.deepEqual(DEFAULT_ISLAND_APPEARANCE, { kind: "default" });
});
