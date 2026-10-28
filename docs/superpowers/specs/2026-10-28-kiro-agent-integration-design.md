# Kiro IDE / CLI integration

User request: add Kiro as a first-class WorkIsland agent on a new branch, reusing any prior implementation. No Kiro branch or commit was found in current local/remote refs. Baseline is main cf1809e.

## Product behavior

One Kiro entry supports IDE 1.x and the CLI V3 engine through official lifecycle command hooks. Observe session start, prompt submission, tool start/result and agent stop. Keep native permissions/questions in Kiro; never fabricate Island approval capability or treat every tool invocation as a permission request. Completion means turn completion, not that Kiro exited.

Kiro CLI 2.35.1 includes V3 (`kiro-cli --v3`); its executable version alone does not prove the selected engine. A separately named legacy profile can support the classic engine without changing the user's default agent or engine. Clearly document the required launch command. No broad mutation of existing custom profiles.

Use global `~/.kiro/hooks/workisland-status.json` with the shared v1 format for current IDE/V3. Preserve unrelated hook files, back up our changed files, reject malformed or non-owned collisions, and uninstall only owned entries. Use an installation manifest and explicit opt-in (default off), consistent with recent new integrations. Configured is distinct from a real event verified by the existing hookProcessed mechanism.

Native session IDs take precedence. Legacy CLI without an ID must be scoped to a positively identified Kiro CLI parent process, not cwd or a short-lived hook shell. Missing identity must not merge parallel IDE sessions into one fake session. Hook metadata retains terminal/IDE origin and the persistent agent PID; IDE events return to Kiro, CLI events to their real terminal host. No new polling watcher, model SDK or runtime dependency.

## Verification

Fixture tests for IDE/V3/classic event names, session isolation, malformed/identity-less payloads, completion and non-blocking permissions; installation/update/uninstall and malformed/collision safety in temporary homes; catalog/registry/branding/jump integration; an actual generated-hook-to-bridge smoke with isolated configuration. Validate the classic profile with installed Kiro's CLI schema. Run npm run check and CI. Real authenticated IDE/CLI model turns remain separately stated unless actually observed. Do not overwrite the installed app, real Kiro configuration, or merge this feature automatically.

## References

- https://kiro.dev/docs/hooks/
- https://kiro.dev/docs/hooks/types/
- https://kiro.dev/docs/hooks/actions/
- https://kiro.dev/docs/configuration/
- https://kiro.dev/docs/ide/whats-new-v1/hooks/
- https://kiro.dev/docs/cli/v3/hooks-migration/
- https://kiro.dev/blog/cli-3/

## Installed IDE evidence

Kiro.app 1.4.51, extension 1.1.615: `extensions/kiro.kiro-agent/dist/extension.js` SHA256 `3e2444a1ba237a95b7c1aa4060eecceb19356ad0dfb4fa3de927569992753b4a`. Static inspection (REA tools unavailable; no setup changes) found the enabled v2 capability at line 17618, cache setup at 16754, userConfigDir / KIRO_HOME resolution at 16670, global hooks directory and standalone loader at 3945, and snake_case Hook input construction at 3930. An untrusted workspace takes a no-op branch; static loader evidence is not a real IDE model-turn claim.
