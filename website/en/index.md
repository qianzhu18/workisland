# WorkIsland

> A native macOS work interface for the AI era. When work needs you, you should not have to go looking for it.

WorkIsland is a free, local-first native macOS app for AI workflows. It starts with Claude Code, Codex, Cursor, and other supported coding agents: a low-interruption desktop surface shows local work that is running, waiting for approval or an answer, completed, or failed. When supported, users can act in place and return to the terminal or app session that produced the event.

## Who it fits

WorkIsland fits people who run coding agents in parallel and do not want to poll every terminal. It does not replace the agent, terminal, or IDE. Work stays where it happens; WorkIsland exposes the state, context, and next action when a person needs to step in.

## Current limits

- WorkIsland only shows a state when a connected agent has produced a real local signal; it does not fabricate completed or approval states.
- In-place actions depend on the connected agent and event type. If precise source return is unavailable, WorkIsland shows a fallback path.
- Session content, code, paths, project names, host names, and user names stay on the Mac. No cloud account is needed for the local workflow.
- Email, calendar, and general-notification integrations are not shipped features.

## Start

1. Install WorkIsland from the [official release](https://github.com/qianzhu18/workisland/releases/latest).
2. Connect an agent you already use in Settings.
3. Run one real task and verify the Island signal and return path.

## More information

- [Agent product brief](https://workisland.yanglaishe.cn/skill.md)
- [Chinese quick start](https://workisland.yanglaishe.cn/guide/index.md)
- [Claude Code notification guide](https://workisland.yanglaishe.cn/en/claude-code-notifications/index.md)
