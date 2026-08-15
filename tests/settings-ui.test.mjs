import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { isAllowedExternalUrl } = require("../src/main/external-url-policy.cjs");
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
  assert.match(source, /its\.qianzhu@gmail\.com/);
  assert.match(source, /api\.openExternal\(FEEDBACK_EMAIL_URL\)/);
  assert.equal(isAllowedExternalUrl("https://workisland.yanglaishe.cn/#feedback"), true);
  assert.equal(isAllowedExternalUrl("https://workisland.yanglaishe.cn/#beta-group"), true);
  assert.equal(isAllowedExternalUrl("mailto:its.qianzhu@gmail.com?subject=WorkIsland%20feedback"), true);
  assert.equal(isAllowedExternalUrl("mailto:?subject=missing-recipient"), false);
  assert.equal(isAllowedExternalUrl("mailto:other@example.com?subject=WorkIsland%20feedback"), false);
  assert.equal(isAllowedExternalUrl("mailto:first@example.com,second@example.com"), false);
  assert.equal(isAllowedExternalUrl("mailto:its.qianzhu@gmail.com?cc=other@example.com"), false);
  assert.equal(isAllowedExternalUrl("mailto:its.qianzhu@gmail.com?subject=hello%0Aworld"), false);
});

test("settings use product images instead of WorkIsland and Codex letter placeholders", () => {
  assert.match(html, /class="brand-mark"[^>]+src="\.\.\/assets\/workisland-icon\.png"[^>]+draggable="false"/);
  assert.doesNotMatch(html, /class="brand-mark">O</);
  assert.match(source, /codex\.png/);
  assert.match(source, /agent-icon-image/);
  assert.match(source, /icon\.draggable = false/);
  assert.match(source, /el\("img", "app-mark"\)/);
  assert.match(source, /appMark\.draggable = false/);
  assert.doesNotMatch(source, /el\("div", "app-mark", "O"\)/);
});
