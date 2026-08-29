"use strict";

// Bridge-facing template operations (PRD-018 §7.5). Orchestrates the raw
// appearance/pet APIs on top of the validated template service — it must
// never reimplement validation, hashing, or file safety.

const path = require("node:path");
const fs = require("node:fs");
const { TemplateValidationError } = require("../shared/template-manifest.cjs");
const { DEFAULT_ISLAND_APPEARANCE, normalizeIslandAppearance } = require("../shared/appearance.cjs");
const { OFFICIAL_TEMPLATE_ID, DEFAULT_APPEARANCE_TEMPLATE } = require("../shared/template-defaults.cjs");

const TEMPLATE_SOURCES = new Set(["builtin", "local", "github"]);
const APPLY_MODULES = new Set(["island", "background", "pet"]);
const DEFAULT_PET_SPRITE = "codex:qianxue";

function createTemplateController({
  templateService,
  appearanceService,
  petLibrary,
  getCodexPetsDir,
  getSettings,
  updateSettings
}) {
  function requireServices() {
    if (!templateService) throw new Error("template service unavailable");
  }

  /**
   * Accepts "id", "id@version", or a filesystem path (validated as an
   * uninstalled package). Returns { kind: "ref"|"path", ... }.
   */
  function parseTemplateTarget(target) {
    const raw = typeof target === "string" ? target.trim() : "";
    if (!raw) throw new TemplateValidationError("缺少模板目标（id、id@version 或模板目录路径）");
    if (raw.includes("/") || raw.includes("\\")) {
      return { kind: "path", dir: path.resolve(raw) };
    }
    const at = raw.lastIndexOf("@");
    if (at > 0 && at < raw.length - 1) {
      return { kind: "ref", id: raw.slice(0, at), version: raw.slice(at + 1) };
    }
    return { kind: "ref", id: raw, version: "*" };
  }

  function resolveInstalled(target) {
    const parsed = parseTemplateTarget(target);
    if (parsed.kind === "path") {
      const validation = templateService.validateTemplateDir(parsed.dir);
      if (!validation.ok) {
        const error = new TemplateValidationError(
          `模板校验失败: ${validation.errors.slice(0, 3).join("; ")}`
        );
        error.code = "TEMPLATE_VALIDATION_FAILED";
        error.validation = validation;
        throw error;
      }
      return { dir: parsed.dir, manifest: validation.manifest, modules: validation.modules, installed: false };
    }
    const dir = templateService.resolveTemplateDir(parsed.id, parsed.version);
    const validation = templateService.validateTemplateDir(dir);
    if (!validation.ok) {
      throw new TemplateValidationError(`已安装模板校验失败: ${validation.errors.join("; ")}`);
    }
    return { dir, manifest: validation.manifest, modules: validation.modules, installed: true };
  }

  function listTemplates(payload) {
    requireServices();
    const source = payload?.source;
    if (source !== undefined && !TEMPLATE_SOURCES.has(source)) {
      throw new TemplateValidationError(`未知模板来源: ${String(source).slice(0, 40)}（可选 builtin | local | github）`);
    }
    let templates = templateService.listTemplates();
    if (source === "builtin" || source === "local") {
      templates = templates.filter((entry) => entry.source === source);
    } else if (source === "github") {
      templates = [];
    }
    const settings = getSettings();
    return {
      active: settings.appearanceTemplate ?? { ...DEFAULT_APPEARANCE_TEMPLATE },
      source: source ?? "all",
      templates
    };
  }

  function inspectTemplate(payload) {
    requireServices();
    const resolved = resolveInstalled(payload?.target ?? payload?.id);
    return {
      template: summary(resolved),
      modules: resolved.modules,
      assets: Object.keys(resolved.manifest.assets)
    };
  }

  function previewTemplate(payload) {
    requireServices();
    const resolved = resolveInstalled(payload?.target ?? payload?.id);
    const preview = {
      template: summary(resolved),
      modules: resolved.modules
    };
    if (resolved.manifest.assets.islandStatus) {
      const status = templateService.resolveStatusAssets(resolved.manifest.id, resolved.manifest.version);
      preview.islandStatus = status.assets;
    }
    if (resolved.manifest.assets.background) {
      const appearance = readTemplateAppearance(resolved.dir);
      if (appearance) preview.background = { appearance };
    }
    if (resolved.manifest.assets.codexPet) {
      preview.pet = { displayName: readCodexPetDisplayName(resolved.dir) };
    }
    return preview;
  }

  /**
   * apply 事务顺序（PRD §7.3）：先整包校验，再把背景图/精灵图等文件落
   * 盘（幂等命名），最后一次性 updateSettings —— 任一前置步骤失败都不
   * 触碰当前设置。
   */
  function applyTemplate(payload) {
    requireServices();
    const request = payload && typeof payload === "object" ? payload : {};
    const requestedModules = parseModules(request.modules, payload);
    let resolved = resolveInstalled(request.target ?? request.id);
    // Applying from a path installs the package first so the recorded
    // appearanceTemplate reference stays resolvable after restarts (and the
    // renderer can load its status assets instead of hitting the builtin
    // fallback).
    if (!resolved.installed && !resolved.manifest.id.startsWith("builtin:")) {
      templateService.installTemplateFromDir(resolved.dir);
      resolved = resolveInstalled(`${resolved.manifest.id}@${resolved.manifest.version}`);
    }
    const manifest = resolved.manifest;

    // Module/package agreement: asking for a module the template lacks fails
    // loudly instead of silently applying nothing.
    const MODULE_ASSET_KEYS = { island: "islandStatus", background: "background", pet: "codexPet" };
    for (const module of requestedModules) {
      if (!manifest.assets[MODULE_ASSET_KEYS[module]]) {
        throw new TemplateValidationError(`模板 ${manifest.id} 不包含 ${module} 模块`);
      }
    }

    const partial = {};
    if (requestedModules.includes("island")) {
      partial.appearanceTemplate = { id: manifest.id, version: manifest.version };
    }
    if (requestedModules.includes("background")) {
      partial.islandAppearance = compileTemplateBackground(resolved.dir);
    }
    let petSelection = null;
    if (requestedModules.includes("pet")) {
      petSelection = installTemplatePet(resolved, request.syncCodex === true);
      partial.petSprite = petSelection.sprite;
    }

    updateSettings(partial);
    return {
      applied: requestedModules,
      template: summary(resolved),
      pet: petSelection,
      settings: partial
    };
  }

  function parseModules(raw, payload) {
    let modules = raw;
    if (modules === undefined && payload && typeof payload === "object") {
      modules = payload.module;
    }
    if (modules === undefined || modules === null || modules === "") return ["island"];
    const list = Array.isArray(modules)
      ? modules
      : String(modules).split(",").map((entry) => entry.trim()).filter(Boolean);
    if (list.length === 0) return ["island"];
    for (const module of list) {
      if (!APPLY_MODULES.has(module)) {
        throw new TemplateValidationError(`未知模块: ${String(module).slice(0, 30)}（可选 island | background | pet）`);
      }
    }
    return [...new Set(list)];
  }

  function compileTemplateBackground(templateDir) {
    const appearance = readTemplateAppearance(templateDir);
    if (!appearance) throw new TemplateValidationError("模板背景模块缺失 appearance.json");
    if (appearance.kind === "image" && appearanceService) {
      const imageDir = path.join(templateDir, "background");
      const imageFile = findImageFile(imageDir);
      if (!imageFile) throw new TemplateValidationError("模板背景声明了图片但包内缺少图片文件");
      const installed = appearanceService.installBackgroundImage(imageFile);
      appearance.imageRef = installed.imageRef;
    }
    const { appearance: normalized } = normalizeIslandAppearance(appearance);
    return normalized;
  }

  function installTemplatePet(resolved, syncCodex) {
    const petDir = path.join(resolved.dir, "codex-pet");
    const sheetPath = path.join(petDir, "spritesheet.webp");
    const manifestPath = path.join(petDir, "pet.json");
    let petManifest;
    try {
      petManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      throw new TemplateValidationError("codex-pet/pet.json 不可读");
    }
    const safeId = String(petManifest.id || resolved.manifest.id).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 64) || "template-pet";
    if (syncCodex) {
      const targetDir = path.join(getCodexPetsDir(), safeId);
      fs.mkdirSync(targetDir, { recursive: true });
      fs.copyFileSync(sheetPath, path.join(targetDir, "spritesheet.webp"));
      fs.writeFileSync(path.join(targetDir, "pet.json"), JSON.stringify({
        id: safeId,
        displayName: petManifest.displayName || resolved.manifest.name,
        description: typeof petManifest.description === "string" ? petManifest.description : "",
        spriteVersionNumber: 2,
        spritesheetPath: "spritesheet.webp"
      }, null, 2));
      return { sprite: `codex:${safeId}`, syncedToCodex: true, displayName: petManifest.displayName || safeId };
    }
    // WorkIsland-internal selection: install into the user sprites dir via
    // the shared pet library (which re-validates geometry before copying).
    const fileName = `${safeId}.webp`;
    const target = path.join(petLibrary.getUserSpritesDir(), fileName);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(sheetPath, target);
    return { sprite: fileName, syncedToCodex: false, displayName: petManifest.displayName || safeId };
  }

  function resetTemplate(payload) {
    requireServices();
    const request = payload && typeof payload === "object" ? payload : {};
    let module = request.module ?? request.modules ?? "all";
    if (Array.isArray(module)) module = module[0] ?? "all";
    module = String(module || "all");
    if (!["island", "background", "pet", "all"].includes(module)) {
      throw new TemplateValidationError(`未知重置模块: ${module.slice(0, 30)}（可选 island | background | pet | all）`);
    }
    const partial = {};
    if (module === "island" || module === "all") {
      partial.appearanceTemplate = { ...DEFAULT_APPEARANCE_TEMPLATE };
    }
    if (module === "background" || module === "all") {
      partial.islandAppearance = { ...DEFAULT_ISLAND_APPEARANCE };
    }
    if (module === "pet" || module === "all") {
      // Restore the bundled default; never touch ~/.codex/pets contents.
      partial.petSprite = DEFAULT_PET_SPRITE;
    }
    updateSettings(partial);
    return { reset: module, settings: partial };
  }

  function validateTemplate(payload) {
    requireServices();
    const target = typeof payload?.target === "string" ? payload.target : (typeof payload?.dir === "string" ? payload.dir : "");
    if (!target.trim()) throw new TemplateValidationError("validate 需要 <模板目录> 参数");
    const validation = templateService.validateTemplateDir(target);
    return {
      ok: validation.ok,
      template: validation.manifest ? summary({ manifest: validation.manifest, installed: false }) : null,
      modules: validation.modules,
      errors: validation.errors,
      warnings: validation.warnings
    };
  }

  function exportTemplate(payload) {
    requireServices();
    const request = payload && typeof payload === "object" ? payload : {};
    const dir = typeof request.dir === "string" ? request.dir.trim() : "";
    const out = typeof request.out === "string" ? request.out.trim() : "";
    if (!dir || !out) throw new TemplateValidationError("export 需要 <模板目录> 与 --out <zip 路径>");
    const validation = templateService.validateTemplateDir(dir);
    if (!validation.ok) {
      const error = new TemplateValidationError(`导出前校验失败: ${validation.errors.join("; ")}`);
      error.code = "TEMPLATE_VALIDATION_FAILED";
      throw error;
    }
    const { writeStoreOnlyZip } = require("./zip-writer.cjs");
    const zipPath = path.resolve(out.endsWith(".zip") ? out : `${out}.zip`);
    const files = collectPackageFiles(path.resolve(dir));
    const sha256 = writeStoreOnlyZip(zipPath, files);
    return { zip: zipPath, sha256, files: files.length, template: summary({ manifest: validation.manifest, installed: false }) };
  }

  function readTemplateAppearance(templateDir) {
    try {
      return JSON.parse(fs.readFileSync(path.join(templateDir, "background", "appearance.json"), "utf8"));
    } catch {
      return null;
    }
  }

  function readCodexPetDisplayName(templateDir) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(templateDir, "codex-pet", "pet.json"), "utf8"));
      return typeof manifest.displayName === "string" ? manifest.displayName : manifest.id;
    } catch {
      return "";
    }
  }

  function findImageFile(dir) {
    if (!fs.existsSync(dir)) return null;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if ([".png", ".jpg", ".jpeg", ".webp"].includes(path.extname(entry.name).toLowerCase())) {
        return path.join(dir, entry.name);
      }
    }
    return null;
  }

  function collectPackageFiles(root) {
    const files = [];
    const whitelist = ["template.json", "LICENSE", "island-status", "background", "codex-pet", "preview"];
    for (const name of whitelist) {
      const target = path.join(root, name);
      if (!fs.existsSync(target)) continue;
      const stat = fs.statSync(target);
      if (stat.isFile()) {
        files.push({ name, data: fs.readFileSync(target) });
      } else {
        for (const entry of fs.readdirSync(target, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          if (entry.isFile()) {
            files.push({ name: `${name}/${entry.name}`, data: fs.readFileSync(path.join(target, entry.name)) });
          }
        }
      }
    }
    return files;
  }

  function summary(resolved) {
    const manifest = resolved.manifest;
    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      author: manifest.author,
      license: manifest.license,
      sourceUrl: manifest.sourceUrl ?? "",
      compatibility: manifest.compatibility,
      installed: resolved.installed === true
    };
  }

  return {
    listTemplates,
    inspectTemplate,
    previewTemplate,
    applyTemplate,
    resetTemplate,
    validateTemplate,
    exportTemplate,
    parseTemplateTarget
  };
}

module.exports = { createTemplateController, OFFICIAL_TEMPLATE_ID, DEFAULT_PET_SPRITE };
