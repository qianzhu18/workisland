"use strict";

function capability(definition) {
  return Object.freeze({
    ...definition,
    platforms: Object.freeze([...definition.platforms]),
    relatedSettings: Object.freeze([...definition.relatedSettings]),
    requirements: Object.freeze([...definition.requirements])
  });
}

const PRODUCT_CAPABILITIES = Object.freeze([
  capability({
    id: "agent-monitoring", name: "智能体监控", category: "智能体",
    summary: "在灵动岛集中显示 WorkIsland 已观察到的智能体会话、阶段和待处理状态。",
    platforms: ["darwin", "win32"], relatedSettings: ["hookToggles"], settingsSection: "agents",
    howToUse: "连接受支持的智能体后正常开始任务；灵动岛会随生命周期事件更新。",
    privacy: "只在本机汇总状态；MCP 不返回提示词、回答、项目路径、终端标识或 PID。",
    requirements: ["至少一个受支持的智能体接入 WorkIsland"], enabledWhen: () => true
  }),
  capability({
    id: "media", name: "媒体播放", category: "工作台",
    summary: "显示当前媒体的封面、进度、来源和播放控制。",
    platforms: ["darwin", "win32"], relatedSettings: ["mediaEnabled", "mediaTrackChangeNotifications"], settingsSection: "general",
    howToUse: "开启媒体播放后开始播放系统可识别的音频或视频。",
    privacy: "媒体信息只在本机读取；仅在线歌词功能会发送曲目元数据。",
    requirements: ["系统存在可识别的媒体会话"], enabledWhen: (settings, modules) => settings.mediaEnabled !== false && modules.media !== false
  }),
  capability({
    id: "lyrics", name: "在线歌词", category: "工作台",
    summary: "为正在播放的曲目查询并同步显示歌词。",
    platforms: ["darwin", "win32"], relatedSettings: ["mediaEnabled", "lyricsEnabled"], settingsSection: "general",
    howToUse: "同时开启媒体播放和在线歌词，然后播放包含曲目信息的媒体。",
    privacy: "会把歌曲名、歌手、专辑和时长发送给 LRCLIB；歌词缓存在本机。",
    requirements: ["媒体播放已开启", "允许联网查询 LRCLIB"], enabledWhen: (settings) => settings.mediaEnabled !== false && settings.lyricsEnabled === true
  }),
  capability({
    id: "performance", name: "性能监视器", category: "工作台",
    summary: "显示 CPU、内存与高占用进程，并可在持续高负载时提醒。",
    platforms: ["darwin", "win32"], relatedSettings: ["performanceEnabled", "performanceAlertsEnabled"], settingsSection: "general",
    howToUse: "开启性能监视器，在展开的灵动岛中悬停性能区域查看详情。",
    privacy: "性能和进程统计只在本机读取，不通过 MCP 返回命令行或文件路径。",
    requirements: ["性能监视器已开启"], enabledWhen: (settings, modules) => settings.performanceEnabled !== false && modules.performance !== false
  }),
  capability({
    id: "file-shelf", name: "文件架", category: "效率工具",
    summary: "把文件引用临时放在灵动岛中，方便跨应用拖放。",
    platforms: ["darwin", "win32"], relatedSettings: ["fileShelfEnabled"], settingsSection: "general",
    howToUse: "把 Finder 或资源管理器中的文件拖到展开的灵动岛。",
    privacy: "只保留本机文件引用；从文件架移除不会删除原文件。",
    requirements: ["文件架已开启"], enabledWhen: (settings, modules) => settings.fileShelfEnabled !== false && modules.shelf !== false
  }),
  capability({
    id: "quick-share", name: "快速分享", category: "效率工具",
    summary: "从文件架快速调用系统分享服务；Windows 使用复制路径兜底。",
    platforms: ["darwin", "win32"], relatedSettings: ["fileShelfEnabled", "shelfQuickShareProvider"], settingsSection: "general",
    howToUse: "将文件放入文件架后使用快速分享区域。",
    privacy: "只有用户主动分享时才把选中的文件交给系统分享服务。",
    requirements: ["文件架已开启", "至少有一个文件引用"], enabledWhen: (settings) => settings.fileShelfEnabled !== false
  }),
  capability({
    id: "clipboard-history", name: "剪贴板历史", category: "效率工具",
    summary: "在本机保存可回放、收藏和清理的剪贴板记录。",
    platforms: ["darwin", "win32"], relatedSettings: ["clipboardHistoryEnabled", "clipboardHistoryLimit", "clipboardRetentionHours"], settingsSection: "general",
    howToUse: "在设置中明确开启后复制文字、链接、代码或图片。",
    privacy: "复制内容可能包含敏感信息，因此默认关闭并只保存在本机。",
    requirements: ["用户明确开启剪贴板历史"], enabledWhen: (settings) => settings.clipboardHistoryEnabled === true
  }),
  capability({
    id: "terminal", name: "快捷终端", category: "效率工具",
    summary: "在灵动岛运行快捷命令或使用持续交互的完整终端。",
    platforms: ["darwin", "win32"], relatedSettings: ["terminalEnabled", "terminalDefaultDirectory", "terminalCustomDirectory"], settingsSection: "general",
    howToUse: "开启快捷终端后从工作台打开终端模块。",
    privacy: "终端在本机运行；MCP 不能读取终端内容或执行任意命令。",
    requirements: ["快捷终端已开启"], enabledWhen: (settings, modules) => settings.terminalEnabled !== false && modules.terminal !== false
  }),
  capability({
    id: "saved-commands", name: "终端快捷命令", category: "效率工具",
    summary: "保存常用本机命令并从灵动岛一键运行。",
    platforms: ["darwin", "win32"], relatedSettings: ["terminalEnabled", "terminalSavedCommands"], settingsSection: "general",
    howToUse: "在快捷终端详细设置中添加名称和命令。",
    privacy: "命令仅保存在本机；MCP 不返回命令文本。",
    requirements: ["快捷终端已开启"], enabledWhen: (settings) => settings.terminalEnabled !== false
  }),
  capability({
    id: "usage", name: "用量统计", category: "智能体",
    summary: "汇总受支持智能体的 Token、模型、会话和订阅额度信息。",
    platforms: ["darwin", "win32"], relatedSettings: ["showUsageQuota", "usageDisplayValue"], settingsSection: "general",
    howToUse: "开启用量额度后查看灵动岛顶部额度和用量面板。",
    privacy: "MCP 只返回模块启用状态，不返回提示词、项目内容或原始会话记录。",
    requirements: ["至少一个支持用量采集的智能体"], enabledWhen: (settings, modules) => settings.showUsageQuota !== false && modules.usage !== false
  }),
  capability({
    id: "notifications", name: "任务通知", category: "提醒",
    summary: "在提交、完成、错误、审批和提问时展示不同优先级的灵动岛状态。",
    platforms: ["darwin", "win32"], relatedSettings: ["completionPopupDurationSec", "expandOnSessionComplete", "expandOnSessionSubmit", "expandOnActionRequired", "suppressNotificationWhenFocused"], settingsSection: "general",
    howToUse: "连接智能体后正常工作；需要处理的状态会保持显示。",
    privacy: "提醒由本机会话状态生成；MCP 不读取提醒中的会话内容。",
    requirements: ["WorkIsland 已观察到智能体生命周期事件"], enabledWhen: () => true
  }),
  capability({
    id: "sound", name: "提示音", category: "提醒",
    summary: "为任务开始、完成、错误和需要处理的状态播放本机提示音。",
    platforms: ["darwin", "win32"], relatedSettings: ["sound.enabled", "sound.volume", "sound.events"], settingsSection: "sound",
    howToUse: "在声音设置中开启并调整音量或事件。",
    privacy: "声音全部在本机播放，不上传会话内容。",
    requirements: ["系统允许 WorkIsland 播放声音"], enabledWhen: (settings) => settings.sound?.enabled === true
  }),
  capability({
    id: "display-mode", name: "灵动岛显示模式", category: "显示",
    summary: "在常驻胶囊和按需出现的极简模式之间切换。",
    platforms: ["darwin", "win32"], relatedSettings: ["islandDisplayMode", "hoverToOpen", "autoCollapseOnMouseLeave", "autoCollapseDelayMs"], settingsSection: "general",
    howToUse: "在通用设置中选择常驻或极简，并调整悬停与收起行为。",
    privacy: "只改变本机窗口行为。",
    requirements: [], enabledWhen: () => true
  }),
  capability({
    id: "desktop-pet", name: "桌面宠物", category: "显示",
    summary: "用桌宠形态展示与灵动岛相同的智能体状态和提醒。",
    platforms: ["darwin", "win32"], relatedSettings: ["petSprite", "petScale"], settingsSection: "appearance",
    howToUse: "在外观与桌宠设置中选择素材，然后切换到桌宠。",
    privacy: "桌宠素材与状态在本机读取；MCP 只返回已选择素材的公开标识。",
    requirements: ["已安装或内置可用桌宠素材"], enabledWhen: () => true
  }),
  capability({
    id: "shortcuts", name: "快捷键", category: "快捷操作",
    summary: "通过全局快捷键展开、收起、审批、拒绝或跳回会话。",
    platforms: ["darwin", "win32"], relatedSettings: ["shortcuts"], settingsSection: "general",
    howToUse: "在通用设置中查看或调整快捷键。",
    privacy: "快捷键配置只保存在本机。",
    requirements: ["快捷键未被其他应用占用"], enabledWhen: (settings) => Object.values(settings.shortcuts?.bindings || {}).some((binding) => binding?.enabled !== false)
  })
]);

function projectCapability(definition, context = {}) {
  const settings = context.settings || {};
  const modules = context.modules || {};
  const platform = typeof context.platform === "string" ? context.platform : process.platform;
  return {
    id: definition.id,
    name: definition.name,
    category: definition.category,
    summary: definition.summary,
    platforms: [...definition.platforms],
    available: definition.platforms.includes(platform),
    enabled: definition.enabledWhen(settings, modules) === true,
    howToUse: definition.howToUse,
    privacy: definition.privacy,
    relatedSettings: [...definition.relatedSettings],
    settingsSection: definition.settingsSection,
    requirements: [...definition.requirements]
  };
}

function listProductCapabilities(context = {}) {
  return PRODUCT_CAPABILITIES.map((definition) => projectCapability(definition, context));
}

function getProductCapability(id, context = {}) {
  const definition = PRODUCT_CAPABILITIES.find((entry) => entry.id === id);
  if (!definition) {
    const error = new Error("That WorkIsland capability is not available.");
    error.code = "CAPABILITY_NOT_FOUND";
    throw error;
  }
  return projectCapability(definition, context);
}

module.exports = {
  PRODUCT_CAPABILITIES,
  getProductCapability,
  listProductCapabilities
};
