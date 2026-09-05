import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const html = readFileSync(new URL("../website/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../website/styles.css", import.meta.url), "utf8");
const english = readFileSync(new URL("../website/en/index.html", import.meta.url), "utf8");
const englishCss = readFileSync(new URL("../website/en/en.css", import.meta.url), "utf8");
const chineseClaudeGuide = readFileSync(new URL("../website/guides/claude-code-notifications/index.html", import.meta.url), "utf8");
const englishClaudeGuide = readFileSync(new URL("../website/en/claude-code-notifications/index.html", import.meta.url), "utf8");
const articleCss = readFileSync(new URL("../website/guides/article.css", import.meta.url), "utf8");
const guide = readFileSync(new URL("../website/guide/index.html", import.meta.url), "utf8");
const guideCss = readFileSync(new URL("../website/guide/guide.css", import.meta.url), "utf8");
const changelog = readFileSync(new URL("../website/changelog/index.html", import.meta.url), "utf8");
const changelogCss = readFileSync(new URL("../website/changelog/changelog.css", import.meta.url), "utf8");
const rootChangelogUrl = new URL("../CHANGELOG.md", import.meta.url);
const releaseWorkflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const websiteWorkflow = readFileSync(new URL("../.github/workflows/website.yml", import.meta.url), "utf8");
const ossMirrorWorkflow = readFileSync(new URL("../.github/workflows/oss-download-mirror.yml", import.meta.url), "utf8");
const qrUrl = new URL("../website/assets/community/workisland-community-group.png", import.meta.url);
const robotsUrl = new URL("../website/robots.txt", import.meta.url);
const sitemapUrl = new URL("../website/sitemap.xml", import.meta.url);
const downloadConfigUrl = new URL("../website/download-config.json", import.meta.url);
const downloadsScriptUrl = new URL("../website/downloads.js", import.meta.url);
const downloadManifestScriptUrl = new URL("../scripts/build-download-manifest.mjs", import.meta.url);
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
  assert.match(sitemap, /<loc>https:\/\/workisland\.yanglaishe\.cn\/en\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/workisland\.yanglaishe\.cn\/guide\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/workisland\.yanglaishe\.cn\/changelog\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/workisland\.yanglaishe\.cn\/guides\/claude-code-notifications\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/workisland\.yanglaishe\.cn\/en\/claude-code-notifications\/<\/loc>/);
});

test("website declares a canonical URL for each indexable page", () => {
  assert.match(html, /<link rel="canonical" href="https:\/\/workisland\.yanglaishe\.cn\/">/);
  assert.match(english, /<link rel="canonical" href="https:\/\/workisland\.yanglaishe\.cn\/en\/">/);
  assert.match(guide, /<link rel="canonical" href="https:\/\/workisland\.yanglaishe\.cn\/guide\/">/);
  assert.match(changelog, /<link rel="canonical" href="https:\/\/workisland\.yanglaishe\.cn\/changelog\/">/);
  assert.match(chineseClaudeGuide, /<link rel="canonical" href="https:\/\/workisland\.yanglaishe\.cn\/guides\/claude-code-notifications\/">/);
  assert.match(englishClaudeGuide, /<link rel="canonical" href="https:\/\/workisland\.yanglaishe\.cn\/en\/claude-code-notifications\/">/);
});

test("website tracks every public page with Clarity and discloses the third-party analytics service", () => {
  for (const page of [html, english, guide, changelog, chineseClaudeGuide, englishClaudeGuide]) {
    assert.match(page, /https:\/\/www\.clarity\.ms\/tag\//);
    assert.match(page, /"yd6hexza0b"/);
  }

  assert.match(guide, /官网使用自托管 Umami 与 Microsoft Clarity/);
  assert.match(guide, /https:\/\/privacy\.microsoft\.com\/privacystatement/);
  assert.match(english, /This website uses self-hosted Umami and Microsoft Clarity/);
});

test("website gives English searchers a complete, reciprocal product page", () => {
  assert.match(html, /<link rel="alternate" hreflang="en" href="https:\/\/workisland\.yanglaishe\.cn\/en\/">/);
  assert.match(english, /<html lang="en">/);
  assert.match(english, /<link rel="alternate" hreflang="zh-CN" href="https:\/\/workisland\.yanglaishe\.cn\/">/);
  assert.match(english, /<link rel="alternate" hreflang="en" href="https:\/\/workisland\.yanglaishe\.cn\/en\/">/);
  assert.match(english, /<link rel="alternate" hreflang="x-default" href="https:\/\/workisland\.yanglaishe\.cn\/">/);
  assert.match(english, /Claude Code, Codex, Cursor/);
  assert.match(english, /href="claude-code-notifications\/"/);
  assert.match(english, /<section class="en-section en-faq" id="faq">/);
  assert.match(englishCss, /\.en-hero/);
});

test("website describes the visible product as a SoftwareApplication without unsupported ratings or offers", () => {
  for (const page of [html, english]) {
    assert.match(page, /"@type": "SoftwareApplication"/);
    assert.match(page, /"operatingSystem": "macOS"/);
    assert.match(page, /"isAccessibleForFree": true/);
    assert.doesNotMatch(page, /"aggregateRating"/);
    assert.doesNotMatch(page, /"offers"/);
  }
});

test("nginx redirects HTML index aliases to the canonical directory URLs", () => {
  assert.match(nginxConfig, /location = \/index\.html \{\s*return 301 https:\/\/workisland\.yanglaishe\.cn\/;\s*\}/);
  assert.match(nginxConfig, /location = \/guide\/index\.html \{\s*return 301 https:\/\/workisland\.yanglaishe\.cn\/guide\/;\s*\}/);
  assert.match(nginxConfig, /location = \/en\/index\.html \{\s*return 301 https:\/\/workisland\.yanglaishe\.cn\/en\/;\s*\}/);
  assert.match(nginxConfig, /location = \/guides\/claude-code-notifications\/index\.html \{\s*return 301 https:\/\/workisland\.yanglaishe\.cn\/guides\/claude-code-notifications\/;\s*\}/);
  assert.match(nginxConfig, /location = \/en\/claude-code-notifications\/index\.html \{\s*return 301 https:\/\/workisland\.yanglaishe\.cn\/en\/claude-code-notifications\/;\s*\}/);
  assert.match(nginxConfig, /location = \/guides\/claude-code-notifications\/ \{\s*try_files \/guides\/claude-code-notifications\/index\.html =404;\s*\}/);
  assert.match(nginxConfig, /location = \/en\/claude-code-notifications\/ \{\s*try_files \/en\/claude-code-notifications\/index\.html =404;\s*\}/);
});

test("website metadata states the product intent and canonical share preview", () => {
  assert.match(html, /<title>WorkIsland：AI 原生时代的 macOS 工作界面<\/title>/);
  assert.match(html, /<h1 class="vi-headline"><span>AI 原生时代的<\/span><em>macOS 工作界面。<\/em><\/h1>/);
  assert.match(html, /工作需要你时，不必四处寻找。/);
  assert.match(html, /从 Claude Code、Codex、Cursor 等 AI 编程 Agent 开始/);
  assert.match(english, /<title>WorkIsland — Native Mac Work Interface for AI Workflows<\/title>/);
  assert.match(english, /When work needs you, you should not have to go looking for it\./);
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
  assert.match(websiteWorkflow, /test -s website\/en\/index\.html/);
  assert.match(websiteWorkflow, /test -s website\/en\/en\.css/);
  assert.match(websiteWorkflow, /test -s website\/changelog\/index\.html/);
  assert.match(websiteWorkflow, /test -s website\/changelog\/changelog\.css/);
  assert.match(websiteWorkflow, /test -s website\/downloads\.js/);
  assert.match(websiteWorkflow, /test -s website\/download-config\.json/);
  assert.match(websiteWorkflow, /test -s website\/guides\/claude-code-notifications\/index\.html/);
  assert.match(websiteWorkflow, /test -s website\/en\/claude-code-notifications\/index\.html/);
});

test("website prioritizes its primary product visual without changing image assets", () => {
  assert.match(html, /<link rel="preconnect" href="https:\/\/api\.github\.com" crossorigin>/);
  assert.match(html, /<img class="vi-real-demo-image"[^>]*fetchpriority="high"[^>]*width="1480" height="1144"/);
  assert.match(guide, /<img src="\.\.\/assets\/demo\/overview\.png(\?v=[^"]*)?"[^>]*fetchpriority="high"[^>]*width="1480" height="1144"/);
});

test("website can prefer an OSS-compatible manifest without removing the GitHub fallback", () => {
  const config = JSON.parse(readFileSync(downloadConfigUrl, "utf8"));
  const downloadsScript = readFileSync(downloadsScriptUrl, "utf8");

  assert.match(config.mirrorManifestUrl, /^https:\/\//);
  assert.match(downloadsScript, /const configUrl = "\/download-config\.json"/);
  assert.match(downloadsScript, /mirrorManifestUrl/);
  assert.match(downloadsScript, /https:\/\/github\.com\/\$\{repository\}\/releases\/latest/);
  assert.match(downloadsScript, /A mirror\/configuration outage must never block the official fallback/);
  assert.match(nginxConfig, /location = \/download-config\.json \{\s*add_header Cache-Control "no-cache";\s*try_files \/download-config\.json =404;\s*\}/);
});

test("website publishes a reciprocal, substantive Claude Code notification guide", () => {
  assert.match(chineseClaudeGuide, /Claude Code 完成提醒/);
  assert.match(chineseClaudeGuide, /"@type": "FAQPage"/);
  assert.match(chineseClaudeGuide, /hreflang="en" href="https:\/\/workisland\.yanglaishe\.cn\/en\/claude-code-notifications\/"/);
  assert.match(chineseClaudeGuide, /data-download-link/);
  assert.match(englishClaudeGuide, /Claude Code notifications on macOS/);
  assert.match(englishClaudeGuide, /"@type": "FAQPage"/);
  assert.match(englishClaudeGuide, /hreflang="zh-CN" href="https:\/\/workisland\.yanglaishe\.cn\/guides\/claude-code-notifications\/"/);
  assert.match(articleCss, /\.article-hero/);
});

test("download manifest records the exact mirrored release artifact and checksum", () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "workisland-download-manifest-"));
  const sourceDir = join(fixtureDir, "release");
  const outputPath = join(fixtureDir, "latest.json");
  const dmgPath = join(sourceDir, "WorkIsland-1.3.0-arm64.dmg");
  try {
    mkdirSync(sourceDir);
    writeFileSync(dmgPath, "verified release bytes", { flag: "wx" });
    const result = spawnSync(process.execPath, [fileURLToPath(downloadManifestScriptUrl), "--tag", "v1.3.0", "--source", sourceDir, "--public-base", "https://download.example.com", "--output", outputPath, "--published-at", "2026-09-05T00:00:00.000Z"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(manifest.version, "v1.3.0");
    assert.equal(manifest.assets.length, 1);
    assert.equal(manifest.assets[0].platform, "macos");
    assert.equal(manifest.assets[0].arch, "arm64");
    assert.equal(manifest.assets[0].url, "https://download.example.com/releases/v1.3.0/WorkIsland-1.3.0-arm64.dmg");
    assert.match(manifest.assets[0].sha256, /^[a-f0-9]{64}$/);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("OSS mirror automation only publishes stable release assets after secrets are configured", () => {
  assert.match(ossMirrorWorkflow, /types: \[published\]/);
  assert.match(ossMirrorWorkflow, /github\.event\.release\.prerelease == false/);
  assert.match(ossMirrorWorkflow, /Check optional mirror configuration/);
  assert.match(ossMirrorWorkflow, /no files will be uploaded/);
  assert.match(ossMirrorWorkflow, /gh release download/);
  assert.match(ossMirrorWorkflow, /sha256sum --check --status/);
  assert.match(ossMirrorWorkflow, /ossutil cp --recursive release\//);
  assert.match(ossMirrorWorkflow, /ossutil cp mirror\/latest\.json/);
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
  // macOS 构建是 arm64/x64 矩阵（单 job `macos`），Alpha Tag 不构建 macOS 稳定包。
  assert.match(releaseWorkflow, /macos:\s*\n\s+if:.*!contains\(github\.ref_name, '-alpha'\)/);
  assert.match(releaseWorkflow, /arch:\s*\[arm64, x64\]/);
  assert.match(releaseWorkflow, /windows-x64-alpha:\s*\n\s+if:.*contains\(github\.ref_name, '-alpha'\)/);
});
