import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { sha256Buffer } = require("../src/shared/template-manifest.cjs");
const { writeStoreOnlyZip } = require("../src/main/zip-writer.cjs");
const { createTemplateGithubTransport } = require("../src/main/template-github.cjs");
const { createTemplateService } = require("../src/main/template-service.cjs");
const { createTemplateController } = require("../src/main/template-controller.cjs");

const SVG = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect fill="${fill}" x="4" y="4" width="24" height="24"/></svg>`;
const KEYS = ["idle", "running", "approval", "complete", "error"];

function buildPackageZip(files) {
  const dir = mkdtempSync(join(tmpdir(), "wi-gh-src-"));
  mkdirSync(join(dir, "island-status"), { recursive: true });
  const assets = { islandStatus: {} };
  for (const key of KEYS) {
    const svg = SVG("#31d58b");
    writeFileSync(join(dir, "island-status", `${key}.svg`), svg);
    assets.islandStatus[key] = sha256Buffer(Buffer.from(svg, "utf8"));
  }
  writeFileSync(join(dir, "template.json"), JSON.stringify({
    schemaVersion: 1, id: "author.remote", name: "Remote", version: "1.0.0",
    author: "A", license: "CC-BY-4.0", compatibility: { workisland: ">=3.1.0" }, assets
  }, null, 2));
  writeFileSync(join(dir, "LICENSE"), "t");
  const zipPath = join(dir, "pkg.zip");
  const zipFiles = [
    { name: "template.json", data: readFileSync(join(dir, "template.json")) },
    { name: "LICENSE", data: readFileSync(join(dir, "LICENSE")) },
    ...KEYS.map((key) => ({ name: `island-status/${key}.svg`, data: readFileSync(join(dir, "island-status", `${key}.svg`)) }))
  ];
  const zipSha = writeStoreOnlyZip(zipPath, zipFiles);
  const zipData = readFileSync(zipPath);
  rmSync(dir, { recursive: true, force: true });
  return { zipPath, zipData, zipSha };
}

function createCatalogFixture({ tamperHash = false } = {}) {
  const { zipPath, zipData, zipSha } = buildPackageZip();
  const catalog = {
    schemaVersion: 1,
    templates: [{
      id: "author.remote",
      name: "Remote",
      version: "1.0.0",
      zipUrl: "https://github.com/example/workisland-templates/releases/download/templates-author-remote-v1.0.0/pkg.zip",
      zipSha256: tamperHash ? "0".repeat(64) : zipSha
    }]
  };
  return { zipData, catalog, zipSha };
}

function createFetchFixture({ tamperHash = false } = {}) {
  const { zipData, catalog } = createCatalogFixture({ tamperHash });
  return async (url) => {
    if (url.includes("catalog")) {
      return { ok: true, text: async () => JSON.stringify(catalog) };
    }
    return { ok: true, arrayBuffer: async () => zipData };
  };
}

function fixtureController(transport) {
  const base = mkdtempSync(join(tmpdir(), "wi-gh-app-"));
  const userData = join(base, "ud");
  mkdirSync(userData, { recursive: true });
  const service = createTemplateService({
    getBuiltinTemplatesDir: () => join(base, "none"),
    getUserDataPath: () => userData,
    appVersion: "3.1.0"
  });
  const controller = createTemplateController({
    templateService: service,
    appearanceService: null,
    petLibrary: { getUserSpritesDir: () => join(userData, "pet-sprites") },
    getCodexPetsDir: () => join(base, "codex-pets"),
    getSettings: () => ({}),
    updateSettings: () => {},
    github: transport
  });
  return { base, controller };
}

test("downloadTemplate installs a hash-verified catalog package", async () => {
  const transport = createTemplateGithubTransport({ fetcher: createFetchFixture() });
  const { base, controller } = fixtureController(transport);
  try {
    const result = await controller.downloadTemplate({
      id: "author.remote",
      version: "1.0.0",
      catalog: "https://raw.githubusercontent.com/example/workisland-templates/main/catalog.json"
    });
    assert.equal(result.installed, true);
    assert.equal(result.id, "author.remote");
    assert.match(result.zipSha256, /^[0-9a-f]{64}$/);
    // The installed package must pass the local validator.
    const validation = controller.validateTemplate({ target: result.dir });
    assert.equal(validation.ok, true);
    await assert.rejects(
      () => controller.downloadTemplate({ id: "author.missing", version: "*", catalog: "https://raw.githubusercontent.com/x/y/main/catalog.json" }),
      /catalog 中没有模板/
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("downloadTemplate rejects hash mismatches and non-GitHub hosts", async () => {
  const tampered = createTemplateGithubTransport({ fetcher: createFetchFixture({ tamperHash: true }) });
  const { base: b1, controller: c1 } = fixtureController(tampered);
  try {
    await assert.rejects(
      () => c1.downloadTemplate({ id: "author.remote", version: "1.0.0", catalog: "https://raw.githubusercontent.com/x/y/main/catalog.json" }),
      /哈希与 catalog 不符/
    );
  } finally {
    rmSync(b1, { recursive: true, force: true });
  }
  const clean = createTemplateGithubTransport({ fetcher: createFetchFixture() });
  const { base: b2, controller: c2 } = fixtureController(clean);
  try {
    await assert.rejects(
      () => c2.downloadTemplate({ id: "author.remote", version: "1.0.0", catalog: "https://evil.example.com/catalog.json" }),
      /仅允许 GitHub 官方域名/
    );
  } finally {
    rmSync(b2, { recursive: true, force: true });
  }
});

test("publishTemplate requires --confirm, gh auth, and refuses duplicates", async () => {
  const { zipPath, zipData } = buildPackageZip();
  // buildPackageZip cleans its source dir; repersist the zip for the exec path.
  const keepZip = join(tmpdir(), `wi-gh-keep-${process.pid}.zip`);
  writeFileSync(keepZip, zipData);
  const ghCalls = [];
  const transport = createTemplateGithubTransport({
    exec: async (file, args) => {
      ghCalls.push(args[0]);
      if (args[0] === "auth" && args[1] === "status") return "Logged in";
      if (args[0] === "release" && args[1] === "view") {
        const error = new Error("release not found");
        throw error;
      }
      if (args[0] === "release" && args[1] === "create") return "https://github.com/example/repo/releases/tag/t1";
      return "";
    }
  });
  const { base, controller } = fixtureController(transport);
  try {
    await assert.rejects(
      () => controller.publishTemplate({ zip: keepZip, repo: "example/repo" }),
      /--confirm/
    );
    const published = await controller.publishTemplate({ zip: keepZip, repo: "example/repo", confirm: true });
    assert.equal(published.published, true);
    assert.match(published.releaseUrl, /^https:\/\/github\.com\//);
    assert.equal(published.catalogEntry.id, "author.remote");
    assert.equal(
      published.catalogEntry.zipUrl,
      `https://github.com/example/repo/releases/download/templates-author.remote-v1.0.0/${keepZip.split("/").at(-1)}`
    );
    assert.match(published.catalogEntry.zipSha256, /^[0-9a-f]{64}$/);
    assert.ok(published.nextStep.includes("catalog.json"));
    assert.deepEqual(ghCalls.filter((cmd) => cmd === "auth" || cmd === "release"), ["auth", "release", "release"]);
  } finally {
    rmSync(keepZip, { force: true });
    rmSync(base, { recursive: true, force: true });
  }
});

test("publishTemplate fails cleanly when gh is unavailable", async () => {
  const { zipData } = buildPackageZip();
  const keepZip = join(tmpdir(), `wi-gh-keep2-${process.pid}.zip`);
  writeFileSync(keepZip, zipData);
  const transport = createTemplateGithubTransport({
    exec: async () => {
      throw new Error("gh: command not found");
    }
  });
  const { base, controller } = fixtureController(transport);
  try {
    await assert.rejects(
      () => controller.publishTemplate({ zip: keepZip, repo: "example/repo", confirm: true }),
      /gh 未安装或未登录/
    );
  } finally {
    rmSync(keepZip, { force: true });
    rmSync(base, { recursive: true, force: true });
  }
});

test("catalog parser rejects duplicates and malformed entries", () => {
  const transport = createTemplateGithubTransport({ fetcher: async () => ({ ok: true, text: async () => "{}" }) });
  assert.equal(transport.parseCatalog({ schemaVersion: 1, templates: [{ id: "a", version: "1.0.0", zipUrl: "u", zipSha256: "0".repeat(64) }, { junk: 1 }] }).length, 1);
  assert.throws(
    () => transport.parseCatalog({
      schemaVersion: 1,
      templates: [
        { id: "a", version: "1.0.0", zipUrl: "u", zipSha256: "0".repeat(64) },
        { id: "a", version: "1.0.0", zipUrl: "u", zipSha256: "0".repeat(64) }
      ]
    }),
    /重复/
  );
  assert.throws(() => transport.parseCatalog({ schemaVersion: 2, templates: [] }), /schemaVersion/);
});
