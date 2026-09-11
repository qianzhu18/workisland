import { test } from "node:test";
import assert from "node:assert/strict";

// theme.mjs is authored renderer ESM with zero imports, so it loads directly
// under node — same trick the pet model tests use.
const { applyIslandAppearance, islandAppearanceProfile, islandBackgroundCss, resolveIslandBackground, DEFAULT_ISLAND_APPEARANCE } = await import(
  "../src/renderer/island/theme.mjs"
);

test("islandAppearanceProfile chooses light, dark, and glass foregrounds", () => {
  assert.deepEqual(islandAppearanceProfile({ kind: "solid", color: "#05070a", opacity: 1 }), {
    tone: "light", material: "solid", transparent: false, backdrop: "none"
  });
  assert.deepEqual(islandAppearanceProfile({ kind: "solid", color: "#ffffff", opacity: 1 }), {
    tone: "dark", material: "solid", transparent: false, backdrop: "none"
  });
  assert.equal(islandAppearanceProfile({ kind: "solid", color: "#ffffff", opacity: 0.5 }).tone, "glass");
  assert.equal(islandAppearanceProfile({ kind: "gradient", color: "#ffffff", color2: "#05070a", opacity: 1 }).tone, "glass");
  assert.equal(islandAppearanceProfile({ kind: "image", imageRef: "bg.png", imageDim: 0.4 }).tone, "glass");
  assert.deepEqual(islandAppearanceProfile({ kind: "glass", color: "#dbeafe", opacity: 0.2 }), {
    tone: "glass", material: "glass", transparent: false, backdrop: "blur(24px) saturate(1.18)"
  });
  assert.equal(islandAppearanceProfile({ kind: "solid", color: "#000000", opacity: 0 }).transparent, true);
});

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

test("applyIslandAppearance updates background and adaptive profile atomically", async () => {
  const values = new Map();
  const previousDocument = globalThis.document;
  globalThis.document = {
    documentElement: {
      dataset: {},
      style: {
        setProperty: (name, value) => values.set(name, value),
        removeProperty: (name) => values.delete(name)
      }
    }
  };
  try {
    await applyIslandAppearance({ kind: "glass", color: "#dbeafe", opacity: 0.2 });
    assert.match(values.get("--island-bg"), /linear-gradient/);
    assert.match(values.get("--island-bg"), /rgba\(219,234,254,0\.2\)/);
    assert.equal(values.get("--island-backdrop"), "blur(24px) saturate(1.18)");
    assert.deepEqual(document.documentElement.dataset, {
      islandTone: "glass",
      islandMaterial: "glass",
      islandTransparent: "false"
    });

    await applyIslandAppearance({ kind: "default" });
    assert.equal(values.has("--island-bg"), false);
    assert.equal(values.has("--island-backdrop"), false);
    assert.deepEqual(document.documentElement.dataset, {
      islandTone: "light",
      islandMaterial: "default",
      islandTransparent: "false"
    });
  } finally {
    globalThis.document = previousDocument;
  }
});
