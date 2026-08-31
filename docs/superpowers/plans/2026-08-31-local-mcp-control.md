# WorkIsland Local MCP Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an explicitly authorized local AI client inspect and change a safe subset of WorkIsland settings, inspect/focus visible sessions, and open safe product surfaces through one shared local API used by MCP and a CLI.

**Architecture:** Extend the existing per-user newline-JSON socket with a separate `control.*` request family. A main-process `LocalControlService` owns schema validation, redaction, persistence, audit, undo, and UI actions; thin CLI and MCP stdio adapters only translate their protocols into that service. Agent control is off by default, and all exposed settings are explicit allowlist entries.

**Tech Stack:** Electron 43, Node.js 22 CommonJS application code, ESM-only `@modelcontextprotocol/server@2`, `zod@4`, Node test runner, existing HTML/CSS/vanilla-JS renderer.

---

## Task 1: Lock the safe settings contract

**Files:**

- Create: `src/shared/settings-control-schema.cjs`
- Modify: `src/shared/settings.cjs`
- Test: `tests/settings-control-schema.test.mjs`

- [ ] Add failing tests proving the registry contains only the agreed reversible keys, omits privacy/approval/path/terminal-command settings, and rejects unknown keys.
- [ ] Add failing tests for every supported validator: booleans; `sound.volume` integer `0..100`; `completionPopupDurationSec` integer `1..60`; `petScale` number `0.5..2`; display enums; and an installed-pet callback.
- [ ] Run `node --test tests/settings-control-schema.test.mjs` and confirm the new tests fail because the module does not exist.
- [ ] Add `localAgentControlEnabled: false` to `DEFAULT_SETTINGS`.
- [ ] Implement an immutable registry with dotted keys and explicit `readable`, `writable`, `defaultValue`, `restartRequired`, `validate`, `read`, and `toPartial` behavior. `sound.enabled` and `sound.volume` must construct a merged `sound` object rather than overwrite sibling fields.
- [ ] Export `describeControlledSettings(settings)`, `readControlledSettings(settings, keys)`, and `validateControlledChanges(settings, changes, context)`. Validation must finish for the entire bounded object (maximum 20 keys) before returning a settings partial.
- [ ] Re-run the focused test and commit:

```bash
node --test tests/settings-control-schema.test.mjs
git add src/shared/settings-control-schema.cjs src/shared/settings.cjs tests/settings-control-schema.test.mjs
git commit -m "feat(mcp): define safe settings control schema"
```

## Task 2: Implement the main-process control service

**Files:**

- Create: `src/main/local-control-service.cjs`
- Create: `src/main/local-control-audit.cjs`
- Test: `tests/local-control-service.test.mjs`
- Test: `tests/local-control-redaction.test.mjs`

- [ ] Write failing service tests for `LOCAL_CONTROL_DISABLED`, atomic multi-key validation, normalized application through injected `updateSettings`, and no write when one key is invalid.
- [ ] Write failing compare-and-swap undo tests: a recent change restores its old values; a later user/agent edit returns `UNDO_CONFLICT` and changes nothing.
- [ ] Write failing session tests proving the public response contains only `id`, `agent`, `phase`, `updatedAt`, `requiresAttention`, and `canFocus`; assert prompts, summaries, paths, terminal IDs, PIDs, and raw payload fields do not appear in serialized output.
- [ ] Run both focused files and confirm failure.
- [ ] Implement `LocalControlService` with dependency injection for `getSettings`, `updateSettings`, `getSessions`, `jumpToSession`, `openSettingsTab`, `setDisplaySurface`, `presentSettingsChange`, and `now`.
- [ ] Generate per-process opaque public session IDs using `crypto.randomBytes`; maintain bidirectional maps only for currently visible sessions; never accept raw internal IDs in `focusSession`.
- [ ] Implement a 50-entry change journal and compare-and-swap undo. Each record contains only change ID, bounded client label, safe formatted values, controlled keys, timestamp, and result.
- [ ] Implement `LocalControlAudit` as a capped 100-entry JSON store under Electron `userData`, using atomic temp-file rename and filtering every record through a fixed field picker.
- [ ] Re-run tests and commit:

```bash
node --test tests/local-control-service.test.mjs tests/local-control-redaction.test.mjs
git add src/main/local-control-service.cjs src/main/local-control-audit.cjs tests/local-control-service.test.mjs tests/local-control-redaction.test.mjs
git commit -m "feat(mcp): add guarded local control service"
```

## Task 3: Extend the local bridge without widening hook authority

**Files:**

- Modify: `src/main/bridge-protocol.cjs`
- Modify: `src/main/bridge-server.cjs`
- Modify: `src/main/app-coordinator.cjs`
- Modify: `src/main/index.cjs`
- Create: `src/island/local-control-client.cjs`
- Test: `tests/local-control-protocol.test.mjs`
- Test: `tests/bridge-server.test.mjs`

- [ ] Add failing tests for `{ id, command, params, client }` control requests and exactly one `{ id, ok, result }` or `{ id, ok: false, error: { code, message, details? } }` response.
- [ ] Add failing tests for malformed JSON, missing/oversized IDs, payloads above 64 KiB, timeouts, and a disabled master switch.
- [ ] Preserve existing hook frames: prove `processHook`, `resolvePermission`, `answerQuestion`, and `reportTokenUsage` still work without request IDs and cannot invoke `control.*` behavior.
- [ ] Run focused tests and confirm the new protocol expectations fail.
- [ ] Add a dedicated `control.*` dispatch path in `BridgeServer`; route only to `LocalControlService`, and write responses only for request-style frames.
- [ ] On Unix, create `~/.flux/run` with mode `0700`, remove stale sockets safely, and chmod the active socket `0600`; keep the existing Windows named pipe behavior.
- [ ] Wire the service in `index.cjs`/`app-coordinator.cjs` through existing settings, session, jump, Settings-window, and pet/island methods. Do not expose the coordinator object to the socket.
- [ ] Implement `requestLocalControl(command, params, options)` with connection timeout, response timeout, request-ID matching, one-line size limits, and stable error objects.
- [ ] Re-run focused tests and commit:

```bash
node --test tests/local-control-protocol.test.mjs tests/bridge-server.test.mjs
git add src/main/bridge-protocol.cjs src/main/bridge-server.cjs src/main/app-coordinator.cjs src/main/index.cjs src/island/local-control-client.cjs tests/local-control-protocol.test.mjs tests/bridge-server.test.mjs
git commit -m "feat(mcp): expose authenticated local control bridge"
```

## Task 4: Add the automation CLI

**Files:**

- Create: `src/island/workisland-cli/index.cjs`
- Test: `tests/workisland-cli.test.mjs`
- Modify: `package.json`

- [ ] Write failing spawned-process tests for `settings list`, `settings get <key>`, `settings set <key> <json-value>`, `settings undo <change-id>`, `sessions list`, `session focus <public-id>`, `settings open <section>`, `surface set <island|pet>`, and `state`.
- [ ] Assert stdout is one JSON document, diagnostics use stderr, success exits `0`, usage errors exit `2`, and WorkIsland/control errors exit `1` with the stable error code.
- [ ] Implement a dependency-free argument parser and map commands only to the shared local-control client. Never add a general command execution escape hatch.
- [ ] Add a package `bin` entry named `workisland` pointing to the CLI and ensure the file begins with `#!/usr/bin/env node`.
- [ ] Re-run tests and commit:

```bash
node --test tests/workisland-cli.test.mjs
git add src/island/workisland-cli/index.cjs tests/workisland-cli.test.mjs package.json
git commit -m "feat(mcp): add WorkIsland automation CLI"
```

## Task 5: Add the MCP stdio server

**Files:**

- Create: `src/island/workisland-mcp/index.mjs`
- Create: `src/island/workisland-mcp/tools.mjs`
- Test: `tests/workisland-mcp.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] Install exact major-compatible dependencies with `npm install @modelcontextprotocol/server@^2 zod@^4`.
- [ ] Write a failing MCP integration test that starts the stdio server against a fake socket, completes MCP initialization, lists tools, and calls each tool through an official SDK client transport.
- [ ] Assert the advertised tools are exactly `describe_settings`, `get_settings`, `update_settings`, `undo_settings_change`, `get_product_state`, `list_visible_sessions`, `focus_session`, `open_settings`, and `set_display_surface`.
- [ ] Assert stdout contains MCP JSON-RPC only, while startup/errors go to stderr; also test `WORKISLAND_UNAVAILABLE` and `LOCAL_CONTROL_DISABLED` as tool errors.
- [ ] Implement Zod schemas with bounded arrays/objects/strings. Forward every tool through `requestLocalControl`; do not import settings storage or Electron.
- [ ] Add a package `bin` entry named `workisland-mcp`; keep the entry `.mjs` because the maintained MCP v2 server package is ESM-only.
- [ ] Re-run tests and commit:

```bash
node --test tests/workisland-mcp.test.mjs
git add src/island/workisland-mcp package.json package-lock.json tests/workisland-mcp.test.mjs
git commit -m "feat(mcp): publish WorkIsland stdio tools"
```

## Task 6: Build client setup and the Agent Control settings page

**Files:**

- Create: `src/main/mcp-client-config.cjs`
- Modify: `src/shared/ipc.cjs`
- Modify: `src/main/ipc-services.cjs`
- Modify: `src/preload/settings.js`
- Modify: `src/renderer/island/renderer/settings.html`
- Modify: `src/renderer/settings-app.js`
- Modify: `src/renderer/settings.css`
- Test: `tests/mcp-client-config.test.mjs`
- Test: `tests/agent-control-ui.test.mjs`

- [ ] Write failing adapter tests that detect the local Codex executable/config, preserve unrelated TOML, create one timestamped backup, add/update exactly `[mcp_servers.workisland]`, parse the written file, avoid duplicate entries, and disconnect only WorkIsland.
- [ ] Write failing UI source-contract tests for the default-off switch, clear explanation, detected-client status, connect/disconnect action, manual JSON/TOML snippet, copy action, activity list, and error state.
- [ ] Implement a Codex adapter using the official `~/.codex/config.toml` MCP format and `@iarna/toml`; inject filesystem/home/executable paths for tests. Generate the command from `process.execPath`, set `ELECTRON_RUN_AS_NODE=1`, and point args at the packaged MCP `.mjs` entry. Do not claim other clients are configured; show them only through manual instructions until an adapter is verified.
- [ ] Add IPC channels for control status, connect, disconnect, manual config, and recent activity. Validate all main-process inputs; expose only purpose-built preload methods.
- [ ] Add the **智能体控制** settings navigation/page. Show that the master switch and MCP registration are two separate requirements. Disable connect while WorkIsland control is off, but let the user preview the exact target/command.
- [ ] Show “已配置，等待首次调用” after a valid config write and “已连接” only after the bridge records a real MCP initialization/tool request.
- [ ] Re-run tests and commit:

```bash
node --test tests/mcp-client-config.test.mjs tests/agent-control-ui.test.mjs
git add src/main/mcp-client-config.cjs src/shared/ipc.cjs src/main/ipc-services.cjs src/preload/settings.js src/renderer/island/renderer/settings.html src/renderer/settings-app.js src/renderer/settings.css tests/mcp-client-config.test.mjs tests/agent-control-ui.test.mjs
git commit -m "feat(mcp): add Agent Control settings experience"
```

## Task 7: Add non-interrupting change feedback and undo

**Files:**

- Create: `src/renderer/island/components/SettingsChangeCard.js`
- Modify: `src/renderer/island/app.js`
- Modify: `src/renderer/island/styles.css`
- Modify: `src/main/app-coordinator.cjs`
- Modify: `src/main/ipc-services.cjs`
- Modify: `src/preload/island.js`
- Test: `tests/settings-change-presentation.test.mjs`

- [ ] Write failing policy tests: change notices queue behind approvals/questions/errors; group same-client changes within one second; auto-dismiss after five seconds; never replace attention surfaces; and silently fall back to activity history if stale.
- [ ] Write failing action tests for Undo and “查看设置”; the former calls compare-and-swap undo and the latter opens the Agent Control page.
- [ ] Implement a `settingsChange` surface containing only safe formatted values and a bounded client label. Render one concise card with grouped rows and accessible buttons.
- [ ] Keep the notice at lower priority than all action-required/error surfaces in both Island and pet mode. Respect reduced-motion and reuse existing transition timings.
- [ ] Re-run tests and commit:

```bash
node --test tests/settings-change-presentation.test.mjs
git add src/renderer/island/components/SettingsChangeCard.js src/renderer/island/app.js src/renderer/island/styles.css src/main/app-coordinator.cjs src/main/ipc-services.cjs src/preload/island.js tests/settings-change-presentation.test.mjs
git commit -m "feat(mcp): show reversible agent setting changes"
```

## Task 8: Packaging, documentation, and acceptance

**Files:**

- Modify: `package.json`
- Modify: `README.md`
- Create: `docs/local-agent-control.md`
- Modify: `scripts/check.mjs`
- Test: `tests/local-control-package.test.mjs`

- [ ] Add a failing package-contract test that proves both CLI entries and MCP runtime dependencies are included in the packaged app/asar and executable through Electron's Node mode.
- [ ] Document the security boundary, default-off behavior, official Codex setup, manual setup, tool list, CLI examples, error codes, privacy limits, and removal steps.
- [ ] Add source checks that forbid raw settings-file access, Electron imports, TCP listeners, child-process execution, or approval/session-delete commands from `src/island/workisland-mcp`.
- [ ] Run the focused MCP/control suite, then the entire project check:

```bash
node --test tests/settings-control-schema.test.mjs tests/local-control-service.test.mjs tests/local-control-redaction.test.mjs tests/local-control-protocol.test.mjs tests/bridge-server.test.mjs tests/workisland-cli.test.mjs tests/workisland-mcp.test.mjs tests/mcp-client-config.test.mjs tests/agent-control-ui.test.mjs tests/settings-change-presentation.test.mjs tests/local-control-package.test.mjs
npm run check
npm run package:mac
```

- [ ] Install the built DMG/app on this Mac, enable Agent Control, connect Codex, and start a fresh Codex session.
- [ ] Verify a real MCP call can describe settings, change completion duration, list/focus a session, open Settings, show the Island change notice, undo, and then fail immediately after the master switch is turned off.
- [ ] Record artifact path, SHA-256, installed version, real-call evidence, and any unverified Windows gate in the PR.
- [ ] Review `git diff origin/main...HEAD`, ensure only intended files are staged, run `git diff --check`, and scan for `TODO|FIXME|placeholder|not implemented` in new production paths.
- [ ] Commit final packaging/docs changes:

```bash
git add package.json README.md docs/local-agent-control.md scripts/check.mjs tests/local-control-package.test.mjs
git commit -m "docs(mcp): document and package local agent control"
```

- [ ] Push `codex/local-mcp-control`, open a PR linked with `Closes #11`, wait for CI, merge only after required checks pass, fetch `origin/main`, prove the feature commits are ancestors of it, and confirm Issue #11 is closed.

## Plan self-review checklist

- [ ] Every production behavior above has a preceding failing test.
- [ ] The master switch is enforced in the WorkIsland process on every request.
- [ ] Raw settings, raw session IDs/content, terminal operations, approvals, destructive actions, and arbitrary UI/URL actions cannot cross the local-control boundary.
- [ ] MCP and CLI contain translation only; the main process remains the policy authority.
- [ ] Configuration success and real connection success are presented as different states.
- [ ] User-facing changes are immediate, visible, reversible, grouped, and non-interrupting.
- [ ] Existing hook protocol and unrelated dirty workspace files remain untouched.
