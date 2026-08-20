"use strict";

const CORE_AGENT_DESCRIPTORS = Object.freeze([
  descriptor("claude", "Claude Code", "#DA7250", "Claude-compatible Hook，支持实时状态、工具活动和 Island 审批。", {
    completion: "native", approval: "bridge", question: "bridge", jump: "session"
  }),
  descriptor("codex", "Codex", "#8EA1FF", "本地 Hook 与 transcript 双通道，支持完成检测、审批和会话回源。", {
    completion: "native", approval: "bridge", question: "observe", jump: "session", approvalConfigurable: true
  }),
  descriptor("coco", "Coco", "#7C83FD", "TRAE CLI Hook，支持工具状态、审批和提问。", {
    completion: "native", approval: "bridge", question: "bridge", jump: "workspace", approvalConfigurable: true
  }),
  descriptor("cursor", "Cursor", "#6E7CF6", "Cursor 原生 Hook，支持 Agent turn、Shell、MCP 和文件活动。", {
    completion: "native", approval: "observe", question: "observe", jump: "workspace"
  }),
  descriptor("trae", "TraeCode", "#5967E9", "支持 TraeCode v3.5.66+。连接后还需在 TraeCode 设置 → Hooks 中启用“已配置的 Hooks”，并将运行方式设为“本地自动运行”；收到真实任务事件后才显示已验证。", {
    completion: "native", approval: "observe", question: "observe", jump: "workspace"
  }),
  descriptor("zcode", "ZCode", "#635BFF", "ZCode 原生配置 Hook，支持实时状态、完成提醒和 Island 审批。", {
    completion: "native", approval: "bridge", question: "nativeOnly", jump: "app"
  }),
  descriptor("workbuddy", "WorkBuddy", "#2F80ED", "WorkBuddy Claude-compatible Hook，支持完整会话生命周期、Island 审批和应用跳转。", {
    completion: "native", approval: "bridge", question: "bridge", jump: "app"
  }),
  descriptor("codebuddy", "CodeBuddy（国内版）", "#2F80ED", "CodeBuddy 国内版 Claude-compatible Hook，独立连接 ~/.codebuddy/settings.json，支持完整会话生命周期、Island 审批和应用跳转。", {
    completion: "native", approval: "bridge", question: "bridge", jump: "app"
  }),
  descriptor("opencode", "OpenCode", "#6E64D8", "本地插件接入，支持会话、工具、权限和问题交互。", {
    completion: "native", approval: "bridge", question: "bridge", jump: "session"
  }),
  descriptor("sara", "Sara", "#6E64D8", "本地插件接入，支持会话、工具、权限和问题交互。", {
    completion: "native", approval: "bridge", question: "bridge", jump: "session"
  }),
  descriptor("kimi", "Kimi Code", "#6A65D8", "Kimi Code CLI TOML Hook，支持实时状态、工具活动和完成提醒。", {
    completion: "native", approval: "observe", question: "observe", jump: "workspace"
  }),
  descriptor("gemini", "Gemini CLI", "#4B7BEC", "Gemini CLI Hook，支持会话、Agent 和工具事件。", {
    completion: "native", approval: "none", question: "none", jump: "workspace"
  }),
  descriptor("copilot-cli", "GitHub Copilot CLI", "#6E64D8", "Copilot CLI Hook，支持状态、审批和问题交互。", {
    completion: "native", approval: "bridge", question: "bridge", jump: "workspace", approvalConfigurable: true
  }),
  descriptor("hermes", "Hermes", "#626EE3", "Hermes Hook，支持实时状态、工具活动和 token 统计。", {
    completion: "native", approval: "observe", question: "observe", jump: "workspace"
  }),
  descriptor("aiden", "Aiden", "#626EE3", "Aiden Hook，支持会话、工具和审批状态。", {
    completion: "native", approval: "bridge", question: "observe", jump: "workspace"
  }),
  descriptor("dsh", "DeepSeek Harness", "#4D6BFE", "自动识别正在运行的 DSH_HOME 与 profile，安装生命周期插件；重启 DSH 后支持会话状态、任务消息、运行活动和完成提醒。", {
    completion: "native", approval: "bridge", question: "observe", jump: "app"
  }),
  descriptor("traex", "TRAE CLI", "#626EE3", "TRAE CLI Hook，支持会话、工具和 Island 审批；不监控 Trae 桌面端会话。", {
    completion: "native", approval: "bridge", question: "observe", jump: "workspace", approvalConfigurable: true
  })
]);

const DESCRIPTOR_BY_ID = new Map(CORE_AGENT_DESCRIPTORS.map((entry) => [entry.agentId, entry]));

function descriptor(agentId, label, badgeColor, description, capabilities) {
  return Object.freeze({
    agentId,
    label,
    badgeColor,
    description,
    capabilities: Object.freeze({
      liveStatus: true,
      toolActivity: true,
      completion: "none",
      approval: "none",
      question: "none",
      jump: "none",
      ...capabilities
    })
  });
}

function getAgentDescriptor(agentId) {
  return DESCRIPTOR_BY_ID.get(agentId);
}

function listCoreAgentDescriptors() {
  return CORE_AGENT_DESCRIPTORS.map((entry) => ({
    ...entry,
    capabilities: { ...entry.capabilities }
  }));
}

function validateAgentWiring({ managerIds, adapterIds }) {
  const managers = new Set(managerIds);
  const adapters = new Set(adapterIds);
  const catalogIds = new Set(CORE_AGENT_DESCRIPTORS.map((entry) => entry.agentId));
  const missingAdapters = [...managers].filter((id) => !id.startsWith("plugin:") && !adapters.has(id));
  const missingManagers = [...adapters].filter((id) => !managers.has(id));
  const missingDescriptors = [...managers].filter((id) => !id.startsWith("plugin:") && !catalogIds.has(id));
  const catalogWithoutManagers = [...catalogIds].filter((id) => !managers.has(id));
  if (missingAdapters.length || missingManagers.length || missingDescriptors.length || catalogWithoutManagers.length) {
    const details = [
      missingAdapters.length ? `manager without adapter: ${missingAdapters.join(", ")}` : "",
      missingManagers.length ? `adapter without manager: ${missingManagers.join(", ")}` : "",
      missingDescriptors.length ? `manager without descriptor: ${missingDescriptors.join(", ")}` : "",
      catalogWithoutManagers.length ? `catalog without manager: ${catalogWithoutManagers.join(", ")}` : ""
    ].filter(Boolean).join("; ");
    throw new Error(`[AgentCatalog] invalid wiring: ${details}`);
  }
}

module.exports = {
  getAgentDescriptor,
  listCoreAgentDescriptors,
  validateAgentWiring
};
