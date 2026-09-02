"use strict";

const { DEFAULT_SETTINGS } = require("./settings.cjs");

const MAX_CHANGES = 20;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function controlError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function getPath(object, path) {
  return path.split(".").reduce((value, part) => value?.[part], object);
}

function setPath(partial, current, path, value) {
  const parts = path.split(".");
  if (parts.length === 1) {
    partial[path] = value;
    return;
  }
  const [root, leaf] = parts;
  if (!partial[root]) partial[root] = clone(current[root] || {});
  partial[root][leaf] = value;
}

function booleanEntry(key, label, description) {
  return entry(key, label, description, "boolean", "boolean", (value) => typeof value === "boolean");
}

function numberEntry(key, label, description, { min, max, integer = false }) {
  const constraints = integer
    ? `integer ${min}..${max}`
    : `number ${min}..${max}`;
  return entry(
    key,
    label,
    description,
    "number",
    constraints,
    (value) => typeof value === "number" && Number.isFinite(value) && (!integer || Number.isInteger(value)) && value >= min && value <= max
  );
}

function enumEntry(key, label, description, values) {
  return entry(key, label, description, "string", values, (value) => values.includes(value));
}

function entry(key, label, description, type, constraints, validate) {
  return Object.freeze({
    key,
    label,
    description,
    type,
    constraints: clone(constraints),
    readable: true,
    writable: true,
    restartRequired: false,
    defaultValue: clone(getPath(DEFAULT_SETTINGS, key)),
    read(settings) {
      return clone(getPath(settings, key));
    },
    validate,
    toPartial(partial, settings, value) {
      setPath(partial, settings, key, value);
    }
  });
}

const CONTROLLED_SETTINGS = Object.freeze({
  autoCollapseDelayMs: numberEntry("autoCollapseDelayMs", "自动收起延迟", "鼠标离开后等待多久收起灵动岛。", { min: 500, max: 60000, integer: true }),
  autoCollapseOnMouseLeave: booleanEntry("autoCollapseOnMouseLeave", "离开后自动收起", "鼠标离开灵动岛后自动收起。"),
  completionPopupDurationSec: numberEntry("completionPopupDurationSec", "完成提醒时长", "任务完成提醒停留的秒数。", { min: 1, max: 60, integer: true }),
  fileShelfEnabled: booleanEntry("fileShelfEnabled", "文件架", "在工作台显示文件架。"),
  hoverToOpen: booleanEntry("hoverToOpen", "悬停展开", "鼠标悬停时展开灵动岛。"),
  islandDisplayMode: enumEntry("islandDisplayMode", "灵动岛显示模式", "选择常驻或仅在需要时显示。", ["persistent", "minimal"]),
  lyricsEnabled: booleanEntry("lyricsEnabled", "在线歌词", "为正在播放的媒体查找并显示歌词。"),
  mediaEnabled: booleanEntry("mediaEnabled", "媒体信息", "在灵动岛显示媒体播放信息。"),
  mediaTrackChangeNotifications: booleanEntry("mediaTrackChangeNotifications", "切歌提醒", "媒体曲目变化时显示提醒。"),
  performanceAlertsEnabled: booleanEntry("performanceAlertsEnabled", "性能提醒", "资源压力较高时显示提醒。"),
  performanceEnabled: booleanEntry("performanceEnabled", "性能监控", "在工作台显示系统性能。"),
  petScale: numberEntry("petScale", "宠物大小", "调整桌面宠物的显示比例。", { min: 0.5, max: 2 }),
  petSprite: Object.freeze({
    ...entry("petSprite", "桌面宠物", "切换到已经安装的桌面宠物。", "string", "installed pet id", () => true),
    validate(value, context = {}) {
      return typeof value === "string" && value.length > 0 && value.length <= 160 && context.installedPetIds instanceof Set && context.installedPetIds.has(value);
    }
  }),
  showUsageQuota: booleanEntry("showUsageQuota", "用量额度", "显示智能体订阅额度。"),
  "sound.enabled": booleanEntry("sound.enabled", "提示音", "启用 WorkIsland 提示音。"),
  "sound.volume": numberEntry("sound.volume", "提示音音量", "设置提示音音量。", { min: 0, max: 100, integer: true }),
  terminalEnabled: booleanEntry("terminalEnabled", "终端面板", "在工作台显示终端面板。"),
  updateChecksEnabled: booleanEntry("updateChecksEnabled", "自动检查更新", "允许 WorkIsland 自动检查新版本。"),
  usageDisplayValue: enumEntry("usageDisplayValue", "用量展示方式", "选择显示已用量或剩余额度。", ["used", "remaining"])
});

function getControlledEntry(key) {
  const controlled = typeof key === "string" ? CONTROLLED_SETTINGS[key] : undefined;
  if (!controlled?.readable) {
    throw controlError("SETTING_NOT_ALLOWED", `Setting is not available to local control: ${String(key)}`, { key });
  }
  return controlled;
}

function describeControlledSettings(settings) {
  return Object.values(CONTROLLED_SETTINGS).map((controlled) => ({
    key: controlled.key,
    label: controlled.label,
    description: controlled.description,
    type: controlled.type,
    constraints: clone(controlled.constraints),
    currentValue: controlled.read(settings),
    defaultValue: clone(controlled.defaultValue),
    writable: controlled.writable,
    restartRequired: controlled.restartRequired
  }));
}

function readControlledSettings(settings, keys) {
  const requested = keys === undefined ? Object.keys(CONTROLLED_SETTINGS) : keys;
  if (!Array.isArray(requested) || requested.length > MAX_CHANGES) {
    throw controlError("TOO_MANY_SETTINGS", `At most ${MAX_CHANGES} settings may be read at once.`);
  }
  const output = {};
  for (const key of requested) {
    const controlled = getControlledEntry(key);
    output[key] = controlled.read(settings);
  }
  return output;
}

function validateControlledChanges(settings, changes, context = {}) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw controlError("INVALID_SETTING_VALUE", "Changes must be an object.");
  }
  const pairs = Object.entries(changes);
  if (pairs.length === 0) throw controlError("INVALID_SETTING_VALUE", "At least one setting change is required.");
  if (pairs.length > MAX_CHANGES) {
    throw controlError("TOO_MANY_SETTINGS", `At most ${MAX_CHANGES} settings may be changed at once.`);
  }

  const validated = [];
  for (const [key, value] of pairs) {
    const controlled = getControlledEntry(key);
    if (!controlled.writable) throw controlError("SETTING_NOT_ALLOWED", `Setting is read-only: ${key}`, { key });
    if (!controlled.validate(value, context)) {
      throw controlError("INVALID_SETTING_VALUE", `Invalid value for ${key}.`, {
        key,
        constraints: clone(controlled.constraints)
      });
    }
    validated.push([controlled, clone(value)]);
  }

  const values = {};
  const partial = {};
  for (const [controlled, value] of validated) {
    values[controlled.key] = value;
    controlled.toPartial(partial, settings, value);
  }
  return { values, partial };
}

module.exports = {
  CONTROLLED_SETTINGS,
  MAX_CHANGES,
  describeControlledSettings,
  readControlledSettings,
  validateControlledChanges
};
