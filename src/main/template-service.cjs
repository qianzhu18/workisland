"use strict";

// Appearance template runtime (PRD-018 §7.3/§7.4).
//
// Owns the template lifecycle: validate a package directory (manifest +
// per-asset hash + static SVG screening), list builtin/installed templates,
// install user packages via staging + atomic rename, and resolve the ACTIVE
// template's island-status assets as data URLs for the renderer.
//
// Failure policy: any error while resolving the active template falls back
// to the official builtin:workisland-xiaoyu package; if even that fails the
// renderer keeps its build-time assets — the island never shows blank icons.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  ISLAND_STATUS_KEYS,
  ISLAND_STATUS_FILES,
  TemplateValidationError,
  sha256Buffer,
  satisfiesMinimumVersion,
  parseTemplateManifestJson,
  validateSvgAsset,
  validateBackgroundImageAsset,
  validateSpritesheetAsset,
  templateDirNameForId
} = require("../shared/template-manifest.cjs");
const { normalizeIslandAppearance } = require("../shared/appearance.cjs");
const { readImageDimensions, SPRITE_SHEET_CONTRACTS } = require("./pet-library.cjs");

const OFFICIAL_TEMPLATE_ID = "builtin:workisland-xiaoyu";
const LICENSE_FILES = ["LICENSE", "LICENSE.md", "LICENSE.txt"];

function createTemplateService({ getBuiltinTemplatesDir, getUserDataPath, appVersion }) {
  if (typeof getBuiltinTemplatesDir !== "function" || typeof getUserDataPath !== "function") {
    throw new TypeError("createTemplateService requires directory providers");
  }

  function getUserTemplatesDir() {
    return path.join(getUserDataPath(), "appearance-templates");
  }

  function builtinTemplateDir(id) {
    return path.join(getBuiltinTemplatesDir(), templateDirNameForId(id));
  }

  /**
   * Resolve `id` + optional `version` to a package directory. Builtin ids
   * resolve against the packaged resources; everything else must already be
   * installed under <userData>/appearance-templates/<safe-id>/<version>/.
   * Version "*" (or omitted) picks the highest installed version.
   */
  function resolveTemplateDir(id, version) {
    if (typeof id !== "string" || id.length === 0) {
      throw new TemplateValidationError("缺少模板 id");
    }
    if (id.startsWith("builtin:")) {
      const dir = builtinTemplateDir(id);
      if (!fs.existsSync(path.join(dir, "template.json"))) {
        throw new TemplateValidationError(`内置模板不存在: ${id}`);
      }
      return dir;
    }
    const base = path.join(getUserTemplatesDir(), templateDirNameForId(id));
    if (!fs.existsSync(base)) {
      throw new TemplateValidationError(`模板未安装: ${id}`);
    }
    const versions = fs.readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort(compareVersions);
    if (versions.length === 0) {
      throw new TemplateValidationError(`模板 ${id} 没有任何已安装版本`);
    }
    if (version && version !== "*") {
      if (!versions.includes(version)) {
        throw new TemplateValidationError(`模板 ${id} 未安装版本 ${version}（可用: ${versions.join(", ")}）`);
      }
      return path.join(base, version);
    }
    // compareVersions sorts newest-first; "*" resolves to the highest.
    return path.join(base, versions[0]);
  }

  /**
   * Fully validate a template package directory. Returns a structured
   * result — never throws for ordinary invalid packages so the CLI can show
   * every problem at once (author workflow: validate → fix → retry).
   */
  function validateTemplateDir(dir) {
    const result = { ok: false, manifest: null, modules: [], errors: [], warnings: [] };
    const root = typeof dir === "string" ? path.resolve(dir.trim()) : "";
    if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      result.errors.push(`模板目录不存在或不是目录: ${dir}`);
      return result;
    }
    let manifestText;
    try {
      const manifestPath = path.join(root, "template.json");
      const stat = fs.statSync(manifestPath);
      if (!stat.isFile()) throw new Error("not a file");
      manifestText = fs.readFileSync(manifestPath, "utf8");
    } catch {
      result.errors.push("缺少 template.json");
      return result;
    }
    let manifest;
    try {
      manifest = parseTemplateManifestJson(manifestText);
    } catch (err) {
      result.errors.push(err.message);
      return result;
    }
    result.manifest = manifest;

    if (!LICENSE_FILES.some((name) => fs.existsSync(path.join(root, name)))) {
      result.errors.push("缺少 LICENSE 文件");
    }
    if (manifest.compatibility.workislandMinimum && appVersion) {
      if (!satisfiesMinimumVersion(appVersion, manifest.compatibility.workislandMinimum)) {
        result.errors.push(
          `应用版本 ${appVersion} 低于模板要求 ${manifest.compatibility.workislandMinimum}`
        );
      }
    }

    if (manifest.assets.islandStatus) {
      result.modules.push("island");
      for (const key of ISLAND_STATUS_KEYS) {
        const fileName = ISLAND_STATUS_FILES[key];
        const filePath = path.join(root, "island-status", fileName);
        const buf = readFileOrNull(filePath);
        if (!buf) {
          result.errors.push(`缺少 island-status/${fileName}`);
          continue;
        }
        result.errors.push(...validateSvgAsset(buf, fileName));
        const actual = sha256Buffer(buf);
        if (actual !== manifest.assets.islandStatus[key]) {
          result.errors.push(
            `island-status/${fileName} 哈希不符（期望 ${manifest.assets.islandStatus[key].slice(0, 12)}…，实际 ${actual.slice(0, 12)}…）`
          );
        }
      }
    }

    if (manifest.assets.background) {
      result.modules.push("background");
      const appearancePath = path.join(root, "background", "appearance.json");
      const appearanceBuf = readFileOrNull(appearancePath);
      if (!appearanceBuf) {
        result.errors.push("缺少 background/appearance.json");
      } else {
        let rawAppearance;
        try {
          rawAppearance = JSON.parse(appearanceBuf.toString("utf8"));
        } catch (err) {
          result.errors.push(`background/appearance.json 解析失败: ${err.message}`);
        }
        if (rawAppearance !== undefined) {
          try {
            normalizeIslandAppearance(rawAppearance);
          } catch (err) {
            result.errors.push(`background/appearance.json 主题不合法: ${err.message}`);
          }
        }
        if (sha256Buffer(appearanceBuf) !== manifest.assets.background.appearance) {
          result.errors.push("background/appearance.json 哈希不符");
        }
      }
      if (manifest.assets.background.image) {
        const imageDir = path.join(root, "background");
        // v1 manifests pin the image by hash only; the package ships exactly
        // one image file, and the hash check below is the real gate.
        const imageFile = findReferencedImage(imageDir);
        if (!imageFile) {
          result.errors.push("manifest 声明了 background.image 但 background/ 中没有合规图片");
        } else {
          const buf = fs.readFileSync(imageFile);
          result.errors.push(...validateBackgroundImageAsset(buf, path.basename(imageFile)));
          if (sha256Buffer(buf) !== manifest.assets.background.image) {
            result.errors.push("背景图哈希不符");
          }
        }
      }
    }

    if (manifest.assets.codexPet) {
      result.modules.push("pet");
      const manifestPath = path.join(root, "codex-pet", "pet.json");
      const petManifestBuf = readFileOrNull(manifestPath);
      if (!petManifestBuf) {
        result.errors.push("缺少 codex-pet/pet.json");
      } else {
        if (sha256Buffer(petManifestBuf) !== manifest.assets.codexPet.manifest) {
          result.errors.push("codex-pet/pet.json 哈希不符");
        }
        try {
          const petManifest = JSON.parse(petManifestBuf.toString("utf8"));
          if (petManifest.spriteVersionNumber !== 2) {
            result.errors.push("codex-pet/pet.json 必须 spriteVersionNumber=2");
          }
        } catch (err) {
          result.errors.push(`codex-pet/pet.json 解析失败: ${err.message}`);
        }
      }
      const sheetPath = path.join(root, "codex-pet", "spritesheet.webp");
      const sheetBuf = readFileOrNull(sheetPath);
      if (!sheetBuf) {
        result.errors.push("缺少 codex-pet/spritesheet.webp");
      } else {
        result.errors.push(...validateSpritesheetAsset(sheetBuf, "spritesheet.webp"));
        if (sha256Buffer(sheetBuf) !== manifest.assets.codexPet.spritesheet) {
          result.errors.push("codex-pet/spritesheet.webp 哈希不符");
        }
        const dimensions = readImageDimensions(sheetBuf, ".webp");
        if (!dimensions || dimensions.width !== SPRITE_SHEET_CONTRACTS["codex-v2"].width || dimensions.height !== SPRITE_SHEET_CONTRACTS["codex-v2"].height) {
          result.errors.push("codex-pet/spritesheet.webp 不符合 Codex V2 几何（1536×2288）");
        }
      }
    }

    result.ok = result.errors.length === 0;
    return result;
  }

  /**
   * Install a validated template directory into the user area:
   * copy → staging → verify → atomic rename. Any failure removes the
   * staging directory and leaves existing installs untouched.
   */
  function installTemplateFromDir(sourceDir) {
    const validation = validateTemplateDir(sourceDir);
    if (!validation.ok) {
      const error = new TemplateValidationError(
        `模板校验失败: ${validation.errors.slice(0, 3).join("; ")}${validation.errors.length > 3 ? `（共 ${validation.errors.length} 项）` : ""}`
      );
      error.code = "TEMPLATE_VALIDATION_FAILED";
      error.validation = validation;
      throw error;
    }
    const manifest = validation.manifest;
    const targetBase = path.join(getUserTemplatesDir(), templateDirNameForId(manifest.id));
    const staging = path.join(targetBase, `.staging-${crypto.randomUUID()}`);
    fs.mkdirSync(staging, { recursive: true });
    try {
      copyPackageContents(path.resolve(sourceDir.trim()), staging);
      const staged = validateTemplateDir(staging);
      if (!staged.ok) {
        throw new TemplateValidationError(`staging 复验失败: ${staged.errors.join("; ")}`);
      }
      const finalDir = path.join(targetBase, manifest.version);
      if (fs.existsSync(finalDir)) {
        // Idempotent reinstall of the exact same version.
        const existing = validateTemplateDir(finalDir);
        if (existing.ok) {
          fs.rmSync(staging, { recursive: true, force: true });
          return { installed: true, id: manifest.id, version: manifest.version, dir: finalDir, replaced: true };
        }
        fs.rmSync(finalDir, { recursive: true, force: true });
      }
      fs.renameSync(staging, finalDir);
      return { installed: true, id: manifest.id, version: manifest.version, dir: finalDir, replaced: false };
    } catch (err) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw err;
    }
  }

  function listTemplates() {
    const templates = [];
    // Builtin packages ship with the app; list every validated one.
    const builtinRoot = getBuiltinTemplatesDir();
    if (fs.existsSync(builtinRoot)) {
      for (const entry of fs.readdirSync(builtinRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(builtinRoot, entry.name);
        const validation = validateTemplateDir(dir);
        if (!validation.ok || !validation.manifest.id.startsWith("builtin:")) continue;
        templates.push(summaryOf(validation.manifest, "builtin", validation.modules, dir));
      }
    }
    const userRoot = getUserTemplatesDir();
    if (fs.existsSync(userRoot)) {
      for (const idEntry of fs.readdirSync(userRoot, { withFileTypes: true })) {
        if (!idEntry.isDirectory() || idEntry.name.startsWith(".")) continue;
        const idBase = path.join(userRoot, idEntry.name);
        for (const versionEntry of fs.readdirSync(idBase, { withFileTypes: true })) {
          if (!versionEntry.isDirectory() || !/^\d+\.\d+\.\d+$/.test(versionEntry.name)) continue;
          const dir = path.join(idBase, versionEntry.name);
          const validation = validateTemplateDir(dir);
          if (!validation.ok) {
            templates.push({
              id: idEntry.name, version: versionEntry.name, name: idEntry.name, author: "",
              license: "", modules: [], source: "local", valid: false,
              errors: validation.errors.slice(0, 3), dir
            });
            continue;
          }
          templates.push(summaryOf(validation.manifest, "local", validation.modules, dir));
        }
      }
    }
    return templates;
  }

  /**
   * Resolve the five island-status SVGs of a template as data URLs.
   * Any failure falls back to the official builtin package; if that fails
   * too, returns { assets: null } and the renderer keeps build-time assets.
   */
  function resolveStatusAssets(id, version) {
    try {
      const dir = resolveTemplateDir(id, version);
      const validation = validateTemplateDir(dir);
      if (!validation.ok || !validation.manifest.assets.islandStatus) {
        throw new TemplateValidationError(`模板不含有效的 islandStatus 模块: ${id}`);
      }
      return { assets: readStatusDataUrls(path.join(dir, "island-status")), source: validation.manifest.id, version: validation.manifest.version };
    } catch (err) {
      if (id === OFFICIAL_TEMPLATE_ID) return { assets: null, source: null, error: err.message };
      try {
        const dir = resolveTemplateDir(OFFICIAL_TEMPLATE_ID);
        const validation = validateTemplateDir(dir);
        if (!validation.ok) throw new Error(validation.errors.join("; "));
        return { assets: readStatusDataUrls(path.join(dir, "island-status")), source: OFFICIAL_TEMPLATE_ID, version: validation.manifest.version, fallbackFrom: String(id), fallbackReason: err.message };
      } catch (fallbackErr) {
        return { assets: null, source: null, error: fallbackErr.message };
      }
    }
  }

  function readStatusDataUrls(islandStatusDir) {
    const assets = {};
    for (const key of ISLAND_STATUS_KEYS) {
      const buf = fs.readFileSync(path.join(islandStatusDir, ISLAND_STATUS_FILES[key]));
      assets[key] = `data:image/svg+xml;base64,${buf.toString("base64")}`;
    }
    return assets;
  }

  function readFileOrNull(filePath) {
    try {
      if (!fs.statSync(filePath).isFile()) return null;
      return fs.readFileSync(filePath);
    } catch {
      return null;
    }
  }

  function summaryOf(manifest, source, modules, dir) {
    return {
      id: manifest.id,
      version: manifest.version,
      name: manifest.name,
      author: manifest.author,
      license: manifest.license,
      sourceUrl: manifest.sourceUrl ?? "",
      compatibility: manifest.compatibility,
      modules,
      source,
      valid: true,
      dir
    };
  }

  return {
    OFFICIAL_TEMPLATE_ID,
    getUserTemplatesDir,
    resolveTemplateDir,
    validateTemplateDir,
    installTemplateFromDir,
    listTemplates,
    resolveStatusAssets
  };
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pb[i] !== pa[i]) return pb[i] - pa[i];
  }
  return 0;
}

function copyPackageContents(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    // Only whitelisted subtrees ever get copied.
    if (entry.name === "template.json" || entry.name === "island-status" || entry.name === "background" || entry.name === "codex-pet" || LICENSE_FILES.includes(entry.name)) {
      fs.cpSync(path.join(source, entry.name), path.join(target, entry.name), { recursive: true });
    }
  }
}

function findReferencedImage(imageDir) {
  if (!fs.existsSync(imageDir)) return null;
  for (const entry of fs.readdirSync(imageDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
      return path.join(imageDir, entry.name);
    }
  }
  return null;
}

module.exports = { createTemplateService, OFFICIAL_TEMPLATE_ID };
