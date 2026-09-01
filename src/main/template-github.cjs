"use strict";

// GitHub static-catalog transport for appearance templates (PRD-018 §7.7).
//
// Download: catalog.json → match id@version → zip from a GitHub Release →
// verify the catalog's sha256 → extract (store-only zips) → hand the staged
// directory to the local template validator.
// Publish: re-validate the zip locally, require an authenticated `gh`, then
// create a Release with the zip as an asset. Failures never report success.
//
// GitHub credentials live exclusively in `gh`; this module never reads,
// prints, or persists tokens.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { TemplateValidationError } = require("../shared/template-manifest.cjs");
const { parseTemplateManifestJson } = require("../shared/template-manifest.cjs");
const { readStoreOnlyZip } = require("./zip-writer.cjs");

const ALLOWED_DOWNLOAD_HOSTS = new Set([
  "github.com",
  "www.github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "codeload.github.com",
  "api.github.com",
  "github-releases.githubusercontent.com"
]);

const MAX_CATALOG_BYTES = 1024 * 1024;
const MAX_ZIP_BYTES = 32 * 1024 * 1024;

function createTemplateGithubTransport({ fetcher, exec, logger } = {}) {
  const doFetch = typeof fetcher === "function" ? fetcher : globalThis.fetch?.bind(globalThis);
  const doExec = typeof exec === "function"
    ? exec
    : (file, args, opts) => new Promise((resolve, reject) => {
      execFile(file, args, { timeout: 60e3, ...opts }, (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr;
          reject(err);
          return;
        }
        resolve(stdout);
      });
    });
  const log = logger ?? { warn() {} };

  function assertAllowedUrl(raw) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new TemplateValidationError(`非法 URL: ${String(raw).slice(0, 120)}`);
    }
    if (url.protocol !== "https:" || !ALLOWED_DOWNLOAD_HOSTS.has(url.hostname)) {
      throw new TemplateValidationError(
        `仅允许 GitHub 官方域名的 https 下载（${[...ALLOWED_DOWNLOAD_HOSTS].slice(0, 3).join(" / ")} …）: ${url.hostname}`
      );
    }
    return url;
  }

  async function fetchJson(url) {
    assertAllowedUrl(url);
    const response = await doFetch(url);
    if (!response.ok) throw new TemplateValidationError(`获取 catalog 失败（HTTP ${response.status}）: ${url}`);
    const text = await response.text();
    if (text.length > MAX_CATALOG_BYTES) throw new TemplateValidationError("catalog 超过 1 MB 上限");
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new TemplateValidationError(`catalog 不是合法 JSON: ${err.message}`);
    }
  }

  async function fetchZipBuffer(url) {
    assertAllowedUrl(url);
    const response = await doFetch(url);
    if (!response.ok) throw new TemplateValidationError(`下载模板 zip 失败（HTTP ${response.status}）: ${url}`);
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_ZIP_BYTES) {
      throw new TemplateValidationError(`模板 zip 大小须在 1–${MAX_ZIP_BYTES} 字节之间（当前 ${buf.length}）`);
    }
    return buf;
  }

  /**
   * Validate a catalog document: { schemaVersion: 1, templates: [...] }.
   * Every entry needs id, version, zipUrl, zipSha256, license.
   */
  function parseCatalog(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new TemplateValidationError("catalog 必须是 JSON 对象");
    }
    if (raw.schemaVersion !== 1) throw new TemplateValidationError("catalog schemaVersion 必须为 1");
    const templates = raw.templates;
    if (!Array.isArray(templates)) throw new TemplateValidationError("catalog.templates 必须是数组");
    const seen = new Set();
    const entries = [];
    for (const entry of templates) {
      if (!entry || typeof entry !== "object") continue;
      const { id, version, zipUrl, zipSha256 } = entry;
      if (typeof id !== "string" || typeof version !== "string" || typeof zipUrl !== "string" || typeof zipSha256 !== "string") {
        log.warn("[TemplateGithub] skipping malformed catalog entry");
        continue;
      }
      if (!/^[0-9a-f]{64}$/.test(zipSha256)) continue;
      const key = `${id}@${version}`;
      if (seen.has(key)) throw new TemplateValidationError(`catalog 存在重复条目: ${key}`);
      seen.add(key);
      entries.push(entry);
    }
    return entries;
  }

  /**
   * Download + hash-verify + extract to a staging dir. Returns
   * { dir, stagingDir, zipSha256 } — the caller validates and installs the
   * staged package, then cleanupStaging().
   */
  async function downloadTemplateFromCatalog({ id, version, catalogUrl }) {
    const catalog = await fetchJson(catalogUrl);
    const entries = parseCatalog(catalog);
    const matched = version === "*"
      ? entries.filter((entry) => entry.id === id).sort(compareVersionsDesc)[0]
      : entries.find((entry) => entry.id === id && entry.version === version);
    if (!matched) {
      throw new TemplateValidationError(`catalog 中没有模板 ${id}@${version}`);
    }
    const zipBuffer = await fetchZipBuffer(matched.zipUrl);
    const actualHash = crypto.createHash("sha256").update(zipBuffer).digest("hex");
    if (actualHash !== matched.zipSha256) {
      throw new TemplateValidationError(
        `zip 哈希与 catalog 不符（catalog ${matched.zipSha256.slice(0, 12)}… / 实际 ${actualHash.slice(0, 12)}…），拒绝安装`
      );
    }
    const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "wi-tpl-download-"));
    try {
      const zipPath = path.join(stagingDir, "template.zip");
      fs.writeFileSync(zipPath, zipBuffer);
      let entriesOfZip;
      try {
        entriesOfZip = readStoreOnlyZip(zipPath);
      } catch (err) {
        throw new TemplateValidationError(`模板 zip 无法读取（仅支持 store 无压缩 zip，导出工具即此格式）: ${err.message}`);
      }
      const packageRoot = path.join(stagingDir, "package");
      for (const entry of entriesOfZip) {
        const name = String(entry.name);
        if (name.startsWith("/") || name.split("/").includes("..")) {
          throw new TemplateValidationError(`zip 内非法路径: ${name}`);
        }
        const target = path.join(packageRoot, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, entry.data);
      }
      // The manifest must sit at the package root (or one level below when
      // authors zip a containing folder).
      const manifestPath = fs.existsSync(path.join(packageRoot, "template.json"))
        ? path.join(packageRoot, "template.json")
        : locateNestedManifest(packageRoot);
      if (!manifestPath) throw new TemplateValidationError("zip 内缺少 template.json");
      const manifest = parseTemplateManifestJson(fs.readFileSync(manifestPath, "utf8"));
      if (manifest.id !== matched.id) {
        throw new TemplateValidationError(`zip 内模板 id（${manifest.id}）与 catalog 条目（${matched.id}）不一致`);
      }
      return { dir: path.dirname(manifestPath), stagingDir, zipSha256: actualHash };
    } catch (err) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      throw err;
    }
  }

  function locateNestedManifest(root) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const candidate = path.join(root, entry.name, "template.json");
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    return null;
  }

  async function publishTemplateZip({ zipPath, repo }) {
    if (!fs.existsSync(zipPath) || !fs.statSync(zipPath).isFile()) {
      throw new TemplateValidationError(`zip 不存在: ${zipPath}`);
    }
    const { size } = fs.statSync(zipPath);
    if (size > MAX_ZIP_BYTES) throw new TemplateValidationError("zip 超过 32 MB 上限");
    // Local re-validation before anything leaves the machine: extract and
    // run the same manifest/zip cross-checks the installer uses.
    let entries;
    try {
      entries = readStoreOnlyZip(zipPath);
    } catch (err) {
      throw new TemplateValidationError(`zip 无法读取: ${err.message}`);
    }
    const manifestEntry = entries.find((entry) => entry.name === "template.json" || entry.name.endsWith("/template.json"));
    if (!manifestEntry) throw new TemplateValidationError("zip 内缺少 template.json");
    const manifest = parseTemplateManifestJson(manifestEntry.data.toString("utf8"));
    const zipSha256 = crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");

    // gh must be installed and authenticated; tokens never pass through us.
    try {
      await doExec("gh", ["auth", "status"]);
    } catch (err) {
      throw new TemplateValidationError(
        `gh 未安装或未登录（${err.message?.split("\n")[0] ?? "unknown"}）。请先安装 gh 并执行 gh auth login。`
      );
    }
    const tag = `templates-${manifest.id.replace(/[^A-Za-z0-9.-]+/g, "-")}-v${manifest.version}`;
    try {
      await doExec("gh", ["release", "view", tag, "--repo", repo]);
      throw new TemplateValidationError(`Release ${tag} 已存在于 ${repo}；请升版本号后重试`);
    } catch (err) {
      if (!err || typeof err.message !== "string" || !err.message.includes("已存在")) {
        // "not found" is the expected outcome — create below.
      } else {
        throw err;
      }
    }
    const releaseUrl = (await doExec("gh", [
      "release", "create", tag, zipPath,
      "--repo", repo,
      "--title", `${manifest.name} ${manifest.version}`,
      "--notes", `WorkIsland appearance template ${manifest.id}@${manifest.version} (sha256 ${zipSha256})`
    ])).trim();
    return {
      published: true,
      releaseUrl,
      tag,
      zipSha256,
      catalogEntry: {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        author: manifest.author,
        license: manifest.license,
        // `gh release create` returns the human-facing tag page
        // (`…/releases/tag/<tag>`), not an asset base URL. Build the stable
        // GitHub asset endpoint explicitly so a catalog entry is immediately
        // usable by `template download`.
        zipUrl: `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(path.basename(zipPath))}`,
        zipSha256,
        modules: Object.keys(manifest.assets)
      },
      nextStep: `请在 ${repo} 仓库把上面的 catalogEntry 合并进 catalog.json 的 templates 数组（开 PR），用户即可 download。`
    };
  }

  function cleanupStaging(stagingDir) {
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      // Best effort only.
    }
  }

  function compareVersionsDesc(a, b) {
    const pa = String(a.version).split(".").map(Number);
    const pb = String(b.version).split(".").map(Number);
    for (let i = 0; i < 3; i += 1) {
      if (pb[i] !== pa[i]) return (pb[i] ?? 0) - (pa[i] ?? 0);
    }
    return 0;
  }

  return {
    downloadTemplateFromCatalog,
    publishTemplateZip,
    cleanupStaging,
    parseCatalog
  };
}

module.exports = { createTemplateGithubTransport, ALLOWED_DOWNLOAD_HOSTS };
