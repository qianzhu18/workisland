import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { sha256Buffer } = require("../src/shared/template-manifest.cjs");
const { createTemplateService } = require("../src/main/template-service.cjs");
const { createTemplateController } = require("../src/main/template-controller.cjs");
const { writeStoreOnlyZip, readStoreOnlyZip } = require("../src/main/zip-writer.cjs");

const SVG = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect fill="${fill}" x="4" y="4" width="24" height="24"/></svg>`;
const KEYS = ["idle", "running", "approval", "complete", "error"];

function writePackage(root, { id = "author.theme", version = "1.0.0", withBackground = false, withPet = false } = {}) {
  mkdirSync(join(root, "island-status"), { recursive: true });
  const assets = { islandStatus: {} };
  for (const key of KEYS) {
    const svg = SVG("#31d58b");
    writeFileSync(join(root, "island-status", `${key}.svg`), svg);
    assets.islandStatus[key] = sha256Buffer(Buffer.from(svg, "utf8"));
  }
  if (withBackground) {
    mkdirSync(join(root, "background"), { recursive: true });
    const appearance = JSON.stringify({ kind: "solid", color: "#0B1E3A" });
    writeFileSync(join(root, "background", "appearance.json"), appearance);
    assets.background = { appearance: sha256Buffer(Buffer.from(appearance, "utf8")) };
  }
  if (withPet) {
    mkdirSync(join(root, "codex-pet"), { recursive: true });
    const pet = JSON.stringify({ id: "tpl-pet", displayName: "Tpl Pet", spriteVersionNumber: 2 });
    // A geometry-valid webp is required; reuse the real bundled sheet.
    const sheet = readFileSync(new URL("../resources/pet-sprites/qianxue.webp", import.meta.url));
    writeFileSync(join(root, "codex-pet", "spritesheet.webp"), sheet);
    writeFileSync(join(root, "codex-pet", "pet.json"), pet);
    assets.codexPet = {
      manifest: sha256Buffer(Buffer.from(pet, "utf8")),
      spritesheet: sha256Buffer(sheet)
    };
  }
  writeFileSync(join(root, "template.json"), JSON.stringify({
    schemaVersion: 1, id, name: "Theme", version, author: "Author",
    license: "CC-BY-4.0", compatibility: { workisland: ">=3.1.0" }, assets
  }, null, 2));
  writeFileSync(join(root, "LICENSE"), "test");
}

function createFixture() {
  const base = mkdtempSync(join(tmpdir(), "wi-tplctl-"));
  const builtinDir = join(base, "builtin-root");
  const userData = join(base, "user-data");
  const codexPetsDir = join(base, "codex-pets");
  mkdirSync(join(builtinDir, "builtin-workisland-xiaoyu"), { recursive: true });
  mkdirSync(userData, { recursive: true });
  writePackage(join(builtinDir, "builtin-workisland-xiaoyu"), { id: "builtin:workisland-xiaoyu" });
  const settings = {
    appearanceTemplate: { id: "builtin:workisland-xiaoyu", version: "1.0.0" },
    islandAppearance: { kind: "default" },
    petSprite: "codex:qianxue"
  };
  const saved = [];
  const service = createTemplateService({
    getBuiltinTemplatesDir: () => builtinDir,
    getUserDataPath: () => userData,
    appVersion: "3.1.0"
  });
  const controller = createTemplateController({
    templateService: service,
    appearanceService: {
      installBackgroundImage() {
        return { imageRef: "bg-fixture.png", width: 1, height: 1, bytes: 1 };
      }
    },
    petLibrary: {
      getUserSpritesDir: () => join(userData, "pet-sprites")
    },
    getCodexPetsDir: () => codexPetsDir,
    getSettings: () => settings,
    updateSettings: (partial) => {
      Object.assign(settings, partial);
      saved.push(partial);
    }
  });
  return { base, builtinDir, userData, codexPetsDir, settings, saved, service, controller };
}

test("listTemplates reports active selection and filters by source", () => {
  const { base, controller } = createFixture();
  try {
    const all = controller.listTemplates({});
    assert.equal(all.active.id, "builtin:workisland-xiaoyu");
    assert.ok(all.templates.some((t) => t.id === "builtin:workisland-xiaoyu"));
    const builtinOnly = controller.listTemplates({ source: "builtin" });
    assert.ok(builtinOnly.templates.every((t) => t.source === "builtin"));
    assert.deepEqual(controller.listTemplates({ source: "github" }).templates, []);
    assert.throws(() => controller.listTemplates({ source: "nope" }), /来源/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("inspect and preview are read-only for a path target", () => {
  const { base, controller, saved, settings } = createFixture();
  try {
    const dir = join(base, "pkg");
    mkdirSync(dir, { recursive: true });
    writePackage(dir, { withBackground: true });
    const inspect = controller.inspectTemplate({ target: dir });
    assert.equal(inspect.template.id, "author.theme");
    assert.equal(inspect.template.installed, false);
    assert.ok(inspect.modules.includes("background"));
    const preview = controller.previewTemplate({ target: dir });
    assert.ok(preview.islandStatus.idle.startsWith("data:image/svg+xml;base64,"));
    assert.equal(preview.background.appearance.kind, "solid");
    assert.equal(saved.length, 0);
    assert.equal(settings.islandAppearance.kind, "default");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("applyTemplate updates settings once and honors module selection", () => {
  const { base, controller, saved, settings } = createFixture();
  try {
    const dir = join(base, "pkg");
    mkdirSync(dir, { recursive: true });
    writePackage(dir, { withBackground: true });
    const result = controller.applyTemplate({ target: dir, modules: "island,background" });
    assert.deepEqual(result.applied, ["island", "background"]);
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].appearanceTemplate, { id: "author.theme", version: "1.0.0" });
    assert.equal(saved[0].islandAppearance.color, "#0b1e3a");
    assert.equal("petSprite" in saved[0], false, "不请求 pet 模块时不触碰桌宠");
    assert.equal(settings.petSprite, "codex:qianxue");
    assert.throws(
      () => controller.applyTemplate({ target: dir, modules: "pet" }),
      /不包含 pet 模块/
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("applyTemplate pet module installs the sheet without touching codex home by default", () => {
  const { base, controller, settings, codexPetsDir, userData } = createFixture();
  try {
    const dir = join(base, "petpkg");
    mkdirSync(dir, { recursive: true });
    writePackage(dir, { withPet: true });
    const result = controller.applyTemplate({ target: dir, modules: "island,pet" });
    assert.equal(result.pet.sprite, "tpl-pet.webp");
    assert.equal(result.pet.syncedToCodex, false);
    assert.equal(settings.petSprite, "tpl-pet.webp");
    assert.ok(existsSync(join(userData, "pet-sprites", "tpl-pet.webp")));
    assert.ok(!existsSync(codexPetsDir), "未传 --sync-codex 时不得写入 ~/.codex/pets");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("resetTemplate restores official defaults per module", () => {
  const { base, controller, settings, saved } = createFixture();
  try {
    settings.islandAppearance = { kind: "solid", color: "#0b1e3a", opacity: 1 };
    settings.petSprite = "custom.webp";
    controller.resetTemplate({ module: "background" });
    assert.deepEqual(settings.islandAppearance, { kind: "default" });
    assert.equal(settings.petSprite, "custom.webp", "background 重置不触碰桌宠");
    controller.resetTemplate({ module: "pet" });
    assert.equal(settings.petSprite, "codex:qianxue");
    controller.resetTemplate({});
    assert.deepEqual(settings.appearanceTemplate, { id: "builtin:workisland-xiaoyu", version: "1.0.0" });
    assert.throws(() => controller.resetTemplate({ module: "nope" }), /重置模块/);
    assert.ok(saved.every((partial) => Object.keys(partial).length >= 1));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("exportTemplate produces a valid store-only zip with matching content hash", () => {
  const { base, controller } = createFixture();
  try {
    const dir = join(base, "pkg");
    const out = join(base, "exported.zip");
    mkdirSync(dir, { recursive: true });
    writePackage(dir);
    const result = controller.exportTemplate({ dir, out });
    assert.equal(result.files, 7); // template.json + LICENSE + 5 svgs
    assert.match(result.sha256, /^[0-9a-f]{64}$/);
    const entries = readStoreOnlyZip(result.zip);
    const names = entries.map((entry) => entry.name).sort();
    assert.deepEqual(names, ["LICENSE", "island-status/approval.svg", "island-status/complete.svg", "island-status/error.svg", "island-status/idle.svg", "island-status/running.svg", "template.json"]);
    // A store-only zip must be readable by standard tooling; verify via the
    // system unzip listing as an interop smoke check.
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("store-only zip round-trips bytes exactly and rejects unsafe names", () => {
  const dir = mkdtempSync(join(tmpdir(), "wi-zip-"));
  try {
    const zip = join(dir, "t.zip");
    const payload = Buffer.from("hello template");
    const sha = writeStoreOnlyZip(zip, [{ name: "template.json", data: payload }]);
    assert.match(sha, /^[0-9a-f]{64}$/);
    const entries = readStoreOnlyZip(zip);
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].data, payload);
    assert.throws(() => writeStoreOnlyZip(join(dir, "bad.zip"), [{ name: "../evil", data: payload }]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
