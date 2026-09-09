import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { localizedRuntimeText } from "../src/renderer/shared/localized-runtime-text.mjs";

test("English UI replaces Chinese backend detail with localized fallback", () => {
  assert.equal(localizedRuntimeText("en", "Hook 配置已过期", "Hook needs repair"), "Hook needs repair");
  assert.equal(localizedRuntimeText("en", "Connection timed out", "Operation failed"), "Connection timed out");
  assert.equal(localizedRuntimeText("en", "", "Operation failed"), "Operation failed");
});

test("Chinese UI preserves detailed backend diagnostics", () => {
  assert.equal(localizedRuntimeText("zh-CN", "Hook 配置已过期", "需要修复 Hook"), "Hook 配置已过期");
});

test("debug renderer participates in live localization", () => {
  const source = readFileSync(new URL("../src/renderer/debug-app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../src/renderer/island/renderer/debug.html", import.meta.url), "utf8");
  assert.match(source, /initializeI18n/);
  assert.match(source, /onLocaleChange/);
  assert.match(source, /t\("debug\.status\.refreshing"\)/);
  assert.match(html, /data-i18n="debug\.title"/);
  assert.doesNotMatch(html, />Refresh</);
  assert.doesNotMatch(html, />Reset onboarding</);
});
