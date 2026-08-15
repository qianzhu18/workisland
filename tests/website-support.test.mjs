import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const html = readFileSync(new URL("../website/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../website/styles.css", import.meta.url), "utf8");
const qrUrl = new URL("../website/assets/community/workisland-beta-group.png", import.meta.url);

test("website exposes one support hub for feedback and beta community", () => {
  assert.match(html, /id="support"/);
  assert.match(html, /id="feedback"/);
  assert.match(html, /id="beta-group"/);
  assert.match(html, /提交反馈/);
  assert.match(html, /加入 WorkIsland 内测群/);
  assert.match(html, /https:\/\/github\.com\/qianzhu18\/workisland\/issues\/new\/choose/);
  assert.match(html, /assets\/community\/workisland-beta-group\.png/);
  assert.match(css, /\.vi-support/);
});

test("website beta group image is a real PNG asset", () => {
  assert.equal(existsSync(qrUrl), true);
  const png = readFileSync(qrUrl);
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  assert.ok(png.readUInt32BE(16) >= 600);
  assert.ok(png.readUInt32BE(20) >= 600);
});
