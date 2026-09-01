"use strict";

// Island background image management for the AI customization API.
// Images live in <userData>/island-backgrounds and are referenced from
// settings by bare filename only — the service refuses anything that tries
// to escape that directory.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { readImageDimensions } = require("./pet-library.cjs");

const MAX_BACKGROUND_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_BACKGROUND_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const BACKGROUND_IMAGE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function createAppearanceService({ getUserDataPath }) {
  function getBackgroundsDir() {
    return path.join(getUserDataPath(), "island-backgrounds");
  }

  function ensureBackgroundsDir() {
    const dir = getBackgroundsDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function resolveBackgroundRef(imageRef) {
    if (typeof imageRef !== "string" || !BACKGROUND_IMAGE_REF_PATTERN.test(imageRef)) {
      throw new Error("非法的背景图引用（仅允许文件名）");
    }
    const dir = getBackgroundsDir();
    const resolved = path.resolve(dir, imageRef);
    const relative = path.relative(dir, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("背景图引用不能指向管理目录之外");
    }
    return resolved;
  }

  function mimeForExtension(ext) {
    switch (ext) {
      case ".png":
        return "image/png";
      case ".webp":
        return "image/webp";
      case ".jpg":
      case ".jpeg":
        return "image/jpeg";
      default:
        return "application/octet-stream";
    }
  }

  /**
   * 安装一张背景图：校验扩展名、大小、可解码尺寸，复制进管理目录并
   * 返回 { imageRef, width, height }。同名（哈希）重复安装是幂等的。
   */
  function installBackgroundImage(sourcePath) {
    if (typeof sourcePath !== "string" || sourcePath.trim().length === 0) {
      throw new Error("缺少背景图文件路径");
    }
    const resolved = path.resolve(sourcePath.trim());
    const ext = path.extname(resolved).toLowerCase();
    if (!ALLOWED_BACKGROUND_EXTENSIONS.has(ext)) {
      throw new Error("背景图仅支持 .png / .jpg / .webp");
    }
    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch {
      throw new Error(`文件不存在或不可读: ${resolved}`);
    }
    if (!stat.isFile()) throw new Error(`不是普通文件: ${resolved}`);
    if (stat.size > MAX_BACKGROUND_IMAGE_BYTES) {
      throw new Error(`背景图超过 8 MB 上限（当前 ${(stat.size / 1024 / 1024).toFixed(1)} MB）`);
    }
    const buf = fs.readFileSync(resolved);
    const dimensions = readImageDimensions(buf, ext);
    if (!dimensions || dimensions.width < 8 || dimensions.height < 8) {
      throw new Error("无法解析背景图尺寸（可能不是有效图片）");
    }
    ensureBackgroundsDir();
    const hash = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
    const imageRef = `bg-${hash}${ext}`;
    const target = resolveBackgroundRef(imageRef);
    if (!fs.existsSync(target)) {
      fs.copyFileSync(resolved, target);
    }
    return { imageRef, width: dimensions.width, height: dimensions.height, bytes: stat.size };
  }

  /**
   * 读取背景图为 data URL（渲染端 CSP 只允许 data:/blob: 图片源）。
   * 文件缺失时返回 null，由渲染端回退纯黑。
   */
  function getBackgroundImageDataUrl(imageRef) {
    try {
      const filePath = resolveBackgroundRef(imageRef);
      if (!fs.existsSync(filePath)) return null;
      const { size } = fs.statSync(filePath);
      if (size > MAX_BACKGROUND_IMAGE_BYTES) return null;
      const buf = fs.readFileSync(filePath);
      const mime = mimeForExtension(path.extname(filePath).toLowerCase());
      return `data:${mime};base64,${buf.toString("base64")}`;
    } catch {
      return null;
    }
  }

  function deleteBackgroundImage(imageRef) {
    try {
      const filePath = resolveBackgroundRef(imageRef);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }

  function listBackgroundImages() {
    const dir = getBackgroundsDir();
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && ALLOWED_BACKGROUND_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => {
        try {
          const { size } = fs.statSync(path.join(dir, entry.name));
          return { imageRef: entry.name, bytes: size };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  return {
    getBackgroundsDir,
    installBackgroundImage,
    getBackgroundImageDataUrl,
    deleteBackgroundImage,
    listBackgroundImages
  };
}

module.exports = {
  createAppearanceService,
  MAX_BACKGROUND_IMAGE_BYTES,
  ALLOWED_BACKGROUND_EXTENSIONS
};
