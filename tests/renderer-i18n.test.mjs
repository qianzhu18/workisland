import assert from "node:assert/strict";
import { test } from "node:test";

import { createRendererI18n } from "../src/renderer/shared/i18n-runtime.mjs";

function fakeBridge(initial) {
  let listener = null;
  return {
    getLocaleState: async () => initial,
    setLanguagePreference: async (preference) => ({ ...initial, preference }),
    onLocaleChanged(callback) {
      listener = callback;
      return () => { listener = null; };
    },
    emit(snapshot) {
      listener?.(snapshot);
    }
  };
}

test("renderer initializes before translation and updates in place", async () => {
  const bridge = fakeBridge({
    preference: "system",
    locale: "en",
    messages: { "common.cancel": "Cancel", "hello": "Hello, {name}" }
  });
  const applied = [];
  const runtime = createRendererI18n({ onApply: (snapshot) => applied.push(snapshot) });
  let changeCount = 0;
  runtime.onChange(() => { changeCount += 1; });

  await runtime.initialize(bridge);
  assert.equal(runtime.t("common.cancel"), "Cancel");
  assert.equal(runtime.t("hello", { name: "Skyler" }), "Hello, Skyler");

  bridge.emit({
    preference: "zh-CN",
    locale: "zh-CN",
    messages: { "common.cancel": "取消", "hello": "你好，{name}" }
  });
  assert.equal(runtime.t("common.cancel"), "取消");
  assert.equal(runtime.getLocale(), "zh-CN");
  assert.equal(runtime.getLanguagePreference(), "zh-CN");
  assert.equal(changeCount, 2);
  assert.equal(applied.length, 2);
});

test("renderer translator keeps unknown and incomplete values operable", () => {
  const runtime = createRendererI18n();
  assert.equal(runtime.t("missing.key"), "missing.key");
  runtime.applySnapshot({
    locale: "zh-CN",
    messages: { greeting: "你好，{name}" },
    fallbackMessages: { greeting: "Hello, {name}", "fallback.only": "English fallback" }
  });
  assert.equal(runtime.t("greeting"), "你好，{name}");
  assert.equal(runtime.t("fallback.only"), "English fallback");
});
