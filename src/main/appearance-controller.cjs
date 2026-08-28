"use strict";

// Bridge-facing appearance operations. The BridgeServer delegates the AI
// customization commands here; this module owns validation, file handling,
// and routing persistence through AppCoordinator.updateSettings so every
// change is persisted once and broadcast to all windows through the
// existing settings pipeline.

const {
  DEFAULT_ISLAND_APPEARANCE,
  AppearanceValidationError,
  normalizeIslandAppearance
} = require("../shared/appearance.cjs");
const { validateSpriteFile, installPetSprite, resolveSpriteSelection, listAvailablePets, DEFAULT_SPRITE } = require("./pet-library.cjs");

function createAppearanceController({
  appearanceService,
  getSettings,
  updateSettings
}) {
  function requireAppearanceService() {
    if (!appearanceService) throw new Error("appearance service unavailable");
    return appearanceService;
  }

  function getAppearance() {
    const settings = getSettings();
    return {
      islandAppearance: settings.islandAppearance ?? { ...DEFAULT_ISLAND_APPEARANCE },
      petSprite: settings.petSprite ?? DEFAULT_SPRITE,
      petScale: settings.petScale ?? 1,
      availableBackgrounds: requireAppearanceService().listBackgroundImages()
    };
  }

  /**
   * setAppearance 载荷：
   *   appearance — 主题对象（见 src/shared/appearance.cjs）
   *   imageSource — { sourcePath }，image 模式下先安装背景图拿到 imageRef
   * 返回 { appearance, warnings }，校验失败抛 AppearanceValidationError。
   */
  function setAppearance(payload) {
    const request = payload && typeof payload === "object" ? payload : {};
    const rawAppearance = request.appearance && typeof request.appearance === "object"
      ? { ...request.appearance }
      : undefined;
    if (rawAppearance === undefined) {
      throw new AppearanceValidationError("setAppearance 需要 appearance 字段");
    }
    if (rawAppearance.kind === "image") {
      const imageSource = request.imageSource && typeof request.imageSource === "object" ? request.imageSource : null;
      const hasRef = typeof rawAppearance.imageRef === "string" && rawAppearance.imageRef.length > 0;
      if (imageSource?.sourcePath) {
        const installed = requireAppearanceService().installBackgroundImage(imageSource.sourcePath);
        rawAppearance.imageRef = installed.imageRef;
      } else if (!hasRef) {
        throw new AppearanceValidationError("image 模式需要 imageSource.sourcePath 或已存在的 appearance.imageRef");
      }
    }
    const { appearance, warnings } = normalizeIslandAppearance(rawAppearance);
    updateSettings({ islandAppearance: appearance });
    return { appearance, warnings };
  }

  function resetAppearance() {
    updateSettings({ islandAppearance: { ...DEFAULT_ISLAND_APPEARANCE } });
    return { appearance: { ...DEFAULT_ISLAND_APPEARANCE } };
  }

  function listPets() {
    const settings = getSettings();
    return {
      current: settings.petSprite ?? DEFAULT_SPRITE,
      pets: listAvailablePets()
    };
  }

  function setPet(payload) {
    const sprite = payload && typeof payload.sprite === "string" ? payload.sprite.trim() : "";
    if (!sprite) throw new Error("setPet 需要 sprite 字段");
    // Throws when the sprite cannot be resolved to a real file/protocol —
    // this is the same validation the settings page relies on.
    resolveSpriteSelection(sprite);
    updateSettings({ petSprite: sprite });
    return { petSprite: sprite };
  }

  function installPet(payload) {
    const request = payload && typeof payload === "object" ? payload : {};
    const select = request.select !== false;
    let appliedSprite = null;
    const result = installPetSprite({
      name: request.name,
      sourcePath: request.sourcePath,
      select,
      applySelection: (sprite) => {
        appliedSprite = sprite;
        updateSettings({ petSprite: sprite });
      }
    });
    return {
      sprite: result.sprite,
      selected: select && appliedSprite === result.sprite,
      validation: {
        ok: result.validation.ok,
        protocol: result.validation.protocol,
        width: result.validation.width,
        height: result.validation.height,
        message: result.validation.message
      }
    };
  }

  function validateSprite(payload) {
    const sourcePath = payload && typeof payload.sourcePath === "string" ? payload.sourcePath : "";
    const result = validateSpriteFile(sourcePath);
    return {
      ok: result.ok,
      protocol: result.protocol ?? null,
      width: result.width ?? null,
      height: result.height ?? null,
      expected: result.contract
        ? { width: result.contract.width, height: result.contract.height, columns: result.contract.columns, rows: result.contract.rows, cellWidth: result.contract.cellWidth, cellHeight: result.contract.cellHeight }
        : null,
      message: result.message
    };
  }

  return {
    getAppearance,
    setAppearance,
    resetAppearance,
    listPets,
    setPet,
    installPet,
    validateSprite
  };
}

module.exports = { createAppearanceController };
