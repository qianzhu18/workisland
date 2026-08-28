"use strict";

// Pet sprite library: the single source of truth for resolving, listing,
// installing, and validating desktop-pet spritesheets. Shared by the settings
// IPC handlers and the AI customization bridge so both surfaces agree on
// what a valid sprite is.

const electron = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { listCodexPets, resolveCodexPet } = require("./codex-pet.cjs");

const DEFAULT_SPRITE = "codex:qianxue";
const LEGACY_DEFAULT_SPRITE = "orca.png";
const MAX_SPRITE_BYTES = 10 * 1024 * 1024;
const SPRITE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const BUILT_IN_CODEX_PETS = Object.freeze({
  qianxue: Object.freeze({
    id: "qianxue",
    displayName: "千雪",
    description: "WorkIsland 内置 Codex V2 桌宠。",
    spriteVersionNumber: 2,
    spriteFile: "qianxue.webp",
    value: "codex:qianxue"
  }),
  "codex-buddy": Object.freeze({
    id: "codex-buddy",
    displayName: "宝剑 Skyler",
    description: "WorkIsland 内置 Codex V2 桌宠。",
    spriteVersionNumber: 2,
    spriteFile: "codex-buddy.webp",
    value: "codex:codex-buddy"
  })
});

// Spritesheet geometry contracts. The renderer auto-detects the protocol from
// the natural image size (src/renderer/pet/model.mjs); the main process
// mirrors that check so installs can be validated before selection.
const SPRITE_SHEET_CONTRACTS = Object.freeze({
  "codex-v2": Object.freeze({
    width: 1536,
    height: 2288,
    columns: 8,
    rows: 11,
    cellWidth: 192,
    cellHeight: 208,
    label: "Codex V2（1536×2288，8 列 × 11 行，cell 192×208）"
  }),
  "orca-v1": Object.freeze({
    width: 1024,
    height: 896,
    columns: 8,
    rows: 7,
    cellWidth: 128,
    cellHeight: 128,
    label: "Orca v1（1024×896，8 列 × 7 行，cell 128×128）"
  })
});

function getDefaultSpritesDir() {
  if (electron.app.isPackaged) {
    return path.resolve(process.resourcesPath, "pet-sprites");
  }
  return path.resolve(electron.app.getAppPath(), "resources", "pet-sprites");
}

function getUserSpritesDir() {
  return path.join(electron.app.getPath("userData"), "pet-sprites");
}

/**
 * 解析桌宠 sprite 文件路径。
 *
 * 支持三种格式：
 *   1. 默认（null/空）→ DEFAULT_SPRITE（内置 codex:qianxue）
 *   2. 文件名（xxx.png / xxx.webp）→ 在 user/default sprites 目录查找
 *   3. "codex:<pet-name>" → 解析 ~/.codex/pets/<pet-name>/spritesheet.webp
 *      （兼容 Codex V2 桌宠协议，pet.json 描述布局）
 */
function resolveSpriteSelection(fileName) {
  const raw = fileName || DEFAULT_SPRITE;
  if (raw === "echo:little") {
    return { filePath: "", protocol: "echo", pet: null };
  }
  // Codex pet 协议：codex:<pet-name>
  if (raw.startsWith("codex:")) {
    const petName = raw.slice("codex:".length);
    const builtInPet = BUILT_IN_CODEX_PETS[petName];
    if (builtInPet) {
      const filePath = path.join(getDefaultSpritesDir(), builtInPet.spriteFile);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Bundled Codex pet spritesheet not found: ${filePath}`);
      }
      return {
        filePath,
        protocol: "codex-v2",
        pet: { ...builtInPet, spritePath: filePath }
      };
    }
    const pet = resolveCodexPet(petName);
    return { filePath: pet.spritePath, protocol: "codex-v2", pet };
  }
  // 普通文件名：接受 .png 和 .webp
  const safe = path.basename(raw);
  if (safe !== raw || safe.includes("..")) {
    throw new Error("Invalid sprite filename");
  }
  const lower = safe.toLowerCase();
  if (!lower.endsWith(".png") && !lower.endsWith(".webp")) {
    throw new Error("Only .png and .webp are allowed");
  }
  const userPath = path.join(getUserSpritesDir(), safe);
  const filePath = fs.existsSync(userPath) ? userPath : path.join(getDefaultSpritesDir(), safe);
  return { filePath, protocol: "orca-v1" };
}

let spriteDirsInitialized = false;
function initSpriteDirs() {
  if (spriteDirsInitialized) return;
  const userDir = getUserSpritesDir();
  const defaultDir = getDefaultSpritesDir();
  try {
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    // Keep the legacy Orca asset available for custom/compatibility use.
    // The built-in Codex V2 pet is read directly from packaged resources.
    const dest = path.join(userDir, LEGACY_DEFAULT_SPRITE);
    if (!fs.existsSync(dest)) {
      const src = path.join(defaultDir, LEGACY_DEFAULT_SPRITE);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
      }
    }
    spriteDirsInitialized = true;
  } catch (err) {
    spriteDirsInitialized = false;
    console.error("[PetLibrary] failed to init user sprites dir:", err);
  }
}

// ── 图片尺寸解析（PNG / JPEG / WebP，纯 buffer 头解析，零依赖） ──────────────

function readPngDimensions(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function readJpegDimensions(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    // SOF0–SOF15 except DHT (0xc4), JPG (0xc8), DAC (0xcc)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    offset += 2 + buf.readUInt16BE(offset + 2);
  }
  return null;
}

function readWebpDimensions(buf) {
  if (buf.length < 30 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    // Lossy: 3-frame-tag bytes, then little-endian width/height (14 bits).
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    return { width, height };
  }
  if (chunk === "VP8L") {
    // Lossless: 5-byte signature, then 14+14 bits packed little-endian.
    const bits = buf.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  }
  if (chunk === "VP8X") {
    // Extended: canvas size as 24-bit little-endian minus one.
    const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width, height };
  }
  return null;
}

function readImageDimensions(buf, extension) {
  const ext = extension.toLowerCase();
  if (ext === ".png") return readPngDimensions(buf);
  if (ext === ".webp") return readWebpDimensions(buf);
  if (ext === ".jpg" || ext === ".jpeg") return readJpegDimensions(buf);
  return null;
}

function classifySpriteSheet(width, height) {
  for (const [protocol, contract] of Object.entries(SPRITE_SHEET_CONTRACTS)) {
    if (width === contract.width && height === contract.height) {
      return { protocol, contract };
    }
  }
  return { protocol: null, contract: null };
}

// ── 安装与校验（AI 定制接口的落盘入口） ────────────────────────────────────

function slugifySpriteName(input) {
  const base = path.basename(String(input ?? ""));
  const stem = base.replace(/\.(png|webp)$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return stem.slice(0, 64);
}

/**
 * 校验一个精灵图文件是否符合已知协议几何。
 * 返回 { ok, protocol, width, height, contract, message } — ok=false 时
 * message 说明期望的两种尺寸，方便 AI 生成-校验-重试闭环。
 */
function validateSpriteFile(sourcePath) {
  if (typeof sourcePath !== "string" || sourcePath.trim().length === 0) {
    return { ok: false, protocol: null, message: "缺少精灵图文件路径" };
  }
  const resolved = path.resolve(sourcePath.trim());
  const ext = path.extname(resolved).toLowerCase();
  if (ext !== ".png" && ext !== ".webp") {
    return { ok: false, protocol: null, message: "精灵图必须是 .png 或 .webp 文件" };
  }
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { ok: false, protocol: null, message: `文件不存在或不可读: ${resolved}` };
  }
  if (!stat.isFile()) {
    return { ok: false, protocol: null, message: `不是普通文件: ${resolved}` };
  }
  if (stat.size > MAX_SPRITE_BYTES) {
    return { ok: false, protocol: null, message: `文件超过 10 MB 上限（当前 ${(stat.size / 1024 / 1024).toFixed(1)} MB）` };
  }
  const buf = fs.readFileSync(resolved);
  const dimensions = readImageDimensions(buf, ext);
  if (!dimensions) {
    return {
      ok: false,
      protocol: null,
      message: `无法解析图片尺寸（可能不是有效的 ${ext} 文件）`
    };
  }
  const { protocol, contract } = classifySpriteSheet(dimensions.width, dimensions.height);
  if (!protocol) {
    const expected = Object.values(SPRITE_SHEET_CONTRACTS).map((c) => c.label).join(" 或 ");
    return {
      ok: false,
      protocol: null,
      width: dimensions.width,
      height: dimensions.height,
      message: `尺寸 ${dimensions.width}×${dimensions.height} 不匹配任何精灵图协议；期望 ${expected}`
    };
  }
  return {
    ok: true,
    protocol,
    width: dimensions.width,
    height: dimensions.height,
    contract,
    message: `符合 ${contract.label}`
  };
}

/**
 * 把一个精灵图安装进用户 sprites 目录（可选用后立即切换）。
 * 返回 { sprite, validation, installed } — 安装前先做几何校验，不合规直接
 * 抛错，避免用户选到黑屏/兜底 Orca。
 */
function installPetSprite({ name, sourcePath, select = false, applySelection }) {
  initSpriteDirs();
  const validation = validateSpriteFile(sourcePath);
  if (!validation.ok) {
    const error = new Error(validation.message);
    error.code = "SPRITE_VALIDATION_FAILED";
    error.validation = validation;
    throw error;
  }
  const ext = path.extname(path.resolve(sourcePath.trim())).toLowerCase();
  const stem = slugifySpriteName(name || sourcePath) || `pet-${Date.now()}`;
  if (!SPRITE_NAME_PATTERN.test(stem)) {
    throw new Error(`无效的精灵图名称: ${stem}（仅允许字母数字 . _ -，且以字母数字开头）`);
  }
  const fileName = `${stem}${ext}`;
  const targetPath = path.join(getUserSpritesDir(), fileName);
  fs.copyFileSync(path.resolve(sourcePath.trim()), targetPath);
  const sprite = fileName;
  if (select && typeof applySelection === "function") {
    applySelection(sprite);
  }
  return { sprite, validation, installed: true };
}

/**
 * 列出可选的桌宠：内置 Codex V2、~/.codex/pets 发现的 V2、用户目录里的
 * png/webp 雪碧图，以及程序化 Echo 模式。
 */
function listAvailablePets() {
  initSpriteDirs();
  const pets = [];
  for (const pet of Object.values(BUILT_IN_CODEX_PETS)) {
    const { spriteFile, ...rest } = pet;
    pets.push({ ...rest, source: "builtin" });
  }
  for (const pet of listCodexPets()) {
    if (BUILT_IN_CODEX_PETS[pet.id]) continue;
    pets.push({ ...pet, source: "codex-home" });
  }
  const userDir = getUserSpritesDir();
  if (fs.existsSync(userDir)) {
    for (const entry of fs.readdirSync(userDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (!lower.endsWith(".png") && !lower.endsWith(".webp")) continue;
      pets.push({
        id: entry.name,
        displayName: entry.name,
        description: "用户安装的精灵图文件",
        spriteVersionNumber: 1,
        value: entry.name,
        source: "user"
      });
    }
  }
  pets.push({
    id: "echo:little",
    displayName: "Echo（程序化模式）",
    description: "无雪碧图的 DOM/CSS 程序化桌宠",
    spriteVersionNumber: 0,
    value: "echo:little",
    source: "builtin"
  });
  return pets;
}

module.exports = {
  DEFAULT_SPRITE,
  LEGACY_DEFAULT_SPRITE,
  BUILT_IN_CODEX_PETS,
  SPRITE_SHEET_CONTRACTS,
  MAX_SPRITE_BYTES,
  getDefaultSpritesDir,
  getUserSpritesDir,
  resolveSpriteSelection,
  initSpriteDirs,
  readImageDimensions,
  classifySpriteSheet,
  validateSpriteFile,
  installPetSprite,
  listAvailablePets
};
