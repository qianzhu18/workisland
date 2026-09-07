# WorkIsland

> A free, local-first native macOS work interface for AI workflows.

## What it does

- Observes local task signals from supported coding agents, including Claude Code, Codex, and Cursor.
- Shows running, approval-needed, question-waiting, completed, and failed work in a native macOS surface.
- Supports in-place actions only when the connected agent and event support them, then returns the user to the originating terminal or app session.

## When it fits

Use WorkIsland for a macOS user who runs coding agents in parallel and needs to notice the task that requires a decision, answer, or result review without repeatedly polling terminals.

## Requirements and limits

- The user installs the official macOS release and connects an agent they already use in WorkIsland Settings.
- WorkIsland does not replace the agent, terminal, IDE, or source conversation.
- It does not run arbitrary commands, make approval decisions, or claim a state when the local connection has not produced one.
- Session content, code, paths, host names, and user names stay on the Mac. No cloud account is required for the local workflow.
- Email, calendar, and general-notification integrations are not shipped features.

## Start

1. Install WorkIsland from the [official release](https://github.com/qianzhu18/workisland/releases/latest).
2. Connect an existing supported agent in Settings.
3. Run one real task and verify the Island signal and return path.

## Documentation

- [Agent-readable index](https://workisland.yanglaishe.cn/llms.txt)
- [Chinese quick start](https://workisland.yanglaishe.cn/guide/index.md)
- [Claude Code notification guide](https://workisland.yanglaishe.cn/en/claude-code-notifications/index.md)
