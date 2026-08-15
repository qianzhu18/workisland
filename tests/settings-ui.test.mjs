import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../src/renderer/settings-app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../src/renderer/island/renderer/settings.html", import.meta.url), "utf8");

test("general settings expose all completion notification duration options", () => {
  assert.match(source, /完成通知停留时间/);
  for (const seconds of [5, 10, 20, 30]) {
    assert.match(source, new RegExp(`\\["${seconds}", "${seconds} 秒"\\]`));
  }
  assert.match(source, /save\(\{ completionPopupDurationSec: Number\(v\) \}\)/);
});

test("about settings route feedback and beta community through stable website anchors", () => {
  assert.match(source, /帮助与内测/);
  assert.match(source, /https:\/\/workisland\.yanglaishe\.cn\/#feedback/);
  assert.match(source, /https:\/\/workisland\.yanglaishe\.cn\/#beta-group/);
  assert.match(source, /提交反馈/);
  assert.match(source, /加入内测群/);
});

test("settings use product images instead of WorkIsland and Codex letter placeholders", () => {
  assert.match(html, /class="brand-mark"[^>]+src="\.\.\/assets\/workisland-icon\.png"/);
  assert.doesNotMatch(html, /class="brand-mark">O</);
  assert.match(source, /codex\.png/);
  assert.match(source, /agent-icon-image/);
  assert.match(source, /el\("img", "app-mark"\)/);
  assert.doesNotMatch(source, /el\("div", "app-mark", "O"\)/);
});
