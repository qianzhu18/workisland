import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const html = readFileSync(new URL("../website/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../website/styles.css", import.meta.url), "utf8");
const guide = readFileSync(new URL("../website/guide/index.html", import.meta.url), "utf8");
const guideCss = readFileSync(new URL("../website/guide/guide.css", import.meta.url), "utf8");
const changelog = readFileSync(new URL("../website/changelog/index.html", import.meta.url), "utf8");
const changelogCss = readFileSync(new URL("../website/changelog/changelog.css", import.meta.url), "utf8");
const rootChangelogUrl = new URL("../CHANGELOG.md", import.meta.url);
const releaseWorkflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const websiteWorkflow = readFileSync(new URL("../.github/workflows/website.yml", import.meta.url), "utf8");
const qrUrl = new URL("../website/assets/community/workisland-community-group.png", import.meta.url);
const robotsUrl = new URL("../website/robots.txt", import.meta.url);
const sitemapUrl = new URL("../website/sitemap.xml", import.meta.url);
const nginxConfig = readFileSync(new URL("../deploy/nginx/workisland.conf", import.meta.url), "utf8");

test("website exposes one support hub for feedback and community", () => {
  assert.match(html, /id="support"/);
  assert.match(html, /id="feedback"/);
  assert.match(html, /id="community"/);
  assert.match(html, /提交反馈/);
  assert.match(html, /加入 WorkIsland 社区/);
  assert.match(html, /https:\/\/github\.com\/qianzhu18\/workisland\/issues\/new\/choose/);
  assert.match(html, /assets\/community\/workisland-community-group\.png/);
  assert.match(css, /\.vi-support/);
});

test("website makes the GitHub Star request explicit in the hero", () => {
  assert.match(html, /在 GitHub 点 Star/);
  assert.match(html, /觉得 WorkIsland 好用？欢迎在 GitHub 上给我们点个 Star，这对我们真的非常重要。/);
  assert.match(css, /\.vi-star-note/);
});

test("website community image is a real, usable PNG asset", () => {
  assert.equal(existsSync(qrUrl), true);
  const png = readFileSync(qrUrl);
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  assert.ok(png.readUInt32BE(16) >= 500);
  assert.ok(png.readUInt32BE(20) >= 500);
});

test("website links a user manual that covers first use and privacy", () => {
  assert.match(html, /href="guide\/"/);
  assert.match(guide, /WorkIsland 产品手册/);
  assert.match(guide, /开始第一个任务/);
  assert.match(guide, /匿名统计默认开启/);
  assert.match(guide, /随时由你关闭/);
  assert.doesNotMatch(guide, /匿名使用统计默认关闭/);
  assert.match(guide, /提交反馈/);
});

test("website publishes a canonical changelog for user-visible releases", () => {
  assert.equal(existsSync(rootChangelogUrl), true);
  assert.match(html, /href="changelog\/">更新日志<\/a>/);
  assert.match(changelog, /<link rel="canonical" href="https:\/\/workisland\.yanglaishe\.cn\/changelog\/">/);
  assert.match(changelog, /WorkIsland 更新日志/);
  assert.match(changelog, /v3\.1\.0/);
  assert.match(changelog, /同步歌词与专辑封面动效/);
  assert.match(changelogCss, /\.changelog-release/);
});

test("website publishes crawler discovery files for its canonical pages", () => {
  assert.equal(existsSync(robotsUrl), true);
  assert.equal(existsSync(sitemapUrl), true);

  const robots = readFileSync(robotsUrl, "utf8");
  const sitemap = readFileSync(sitemapUrl, "utf8");

  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Sitemap: https:\/\/workisland\.yanglaishe\.cn\/sitemap\.xml$/m);
  assert.match(sitemap, /<loc>https:\/\/workisland\.yanglaishe\.cn\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/workisland\.yanglaishe\.cn\/guide\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/workisland\.yanglaishe\.cn\/changelog\/<\/loc>/);
});

test("website declares a canonical URL for each indexable page", () => {
  assert.match(html, /<link rel="canonical" href="https:\/\/workisland\.yanglaishe\.cn\/">/);
  assert.match(guide, /<link rel="canonical" href="https:\/\/workisland\.yanglaishe\.cn\/guide\/">/);
  assert.match(changelog, /<link rel="canonical" href="https:\/\/workisland\.yanglaishe\.cn\/changelog\/">/);
});

test("nginx redirects HTML index aliases to the canonical directory URLs", () => {
  assert.match(nginxConfig, /location = \/index\.html \{\s*return 301 https:\/\/workisland\.yanglaishe\.cn\/;\s*\}/);
  assert.match(nginxConfig, /location = \/guide\/index\.html \{\s*return 301 https:\/\/workisland\.yanglaishe\.cn\/guide\/;\s*\}/);
});

test("website metadata states the product intent and canonical share preview", () => {
  assert.match(html, /<title>WorkIsland：macOS AI 编程 Agent 任务监控与审批<\/title>/);
  assert.match(html, /<h1 class="vi-headline"><span>让&nbsp;AI 编程<\/span><em>Agent 浮上来。<\/em><\/h1>/);
  assert.match(html, /AI 编程 Agent 任务监控/);
  assert.match(guide, /<title>WorkIsland 产品手册：安装、连接与 AI Agent 任务监控<\/title>/);
  assert.match(html, /property="og:url" content="https:\/\/workisland\.yanglaishe\.cn\/"/);
  assert.match(html, /property="og:image" content="https:\/\/workisland\.yanglaishe\.cn\/assets\/demo\/overview\.png"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /"@type": "WebSite"/);
  assert.match(html, /"url": "https:\/\/workisland\.yanglaishe\.cn\/"/);
});

test("website deployment validates crawler discovery files", () => {
  assert.match(websiteWorkflow, /test -s website\/robots\.txt/);
  assert.match(websiteWorkflow, /test -s website\/sitemap\.xml/);
  assert.match(websiteWorkflow, /test -s website\/changelog\/index\.html/);
  assert.match(websiteWorkflow, /test -s website\/changelog\/changelog\.css/);
});

test("website prioritizes its primary product visual without changing image assets", () => {
  assert.match(html, /<link rel="preconnect" href="https:\/\/api\.github\.com" crossorigin>/);
  assert.match(html, /<img class="vi-real-demo-image"[^>]*fetchpriority="high"[^>]*width="1480" height="1144"/);
  assert.match(guide, /<img src="\.\.\/assets\/demo\/overview\.png"[^>]*fetchpriority="high"[^>]*width="1480" height="1144"/);
});

test("website hero copy can wrap long mixed-language text on narrow screens", () => {
  assert.match(css, /\.vi-sub \{[^}]*overflow-wrap: anywhere;/);
});

test("guide frames its product screenshot without exposing the empty lower capture area", () => {
  assert.match(guideCss, /\.guide-shot img \{[^}]*width: 100%;[^}]*height: auto;[^}]*aspect-ratio: 16 \/ 9;[^}]*object-fit: cover;[^}]*object-position: top;/);
});

test("release workflow marks prerelease tags as prereleases", () => {
  assert.match(releaseWorkflow, /prerelease:\s*\$\{\{\s*contains\(github\.ref_name, '-'/);
});

test("release workflow keeps macOS releases separate from Windows Alpha tags", () => {
  assert.match(releaseWorkflow, /macos-arm64:\s*\n\s+if:.*!contains\(github\.ref_name, '-alpha'\)/);
  assert.match(releaseWorkflow, /windows-x64-alpha:\s*\n\s+if:.*contains\(github\.ref_name, '-alpha'\)/);
});
