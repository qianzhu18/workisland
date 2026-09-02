"use strict";

const DIAGNOSIS_SUBJECTS = Object.freeze([
  "agent-not-visible",
  "session-disappeared",
  "media-not-visible",
  "performance-details-not-visible",
  "file-shelf-not-visible",
  "clipboard-not-visible",
  "terminal-not-visible",
  "usage-not-visible"
]);

function diagnosis(subject, status, evidence, possibleReasons, nextSteps, settingsSection) {
  return {
    subject,
    status,
    evidence,
    possibleReasons,
    nextSteps,
    settingsSection
  };
}

function diagnoseMcpSubject(subject, context = {}) {
  if (!DIAGNOSIS_SUBJECTS.includes(subject)) {
    const error = new Error("That WorkIsland diagnostic subject is not available.");
    error.code = "DIAGNOSIS_NOT_ALLOWED";
    throw error;
  }
  const settings = context.settings || {};
  const modules = context.modules || {};
  const sessions = Array.isArray(context.sessions) ? context.sessions : [];
  const integrations = Array.isArray(context.integrations) ? context.integrations : [];

  switch (subject) {
    case "agent-not-visible": {
      if (sessions.length > 0) {
        return diagnosis(subject, "observed", [`WorkIsland 当前观察到 ${sessions.length} 个可见会话。`], [], ["查询当前会话状态，确认目标智能体名称和阶段。"], "agents");
      }
      const installed = integrations.filter((item) => item.enabled && item.installed);
      return diagnosis(
        subject,
        "not-observed",
        ["WorkIsland 当前没有观察到可见会话。", `当前有 ${installed.length} 个已启用且已安装的智能体接入。`],
        ["目标智能体尚未接入或接入已关闭。", "接入已配置，但尚未收到真实生命周期事件。", "会话已经结束并退出 WorkIsland 的可见范围。"],
        ["查看智能体接入状态。", "在目标智能体中新建一次任务并观察是否产生事件。", "打开 Agents 设置检查对应接入。"],
        "agents"
      );
    }
    case "session-disappeared":
      return diagnosis(
        subject,
        sessions.length ? "visible-sessions-remain" : "no-visible-sessions",
        [sessions.length ? `WorkIsland 当前仍显示 ${sessions.length} 个会话。` : "WorkIsland 当前没有观察到可见会话。"],
        ["会话已完成、被用户收起或超过可见生命周期。", "智能体没有继续发送可观察事件。", "极简显示模式会在无需处理时隐藏空闲表面。"],
        ["查询当前可见会话。", "检查灵动岛显示模式。", "回到目标智能体发送新任务以产生新的生命周期事件。"],
        "general"
      );
    case "media-not-visible": {
      const enabled = settings.mediaEnabled !== false && modules.media !== false;
      return diagnosis(
        subject,
        enabled ? "enabled-no-session" : "disabled",
        [enabled ? "媒体播放功能已开启，但 MCP 无法确认当前是否存在系统媒体会话。" : "媒体播放功能当前为关闭状态。"],
        enabled ? ["系统当前没有可识别的媒体会话。", "媒体应用没有向系统公开播放信息。", "需要处理的智能体状态正在优先显示。"] : ["媒体播放设置已关闭。"],
        enabled ? ["开始播放一首带曲目信息的媒体。", "展开灵动岛后再次检查。"] : ["打开通用设置中的媒体播放。"],
        "general"
      );
    }
    case "performance-details-not-visible": {
      const enabled = settings.performanceEnabled !== false && modules.performance !== false;
      return diagnosis(
        subject,
        enabled ? "enabled" : "disabled",
        [enabled ? "性能监视器当前已开启。" : "性能监视器当前为关闭状态。"],
        enabled ? ["灵动岛尚未展开。", "指针没有停留在性能区域。", "需要处理的智能体卡片正在占用优先展示位置。"] : ["性能监视器设置已关闭。"],
        enabled ? ["展开灵动岛并将指针悬停在性能区域。", "等待下一次性能采样后重试。"] : ["打开通用设置中的性能监视器。"],
        "general"
      );
    }
    case "file-shelf-not-visible": {
      const enabled = settings.fileShelfEnabled !== false && modules.shelf !== false;
      return diagnosis(subject, enabled ? "enabled" : "disabled", [enabled ? "文件架当前已开启。" : "文件架当前为关闭状态。"], enabled ? ["工作台当前显示的是智能体页。", "灵动岛尚未展开。"] : ["文件架设置已关闭。"], enabled ? ["展开灵动岛并切换到文件架。"] : ["打开通用设置中的文件架。"], "general");
    }
    case "clipboard-not-visible": {
      const enabled = settings.clipboardHistoryEnabled === true;
      return diagnosis(subject, enabled ? "enabled" : "disabled", [enabled ? "剪贴板历史已由用户明确开启。" : "剪贴板历史当前为关闭状态；新安装默认关闭。"], enabled ? ["尚未捕获可保存的剪贴板内容。", "工作台当前显示的是其他模块。"] : ["剪贴板历史为隐私敏感功能，必须由用户明确开启。"], enabled ? ["复制一段非敏感文字后打开剪贴板模块。"] : ["如确有需要，在通用设置中阅读隐私说明后手动开启。"], "general");
    }
    case "terminal-not-visible": {
      const enabled = settings.terminalEnabled !== false && modules.terminal !== false;
      return diagnosis(subject, enabled ? "enabled" : "disabled", [enabled ? "快捷终端当前已开启。" : "快捷终端当前为关闭状态。"], enabled ? ["工作台当前显示的是其他模块。", "灵动岛尚未展开。"] : ["快捷终端设置已关闭。"], enabled ? ["展开灵动岛并切换到终端模块。"] : ["打开通用设置中的快捷终端。"], "general");
    }
    case "usage-not-visible": {
      const enabled = settings.showUsageQuota !== false && modules.usage !== false;
      return diagnosis(subject, enabled ? "enabled" : "disabled", [enabled ? "用量额度展示当前已开启。" : "用量额度展示当前为关闭状态。"], enabled ? ["尚未采集到受支持智能体的用量。", "当前模型或订阅没有可用额度数据。"] : ["用量额度设置已关闭。"], enabled ? ["运行一次受支持的智能体任务后刷新用量。"] : ["打开通用设置中的用量额度。"], "general");
    }
    default:
      throw new Error("Unreachable diagnostic subject");
  }
}

module.exports = { DIAGNOSIS_SUBJECTS, diagnoseMcpSubject };
