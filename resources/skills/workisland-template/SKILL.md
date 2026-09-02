---
name: workisland-template
description: 为用户选择、预览并应用 WorkIsland 灵动岛外观模板（会话状态图标 / 岛屿背景 / 桌宠）。当用户想“换灵动岛外观 / 主题 / 模板 / 小宇 / 守岛人 / 背景”时使用。必须执行“检查 → 预览 → 用户确认 → 应用”，不得跳过确认步骤。
---

# WorkIsland 外观模板 Skill

你正在帮用户更换 WorkIsland（macOS 灵动岛式 Agent 任务监控器）的外观模板。模板以**包**为单位（五个状态 SVG + 可选背景 + 可选桌宠），所有操作都通过本机 `workisland-cli` 完成，不开网络端口。

## 第一步：定位 CLI

```bash
# 安装版（推荐，做一次发现即可）
WI_CLI='/Applications/WorkIsland.app/Contents/Resources/bin/workisland-cli'
test -x "$WI_CLI" && echo found
# 调用形式（安装版需用 Electron 的 Node 模式）：
ELECTRON_RUN_AS_NODE=1 '/Applications/WorkIsland.app/Contents/MacOS/WorkIsland' "$WI_CLI" <子命令>
# 开发版：node <repo>/src/island/workisland-cli/index.cjs <子命令>
```

所有命令输出结构化 JSON；退出码：0 成功、1 用法错误、2 应用未运行、3 校验失败。退出码 2 时提示用户启动 WorkIsland 后重试。

## 必须遵守的流程（不可跳步）

1. **检查**：`template list`（可选 `--source builtin|local`）列出可用模板；对用户提到的模板执行 `template inspect <id>`，向用户**复述**：名称、作者、许可证、版本、包含的模块（island / background / pet）。
2. **预览**：`template preview <id>`，用返回的 `islandStatus`（五张 data-URL SVG）、`background`、`pet` 信息向用户描述应用后的样子。你无法直接展示图片时，如实描述状态图标语义与背景主题。
3. **确认**：明确询问“是否应用？”。若模板含 pet 模块，再问“是否同步到 Codex（~/.codex/pets）？”。**只有用户肯定回答后才执行第 4 步。**
4. **应用**：`template apply <id> --modules <用户同意的模块>[ --sync-codex]`（默认只应用 island 模块）。

## 其他合法意图

- “恢复默认 / 换回小宇”：`template reset --module island|background|pet|all`（默认 all；不会删除已安装模板和用户的 Codex 宠物）。
- “看看现在的外观”：`template list`（返回 `active`）或 `appearance get`。
- 用户明确要做**模板创作/发布**时，才进入作者流程：在目录中按模板格式建包 → `template validate <目录>` → `template preview <目录>` → `template export <目录> --out <zip>` → 用户确认后 `template publish <zip> --repo <owner/repo> --confirm`。绝不能由“应用模板”的意图隐式触发创作或发布。

## 硬性边界

- 不替用户做决定：模块选择、`--sync-codex`、`publish` 都必须逐一确认。
- 失败时读取 stderr 的 JSON 错误（`code: VALIDATION` 给出具体原因）并向用户转述恢复建议；不重试超过 2 次，不删除任何用户文件。
- 不直接编辑 SVG/JSON 资产文件；一切变更经由 CLI。
- 不读取 Agent transcript、环境密钥或模板目录之外的文件。
- 完整接口规格：`workisland-cli manual`。
