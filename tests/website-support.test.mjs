import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const html = readFileSync(new URL("../website/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../website/styles.css", import.meta.url), "utf8");
const qrUrl = new URL("../website/assets/community/workisland-beta-group.png", import.meta.url);
const authorQrUrl = new URL("../website/assets/community/qianzhu-wechat.png", import.meta.url);

test("website exposes one support hub for feedback and beta community", () => {
  assert.match(html, /id="support"/);
  assert.match(html, /id="feedback"/);
  assert.match(html, /id="beta-group"/);
  assert.match(html, /提交反馈/);
  assert.match(html, /加入 WorkIsland 内测群/);
  assert.match(html, /its\.qianzhu@gmail\.com/);
  assert.match(html, /href="mailto:its\.qianzhu@gmail\.com\?subject=WorkIsland%20feedback"/);
  assert.match(html, /href="https:\/\/github\.com\/qianzhu18\/workisland\/issues\/new\/choose" target="_blank" rel="noreferrer"/);
  assert.match(html, /src="assets\/community\/workisland-beta-group\.png" alt="WorkIsland 微信内测群二维码" width="854" height="854" loading="lazy"/);
  assert.match(html, /src="assets\/community\/qianzhu-wechat\.png" alt="作者千逐微信二维码" width="800" height="800" loading="lazy"/);
  assert.match(html, /联系作者：千逐/);
  assert.match(css, /\.vi-support/);
});

test("website beta group image is a real PNG asset", () => {
  assert.equal(existsSync(qrUrl), true);
  const png = readFileSync(qrUrl);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 854);
  assert.equal(png.readUInt32BE(20), 854);
});

test("author contact QR is a web-ready square PNG", () => {
  assert.equal(existsSync(authorQrUrl), true);
  const png = readFileSync(authorQrUrl);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 800);
  assert.equal(png.readUInt32BE(20), 800);
});

test("community QR images remain website-only assets", () => {
  const settingsSource = readFileSync(new URL("../src/renderer/settings-app.js", import.meta.url), "utf8");
  assert.doesNotMatch(settingsSource, /workisland-beta-group\.png/);
  assert.doesNotMatch(settingsSource, /qianzhu-wechat\.png/);
});
