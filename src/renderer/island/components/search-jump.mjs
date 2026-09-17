/**
 * 搜索结果 → 回源跳转命令（PRD-019 M2 v1：复制恢复命令）。
 * 已知恢复语义的 Agent 生成完整 shell 命令；其余返回 null，
 * 由 UI 降级为复制项目路径。
 */
export function buildResumeCommand(result) {
  if (!result || !result.projectPath || !result.id) return null;
  const project = String(result.projectPath).replace(/"/g, '\\"');
  const id = String(result.id);
  if (result.tool === "claude") return `cd "${project}" && claude --resume ${id}`;
  if (result.tool === "codex") return `cd "${project}" && codex resume ${id}`;
  return null;
}

export function buildFallbackCopyText(result) {
  if (!result) return "";
  return String(result.projectPath || "");
}

/**
 * 结果卡点击行为：claude/codex 且岛内终端可用 → 直接在终端恢复对话；
 * 其余退回复制（项目路径/恢复命令文本）。
 */
export function searchResultAction(result, terminalEnabled) {
  const resume = buildResumeCommand(result);
  if (resume && terminalEnabled) return { type: "terminal", command: resume };
  return { type: "copy", text: resume || buildFallbackCopyText(result) };
}
