import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../src/renderer/settings-app.js", import.meta.url), "utf8");

test("general settings expose all completion notification duration options", () => {
  assert.match(source, /完成通知停留时间/);
  for (const seconds of [5, 10, 20, 30]) {
    assert.match(source, new RegExp(`\\["${seconds}", "${seconds} 秒"\\]`));
  }
  assert.match(source, /save\(\{ completionPopupDurationSec: Number\(v\) \}\)/);
});
