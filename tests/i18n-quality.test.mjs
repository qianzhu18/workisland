import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { findHardcodedCjk, validateCatalogs } from "../scripts/check-i18n.mjs";

test("i18n catalog validation catches missing keys and placeholder drift", () => {
  assert.deepEqual(validateCatalogs(
    { greeting: "你好 {name}", plain: "完成" },
    { greeting: "Hello {name}", plain: "Done" }
  ), []);
  assert.match(validateCatalogs({ greeting: "你好 {name}" }, {}).join("\n"), /missing from en/);
  assert.match(validateCatalogs({ greeting: "你好 {name}" }, { greeting: "Hello {user}" }).join("\n"), /placeholder mismatch/);
});

test("hardcoded CJK scan ignores comments but rejects presentation literals", () => {
  assert.deepEqual(findHardcodedCjk('// 中文说明\nconst key = t("sample.key");', "sample.js"), []);
  assert.match(findHardcodedCjk('button("保存", save);', "sample.js").join("\n"), /保存/);
});

test("macOS bundle declares English and Simplified Chinese localizations", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.build.mac.extendInfo.CFBundleDevelopmentRegion, "en");
  assert.deepEqual(pkg.build.mac.extendInfo.CFBundleLocalizations, ["en", "zh-Hans"]);
});
