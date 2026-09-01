"use strict";

// Appearance template manifest contract (PRD-018 §7.2), shared by the main
// process validator and the CLI-facing template controller.
//
// Security model:
//   - Manifests are strict: unknown keys are rejected, so a package can never
//     smuggle "executable" metadata into the runtime.
//   - Asset references are bare filenames only (no paths, no URLs).
//   - SVGs are statically screened for script, event handlers, external
//     references and entities before they are ever handed to the renderer.
//   - Every declared asset must match its sha256; a mismatch invalidates the
//     whole package (transactional install, no partial application).

const crypto = require("node:crypto");

const TEMPLATE_SCHEMA_VERSION = 1;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_SVG_BYTES = 256 * 1024;
const MAX_BACKGROUND_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_SPRITESHEET_BYTES = 10 * 1024 * 1024;

const TEMPLATE_ID_PATTERN = /^(builtin:[a-z0-9][a-z0-9-]{0,63}|[a-z0-9][a-z0-9-]{0,31}\.[a-z0-9][a-z0-9-]{0,63})$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ALLOWED_SVG_EXTENSIONS = new Set([".svg"]);
const ALLOWED_BACKGROUND_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const ALLOWED_SPRITESHEET_EXTENSIONS = new Set([".png", ".webp"]);

const APPROVED_LICENSES = new Set([
  "Apache-2.0",
  "MIT",
  "CC0-1.0",
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
  "BSD-3-Clause",
  "Unlicense"
]);

const ISLAND_STATUS_KEYS = ["idle", "running", "approval", "complete", "error"];
const ISLAND_STATUS_FILES = Object.fromEntries(ISLAND_STATUS_KEYS.map((key) => [key, `${key}.svg`]));

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "id",
  "name",
  "version",
  "author",
  "license",
  "sourceUrl",
  "compatibility",
  "assets"
]);
const ALLOWED_ASSET_MODULE_KEYS = new Set(["islandStatus", "background", "codexPet"]);

class TemplateValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "TemplateValidationError";
  }
}

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Minimal `>=` check for plain `major.minor.patch` ranges. The manifest
 * compatibility field only needs "does this app satisfy the template" and
 * "does the template satisfy the declared minimum" — no ranges algebra.
 */
function satisfiesMinimumVersion(actual, minimum) {
  const parse = (value) => String(value).split(".").map((part) => Number.parseInt(part, 10));
  const actualParts = parse(actual);
  const minimumParts = parse(minimum);
  for (let i = 0; i < 3; i += 1) {
    const a = Number.isFinite(actualParts[i]) ? actualParts[i] : 0;
    const b = Number.isFinite(minimumParts[i]) ? minimumParts[i] : 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

function parseCompatibility(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TemplateValidationError("compatibility 必须是对象");
  }
  const allowed = new Set(["workisland", "codexPet"]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      throw new TemplateValidationError(`compatibility 不允许字段: ${key}`);
    }
  }
  const compatibility = {};
  const workisland = raw.workisland;
  if (workisland !== undefined) {
    const match = /^\s*>=\s*(\d+\.\d+\.\d+)\s*$/.exec(String(workisland));
    if (!match) {
      throw new TemplateValidationError('compatibility.workisland 仅支持 ">=x.y.z" 形式');
    }
    compatibility.workislandMinimum = match[1];
  }
  if (raw.codexPet !== undefined) {
    if (raw.codexPet !== 2) {
      throw new TemplateValidationError("compatibility.codexPet 仅支持 2");
    }
    compatibility.codexPet = 2;
  }
  return compatibility;
}

function parseAssetHash(raw, moduleKey, fileKey) {
  if (typeof raw !== "string" || !HASH_PATTERN.test(raw)) {
    throw new TemplateValidationError(`assets.${moduleKey}.${fileKey} 必须是小写 sha256 十六进制串`);
  }
  return raw;
}

function parseAssets(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TemplateValidationError("assets 必须是对象");
  }
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_ASSET_MODULE_KEYS.has(key)) {
      throw new TemplateValidationError(`assets 不允许模块: ${key}`);
    }
  }
  const assets = {};
  const islandStatus = raw.islandStatus;
  if (islandStatus !== undefined) {
    if (typeof islandStatus !== "object" || islandStatus === null || Array.isArray(islandStatus)) {
      throw new TemplateValidationError("assets.islandStatus 必须是对象");
    }
    const keys = Object.keys(islandStatus);
    const required = [...ISLAND_STATUS_KEYS];
    if (keys.length !== required.length || required.some((key) => !(key in islandStatus))) {
      throw new TemplateValidationError(
        `assets.islandStatus 出现时五个状态必须齐全: ${required.join(", ")}`
      );
    }
    assets.islandStatus = Object.fromEntries(
      ISLAND_STATUS_KEYS.map((key) => [key, parseAssetHash(islandStatus[key], "islandStatus", key)])
    );
  }
  const background = raw.background;
  if (background !== undefined) {
    if (typeof background !== "object" || background === null || Array.isArray(background)) {
      throw new TemplateValidationError("assets.background 必须是对象");
    }
    const allowed = new Set(["appearance", "image"]);
    for (const key of Object.keys(background)) {
      if (!allowed.has(key)) throw new TemplateValidationError(`assets.background 不允许字段: ${key}`);
    }
    if (!("appearance" in background)) {
      throw new TemplateValidationError("assets.background.appearance 必填（image 可选）");
    }
    assets.background = {
      appearance: parseAssetHash(background.appearance, "background", "appearance")
    };
    if (background.image !== undefined) {
      assets.background.image = parseAssetHash(background.image, "background", "image");
    }
  }
  const codexPet = raw.codexPet;
  if (codexPet !== undefined) {
    if (typeof codexPet !== "object" || codexPet === null || Array.isArray(codexPet)) {
      throw new TemplateValidationError("assets.codexPet 必须是对象");
    }
    const allowed = new Set(["manifest", "spritesheet"]);
    for (const key of Object.keys(codexPet)) {
      if (!allowed.has(key)) throw new TemplateValidationError(`assets.codexPet 不允许字段: ${key}`);
    }
    if (!("manifest" in codexPet) || !("spritesheet" in codexPet)) {
      throw new TemplateValidationError("assets.codexPet 需要 manifest 与 spritesheet 两个哈希");
    }
    assets.codexPet = {
      manifest: parseAssetHash(codexPet.manifest, "codexPet", "manifest"),
      spritesheet: parseAssetHash(codexPet.spritesheet, "codexPet", "spritesheet")
    };
  }
  if (Object.keys(assets).length === 0) {
    throw new TemplateValidationError("assets 至少需要 islandStatus / background / codexPet 之一");
  }
  return assets;
}

/**
 * Parse + structurally validate a manifest object (no filesystem access).
 * Returns a normalized manifest with only whitelisted fields.
 */
function parseTemplateManifest(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TemplateValidationError("template.json 必须是 JSON 对象");
  }
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      throw new TemplateValidationError(`template.json 不允许字段: ${key}`);
    }
  }
  if (raw.schemaVersion !== TEMPLATE_SCHEMA_VERSION) {
    throw new TemplateValidationError(`schemaVersion 必须为 ${TEMPLATE_SCHEMA_VERSION}`);
  }
  if (typeof raw.id !== "string" || !TEMPLATE_ID_PATTERN.test(raw.id)) {
    throw new TemplateValidationError(
      'id 必须形如 "builtin:<slug>" 或 "<author>.<slug>"（小写字母/数字/连字符）'
    );
  }
  if (typeof raw.version !== "string" || !VERSION_PATTERN.test(raw.version)) {
    throw new TemplateValidationError("version 必须是 x.y.z 形式");
  }
  for (const field of ["name", "author", "license"]) {
    const value = raw[field];
    if (typeof value !== "string" || value.trim().length === 0 || value.length > 160) {
      throw new TemplateValidationError(`${field} 必须是 1–160 字符的字符串`);
    }
  }
  if (!APPROVED_LICENSES.has(raw.license)) {
    throw new TemplateValidationError(
      `license 必须是已批准的标识符之一: ${[...APPROVED_LICENSES].join(", ")}`
    );
  }
  if (raw.sourceUrl !== undefined) {
    if (typeof raw.sourceUrl !== "string" || raw.sourceUrl.length > 512) {
      throw new TemplateValidationError("sourceUrl 必须是 ≤512 字符的字符串");
    }
  }
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    id: raw.id,
    name: raw.name.trim(),
    version: raw.version,
    author: raw.author.trim(),
    license: raw.license,
    sourceUrl: raw.sourceUrl,
    compatibility: parseCompatibility(raw.compatibility),
    assets: parseAssets(raw.assets)
  };
}

function parseTemplateManifestJson(text) {
  if (typeof text !== "string" || text.length > MAX_MANIFEST_BYTES) {
    throw new TemplateValidationError(`template.json 超过 ${MAX_MANIFEST_BYTES} 字节上限`);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new TemplateValidationError(`template.json 解析失败: ${err.message}`);
  }
  return parseTemplateManifest(raw);
}

// ── 静态 SVG 安检 ────────────────────────────────────────────────────────────

const SVG_FORBIDDEN_PATTERNS = [
  { pattern: /<script[\s>]/i, reason: "包含 <script>" },
  { pattern: /\son[a-z]+\s*=/i, reason: "包含事件处理属性（on*）" },
  { pattern: /javascript\s*:/i, reason: "包含 javascript: URL" },
  { pattern: /<!ENTITY/i, reason: "包含 ENTITY 声明（XXE 面）" },
  { pattern: /<foreignObject[\s>]/i, reason: "包含 <foreignObject>" }
];

function validateSvgAsset(buf, filename) {
  const errors = [];
  if (!FILENAME_PATTERN.test(filename)) {
    errors.push(`非法文件名: ${filename}`);
    return errors;
  }
  if (!ALLOWED_SVG_EXTENSIONS.has(filename.toLowerCase().slice(-4))) {
    errors.push(`island-status 资产必须是 .svg: ${filename}`);
  }
  if (buf.length === 0 || buf.length > MAX_SVG_BYTES) {
    errors.push(`${filename} 大小须在 1–${MAX_SVG_BYTES} 字节之间（当前 ${buf.length}）`);
    return errors;
  }
  const text = buf.toString("utf8");
  if (!text.includes("<svg") || !text.includes("</svg>")) {
    errors.push(`${filename} 不是完整的 SVG 文档`);
    return errors;
  }
  for (const { pattern, reason } of SVG_FORBIDDEN_PATTERNS) {
    if (pattern.test(text)) errors.push(`${filename} ${reason}`);
  }
  // External references (href to anything but a local fragment) are rejected.
  const hrefMatches = text.matchAll(/(?:xlink:href|href)\s*=\s*["']([^"']*)["']/gi);
  for (const match of hrefMatches) {
    const value = match[1].trim();
    if (value && !value.startsWith("#")) {
      errors.push(`${filename} 引用了外部资源: ${value.slice(0, 60)}`);
    }
  }
  return errors;
}

function validateBackgroundImageAsset(buf, filename) {
  const errors = [];
  if (!FILENAME_PATTERN.test(filename) || !ALLOWED_BACKGROUND_IMAGE_EXTENSIONS.has(filename.toLowerCase().replace(/^.*(\.[a-z0-9]+)$/, "$1"))) {
    errors.push(`背景图文件名/扩展名不合法: ${filename}`);
  }
  if (buf.length === 0 || buf.length > MAX_BACKGROUND_IMAGE_BYTES) {
    errors.push(`背景图 ${filename} 超过 ${MAX_BACKGROUND_IMAGE_BYTES} 字节上限`);
  }
  return errors;
}

function validateSpritesheetAsset(buf, filename) {
  const errors = [];
  if (!FILENAME_PATTERN.test(filename) || !ALLOWED_SPRITESHEET_EXTENSIONS.has(filename.toLowerCase().slice(-5))) {
    errors.push(`精灵图文件名/扩展名不合法: ${filename}`);
  }
  if (buf.length === 0 || buf.length > MAX_SPRITESHEET_BYTES) {
    errors.push(`精灵图 ${filename} 超过 ${MAX_SPRITESHEET_BYTES} 字节上限`);
  }
  return errors;
}

function templateDirNameForId(id) {
  return String(id).replace(/[^A-Za-z0-9.-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, 96) || "template";
}

module.exports = {
  TEMPLATE_SCHEMA_VERSION,
  TEMPLATE_ID_PATTERN,
  VERSION_PATTERN,
  ISLAND_STATUS_KEYS,
  ISLAND_STATUS_FILES,
  APPROVED_LICENSES,
  MAX_MANIFEST_BYTES,
  MAX_SVG_BYTES,
  TemplateValidationError,
  sha256Buffer,
  satisfiesMinimumVersion,
  parseTemplateManifest,
  parseTemplateManifestJson,
  validateSvgAsset,
  validateBackgroundImageAsset,
  validateSpritesheetAsset,
  templateDirNameForId
};
