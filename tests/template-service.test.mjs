import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { sha256Buffer } = require("../src/shared/template-manifest.cjs");
const { createTemplateService, OFFICIAL_TEMPLATE_ID } = require("../src/main/template-service.cjs");

const SVG = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect fill="${fill}" x="4" y="4" width="24" height="24"/></svg>`;
const KEYS = ["idle", "running", "approval", "complete", "error"];

function writeTemplate(root, { id = "author.theme", version = "1.0.0", tamperHash = false, tamperSvg = false } = {}) {
  mkdirSync(join(root, "island-status"), { recursive: true });
  const assets = {};
  for (const key of KEYS) {
    const svg = SVG(`#${key === "idle" ? "31d58b" : "6e9fff"}`);
    writeFileSync(join(root, "island-status", `${key}.svg`), svg);
    assets[key] = sha256Buffer(Buffer.from(svg, "utf8"));
  }
  if (tamperSvg) writeFileSync(join(root, "island-status", "idle.svg"), SVG("#ff0000"));
  const manifest = {
    schemaVersion: 1,
    id,
    name: "Theme",
    version,
    author: "Author",
    license: "CC-BY-4.0",
    compatibility: { workisland: ">=3.1.0" },
    assets: { islandStatus: assets }
  };
  if (tamperHash) manifest.assets.islandStatus.idle = "0".repeat(64);
  writeFileSync(join(root, "template.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(root, "LICENSE"), "test license");
}

function createFixture() {
  const base = mkdtempSync(join(tmpdir(), "wi-tpl-"));
  const builtinDir = join(base, "builtin-root");
  const userData = join(base, "user-data");
  mkdirSync(builtinDir, { recursive: true });
  mkdirSync(userData, { recursive: true });
  writeTemplate(join(builtinDir, "builtin-workisland-xiaoyu"), { id: OFFICIAL_TEMPLATE_ID, version: "1.0.0" });
  const service = createTemplateService({
    getBuiltinTemplatesDir: () => builtinDir,
    getUserDataPath: () => userData,
    appVersion: "3.1.0"
  });
  return { base, builtinDir, userData, service };
}

test("validateTemplateDir accepts a well-formed package and reports modules", () => {
  const { base, service } = createFixture();
  try {
    const result = service.validateTemplateDir(join(base, "builtin-root", "builtin-workisland-xiaoyu"));
    assert.equal(result.ok, true);
    assert.equal(result.manifest.id, OFFICIAL_TEMPLATE_ID);
    assert.deepEqual(result.modules, ["island"]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("validateTemplateDir collects hash mismatches, tampered files and missing licenses", () => {
  const { base, service } = createFixture();
  try {
    const dir = join(base, "pkg");
    mkdirSync(dir, { recursive: true });
    writeTemplate(dir, { tamperHash: true });
    const hashBroken = service.validateTemplateDir(dir);
    assert.equal(hashBroken.ok, false);
    assert.ok(hashBroken.errors.some((e) => e.includes("哈希不符")));

    writeTemplate(dir, { tamperSvg: true });
    const svgChanged = service.validateTemplateDir(dir);
    assert.equal(svgChanged.ok, false);

    writeTemplate(dir);
    rmSync(join(dir, "LICENSE"));
    const noLicense = service.validateTemplateDir(dir);
    assert.equal(noLicense.ok, false);
    assert.ok(noLicense.errors.some((e) => e.includes("LICENSE")));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("installTemplateFromDir stages atomically and is idempotent per version", () => {
  const { base, userData, service } = createFixture();
  try {
    const source = join(base, "pkg");
    mkdirSync(source, { recursive: true });
    writeTemplate(source, { id: "author.theme", version: "1.0.0" });
    const first = service.installTemplateFromDir(source);
    assert.equal(first.installed, true);
    assert.equal(first.replaced, false);
    assert.ok(first.dir.startsWith(join(userData, "appearance-templates")));
    assert.ok(first.dir.includes("1.0.0"));
    const second = service.installTemplateFromDir(source);
    assert.equal(second.replaced, true);

    // A newer version installs alongside; resolveTemplateDir picks the highest.
    writeTemplate(source, { id: "author.theme", version: "1.1.0" });
    service.installTemplateFromDir(source);
    const dir = service.resolveTemplateDir("author.theme", "*");
    assert.ok(dir.endsWith("1.1.0"));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("invalid packages are rejected before any install and leave no residue", () => {
  const { base, userData, service } = createFixture();
  try {
    const source = join(base, "bad");
    mkdirSync(source, { recursive: true });
    writeTemplate(source, { tamperHash: true });
    assert.throws(() => service.installTemplateFromDir(source), /校验失败/);
    const templatesRoot = join(userData, "appearance-templates");
    assert.ok(!fs_exists(templatesRoot) || readdir(templatesRoot).every((entry) => !entry.includes("staging")));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("listTemplates surfaces builtin and local packages with validity flags", () => {
  const { base, service } = createFixture();
  try {
    const source = join(base, "pkg");
    mkdirSync(source, { recursive: true });
    writeTemplate(source, { id: "author.theme", version: "2.0.0" });
    service.installTemplateFromDir(source);
    const list = service.listTemplates();
    const ids = list.map((entry) => entry.id);
    assert.ok(ids.includes(OFFICIAL_TEMPLATE_ID));
    assert.ok(ids.includes("author.theme"));
    assert.equal(list.find((entry) => entry.id === OFFICIAL_TEMPLATE_ID).source, "builtin");
    assert.equal(list.find((entry) => entry.id === "author.theme").source, "local");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("resolveStatusAssets returns data URLs and falls back to the official template", () => {
  const { base, service } = createFixture();
  try {
    const source = join(base, "pkg");
    mkdirSync(source, { recursive: true });
    writeTemplate(source, { id: "author.theme", version: "1.0.0" });
    service.installTemplateFromDir(source);

    const active = service.resolveStatusAssets("author.theme", "1.0.0");
    assert.equal(active.source, "author.theme");
    for (const key of KEYS) {
      assert.ok(active.assets[key].startsWith("data:image/svg+xml;base64,"));
    }

    const missing = service.resolveStatusAssets("author.not-installed", "*");
    assert.equal(missing.source, OFFICIAL_TEMPLATE_ID);
    assert.ok(missing.fallbackReason.length > 0);

    const official = service.resolveStatusAssets(OFFICIAL_TEMPLATE_ID, "1.0.0");
    assert.equal(official.source, OFFICIAL_TEMPLATE_ID);
    assert.ok(official.assets.idle.startsWith("data:image/svg+xml;base64,"));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("resolveStatusAssets returns null assets when even the builtin package is broken", () => {
  const { base, builtinDir, service } = createFixture();
  try {
    rmSync(join(builtinDir, "builtin-workisland-xiaoyu", "template.json"));
    const result = service.resolveStatusAssets(OFFICIAL_TEMPLATE_ID, "1.0.0");
    assert.equal(result.assets, null);
    assert.ok(result.error.length > 0);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

function fs_exists(p) {
  try {
    require("node:fs").statSync(p);
    return true;
  } catch {
    return false;
  }
}

function readdir(p) {
  return require("node:fs").readdirSync(p);
}
