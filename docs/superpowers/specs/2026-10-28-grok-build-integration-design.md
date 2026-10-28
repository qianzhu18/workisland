# Grok Build integration

User confirmed Grok Bot and Grok Build. Implement Build in an independent branch from main; do not update the installed WorkIsland, install Grok on PATH, change user configuration, or merge automatically.

Grok Build exposes local lifecycle hooks in owned `~/.grok/hooks/workisland-status.json`. Reuse the existing local hooks CLI and bridge, default off. Normalize native camelCase payload fields, snake_case aliases and reserved GROK_HOOK_EVENT / GROK_SESSION_ID environment fields. Keep native session IDs, bounded per-session state, terminal host and persistent Grok PID. Do not infer identity from cwd.

Prompt submission starts work; tool hooks show activity. Stop means turn completion, SessionEnd means session exit. StopCancelled and StopFailure must not become success notifications. Ignore session-end observe-only Stop and subagent endings for the parent. Only an actual Notification(permission_prompt) creates native approval-wait state; PreToolUse is not approval. Pending native state is cleared when work resumes or the turn ends. Observers always return quietly, with a bounded transport deadline, and never return gate decisions.

Build loads Claude and Cursor compatibility hooks by default. Suppress WorkIsland hooks invoked with another source when the reserved GROK session/event environment proves the real runtime is Grok, avoiding duplicate or wrong-agent cards. Do not disable the user's compatibility configuration.

Grok Bot is cloud-hosted. Official enterprise inference hooks and Action Recording/OTel require server/admin setup and are not a local drop-in lifecycle interface. Do not add a fake Bot connection, scrape chat content, or equate desktop process existence with cloud work. Record this scope separately.

Verification: adapter lifecycle/identity/isolation/native-permission tests, owned-file preservation/collision/uninstall tests, generated command through actual local bridge including compatibility suppression and offline/deadline behavior, actual settings runtime, full checks and CI. If a released Build binary can be obtained from the official distribution, run it only in a disposable test directory with isolated configuration for native parser/hook verification; do not claim an authenticated Grok model turn without evidence.

Sources: https://github.com/xai-org/grok-build (main 2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8); user-guide/10-hooks.md and xai-grok-hooks event/discovery/command runner sources; https://docs.x.ai/grok-bot/overview ; https://docs.x.ai/grok-bot/inference-hooks .
