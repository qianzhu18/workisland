import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  TEMPLATE_SCHEMA_VERSION,
  ISLAND_STATUS_KEYS,
  TemplateValidationError,
  sha256Buffer,
  satisfiesMinimumVersion,
  parseTemplateManifestJson,
  validateSvgAsset,
  templateDirNameForId
} = require("../src/shared/template-manifest.cjs");
const {
  DEFAULT_APPEARANCE_TEMPLATE,
  normalizeAppearanceTemplate,
  normalizeAppearanceOverrides
} = require("../src/shared/template-defaults.cjs");
const { mergeSettings } = require("../src/shared/settings.cjs");

const CLEAN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges"><rect fill="#31d58b" x="10" y="10" width="12" height="12"/></svg>';
const HASH = sha256Buffer(Buffer.from(CLEAN_SVG, "utf8"));

function islandStatusAssets() {
  return Object.fromEntries(ISLAND_STATUS_KEYS.map((key) => [key, HASH]));
}

function baseManifest(overrides = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    id: "author.test-theme",
    name: "Test Theme",
    version: "1.2.3",
    author: "Author",
    license: "CC-BY-4.0",
    compatibility: { workisland: ">=3.1.0" },
    assets: { islandStatus: islandStatusAssets() },
    ...overrides
  });
}

test("valid manifest parses and normalizes with whitelisted fields only", () => {
  const manifest = parseTemplateManifestJson(baseManifest());
  assert.equal(manifest.id, "author.test-theme");
  assert.equal(manifest.compatibility.workislandMinimum, "3.1.0");
  assert.equal(Object.keys(manifest).length, 9);
  assert.deepEqual(Object.keys(manifest.assets.islandStatus).sort(), [...ISLAND_STATUS_KEYS].sort());
});

test("manifest rejects unknown top-level fields, bad ids, versions and licenses", () => {
  assert.throws(() => parseTemplateManifestJson(baseManifest({ evil: 1 })), TemplateValidationError);
  assert.throws(() => parseTemplateManifestJson(baseManifest({ id: "../escape" })), TemplateValidationError);
  assert.throws(() => parseTemplateManifestJson(baseManifest({ id: "builtin:XIAOYU" })), TemplateValidationError);
  assert.throws(() => parseTemplateManifestJson(baseManifest({ version: "1.0" })), TemplateValidationError);
  assert.throws(() => parseTemplateManifestJson(baseManifest({ license: "All-Rights-Reserved" })), TemplateValidationError);
  assert.throws(() => parseTemplateManifestJson(baseManifest({ schemaVersion: 2 })), TemplateValidationError);
  assert.throws(() => parseTemplateManifestJson("not json"), TemplateValidationError);
});

test("islandStatus must be complete; background requires appearance; codexPet needs both hashes", () => {
  const partial = JSON.parse(baseManifest());
  delete partial.assets.islandStatus.complete;
  assert.throws(() => parseTemplateManifestJson(JSON.stringify(partial)), /齐全/);

  assert.throws(() => parseTemplateManifestJson(baseManifest({
    assets: { background: { image: HASH } }
  })), /appearance/);

  assert.throws(() => parseTemplateManifestJson(baseManifest({
    assets: { codexPet: { manifest: HASH } }
  })), /spritesheet/);

  assert.throws(() => parseTemplateManifestJson(baseManifest({
    assets: { islandStatus: { ...islandStatusAssets(), idle: "XYZ" } }
  })), /sha256/);

  const empty = JSON.parse(baseManifest());
  empty.assets = {};
  assert.throws(() => parseTemplateManifestJson(JSON.stringify(empty)), /之一/);
});

test("satisfiesMinimumVersion compares plain triples", () => {
  assert.equal(satisfiesMinimumVersion("3.1.0", "3.1.0"), true);
  assert.equal(satisfiesMinimumVersion("3.2.1", "3.1.0"), true);
  assert.equal(satisfiesMinimumVersion("2.9.9", "3.1.0"), false);
});

test("validateSvgAsset screens scripts, handlers, external refs and size", () => {
  assert.deepEqual(validateSvgAsset(Buffer.from(CLEAN_SVG), "idle.svg"), []);
  const cases = [
    `<svg xmlns="a"><script>alert(1)</script></svg>`,
    `<svg onload="x()" xmlns="a"></svg>`,
    `<svg xmlns="a" xmlns:xlink="b"><rect xlink:href="http://evil/x.svg"/></svg>`,
    `<svg xmlns="a"><a href="javascript:x()"><rect/></a></svg>`,
    `<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="a"></svg>`,
    `<svg xmlns="a"><foreignObject></foreignObject></svg>`,
    `<svg xmlns="a">no close`
  ];
  for (const evil of cases) {
    assert.notDeepEqual(validateSvgAsset(Buffer.from(evil), "idle.svg"), [], `should reject: ${evil.slice(0, 40)}`);
  }
  const oversize = Buffer.alloc(256 * 1024 + 1, 0x20);
  assert.notDeepEqual(validateSvgAsset(oversize, "idle.svg"), []);
  assert.notDeepEqual(validateSvgAsset(Buffer.from(CLEAN_SVG), "../escape.svg"), []);
});

test("templateDirNameForId makes safe directory names", () => {
  assert.equal(templateDirNameForId("builtin:workisland-xiaoyu"), "builtin-workisland-xiaoyu");
  assert.equal(templateDirNameForId("author.theme"), "author.theme");
  assert.equal(templateDirNameForId("../../etc"), "etc");
});

// ── settings 迁移 ────────────────────────────────────────────────────────────

test("settings merge activates the official template without touching existing appearance/pet", () => {
  const merged = mergeSettings({
    islandAppearance: { kind: "solid", color: "#0B1E3A" },
    petSprite: "my-pet.webp"
  });
  assert.deepEqual(merged.appearanceTemplate, { ...DEFAULT_APPEARANCE_TEMPLATE });
  assert.equal(merged.islandAppearance.color, "#0b1e3a");
  assert.equal(merged.petSprite, "my-pet.webp");
  assert.deepEqual(merged.appearanceOverrides, {});
});

test("invalid persisted template selection resets to official builtin", () => {
  const merged = mergeSettings({
    appearanceTemplate: { id: "../evil", version: "9" },
    appearanceOverrides: { background: { kind: "solid", color: "junk" } }
  });
  assert.deepEqual(merged.appearanceTemplate, { ...DEFAULT_APPEARANCE_TEMPLATE });
  assert.deepEqual(merged.appearanceOverrides, {});
  const custom = mergeSettings({
    appearanceTemplate: { id: "author.theme", version: "2.0.0" },
    appearanceOverrides: { background: { kind: "solid", color: "#101010" } }
  });
  assert.deepEqual(custom.appearanceTemplate, { id: "author.theme", version: "2.0.0" });
  assert.deepEqual(custom.appearanceOverrides.background, { kind: "solid", color: "#101010", opacity: 1 });
});

test("TEMPLATE_SCHEMA_VERSION stays at 1", () => {
  assert.equal(TEMPLATE_SCHEMA_VERSION, 1);
});
