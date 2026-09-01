# WorkIsland Local MCP Control Design

Issue: [#11](https://github.com/qianzhu18/workisland/issues/11)

## Product intent

WorkIsland should be usable by people and by local AI agents. A user should be able to say “把完成提醒改成 10 秒” or “帮我打开 Codex 那个任务”, and an authorized local agent should complete the request through structured WorkIsland tools.

This is not process injection. WorkIsland remains the only process allowed to read, validate, persist, and apply its settings. Terminal commands and MCP calls are two clients of the same local control API.

## User experience

Settings gains an **智能体控制** section with:

- A master switch: **允许智能体控制 WorkIsland**, off by default.
- A **连接已检测的智能体** action that detects supported local clients and writes their MCP configuration only after the user clicks it.
- A connection-status list for detected clients such as Codex, Claude Code, and Cursor when their real local configuration format is supported.
- A manual configuration block for other MCP clients.
- A local recent-activity list showing which client read or changed WorkIsland and when.

Enabling the master switch does not make agents discover WorkIsland automatically. An MCP entry must still be installed in each client. Once a client is configured and the master switch is on, allowed calls do not require per-call or per-client confirmation.

### Natural-language examples

- “WorkIsland 现在有哪些设置可以改？”
- “完成提醒改成 10 秒。”
- “切成极简模式，关闭媒体切歌提醒。”
- “现在灵动岛上有哪些任务？”
- “帮我回到刚才那个 Codex 任务。”
- “打开 WorkIsland 的智能体设置。”

### Change feedback

Allowed setting changes take effect immediately. WorkIsland then shows a low-priority Island notice such as:

> Codex 修改了 WorkIsland 设置  
> 完成提醒：5 秒 → 10 秒  
> 撤销 · 查看设置

The notice auto-dismisses after five seconds. Multiple changes arriving within one second are grouped into one notice. A settings notice never replaces an approval, question, or error surface; if an attention surface is active, the change is recorded and the notice waits until that surface is resolved or expires silently into the activity list.

Undo uses compare-and-swap semantics: WorkIsland only restores the old value when the current value still equals the value written by that change. This prevents an old notice from overwriting a newer user or agent edit.

## Architecture

```text
Codex / Claude / Cursor                    Human / local scripts
           | MCP over stdio                         | CLI
           v                                        v
    workisland-mcp                           workisland CLI
           \                                        /
            +------ shared local control client ----+
                                |
                     Unix socket / named pipe
                                |
                         running WorkIsland
                                |
              schema, validation, application, audit
```

No TCP listener or public network endpoint is introduced.

### 1. Settings control schema

A single settings-control registry describes every setting that may be exposed. Each entry contains:

- Stable key and localized label.
- Value type and allowed enum, range, or validation rule.
- Whether it is readable through local control.
- Whether it is writable through local control.
- Whether applying it requires a restart.
- A safe formatter for change notifications.

New product settings are not MCP-writable automatically. A developer must explicitly mark them writable. The Settings UI, CLI, and MCP read this same registry so descriptions and validation do not drift.

The registry delegates final persistence and side effects to the existing WorkIsland settings/coordinator path. MCP never writes the settings JSON file directly.

### Initial writable settings

The first version exposes low-impact, reversible product preferences:

- Island display mode and hover/collapse behavior.
- Completion-notification duration.
- Sound enabled state and volume.
- Media display, lyrics, and track-change notifications.
- Performance monitor and performance alerts.
- File shelf, terminal panel, and usage-dashboard visibility.
- Usage quota display preference.
- Pet scale and an already-installed pet selection.
- Update-check preference.

The exact list is generated from the registry and returned by the discovery tools. Unsupported keys fail closed.

### Excluded write settings

The first version does not allow MCP to:

- Approve or deny agent permission requests.
- Answer agent questions or confirm plans.
- Run terminal commands or modify saved commands.
- Delete sessions, clipboard entries, shelf files, usage data, or logs.
- Kill processes.
- Enable clipboard history, telemetry, or other privacy-sensitive collection.
- Install or uninstall hooks, agents, pets, files, or updates.
- Change approval modes, filesystem paths, login-item behavior, or arbitrary nested settings.

These exclusions apply even when the master switch is enabled.

### 2. Local control protocol

The existing WorkIsland Unix socket on macOS/Linux and named pipe on Windows is extended with request IDs and structured result/error responses. It gains commands for schema discovery, safe settings reads/writes, redacted session reads, and allowlisted UI actions.

The socket directory is restricted to the current OS user. The master switch is checked inside WorkIsland on every control request, not only in the MCP wrapper, so a stale or custom client cannot bypass it.

Hook ingestion and MCP control use separate command families and validation paths. Existing hook clients remain backward compatible and cannot gain control privileges by changing their hook payload.

### 3. MCP server

`workisland-mcp` is a small bundled stdio server started by the external agent. It uses the maintained MCP SDK, publishes tool definitions, forwards validated requests to the running WorkIsland instance, and returns structured results.

It does not import Electron internals, inspect WorkIsland storage, or stay resident after its MCP client exits. If WorkIsland is not running or local control is disabled, it returns an actionable error rather than attempting to launch or modify the application silently.

### 4. CLI

The bundled CLI uses the same local-control client and supports equivalent human/script access:

```bash
workisland settings list
workisland settings get completionPopupDurationSec
workisland settings set completionPopupDurationSec 10
workisland sessions list
workisland session focus <public-session-id>
workisland settings open agents
```

CLI output is JSON by default for reliable automation, with a concise human-readable mode available for interactive use. The CLI cannot access more capabilities than MCP.

## MCP tool surface

The first release exposes these tools:

### `describe_settings`

Returns the readable setting registry: key, label, description, type, constraints, current value, default value, writable flag, and restart requirement. Sensitive or internal settings are omitted rather than redacted in place.

### `get_settings`

Reads all exposed settings or a requested list of keys.

### `update_settings`

Accepts a bounded object of setting changes. The whole request is validated before any setting is applied. Invalid requests are atomic: no partial write occurs. A successful result returns normalized old/new values and a change ID that can be undone.

### `undo_settings_change`

Attempts to undo one recent MCP/CLI change by change ID. It reports a conflict instead of overwriting a newer value.

### `get_product_state`

Returns display surface (`island` or `pet`), expanded/collapsed state, enabled workstation modules, visible-session count, and whether any session requires attention. It does not return screen coordinates or window handles.

### `list_visible_sessions`

Returns a redacted list containing a short public session ID, agent label, phase, last update time, attention requirement, and whether a jump target exists. It omits prompts, assistant text, summaries, transcript paths, working directories, terminal identifiers, PIDs, and raw hook payloads.

### `focus_session`

Accepts only a public session ID returned by `list_visible_sessions` and invokes WorkIsland’s existing jump behavior. Unknown, expired, or non-jumpable sessions fail without falling back to arbitrary URLs or commands.

### `open_settings`

Opens WorkIsland Settings at an allowlisted section such as General, Agents, Workstation, Appearance, or Agent Control. It cannot open arbitrary URLs.

### `set_display_surface`

Switches between Island and pet using WorkIsland-owned placement defaults. It cannot choose arbitrary screen coordinates or manipulate other application windows.

## Client setup

Supported client installers are isolated adapters. Each adapter must:

1. Detect a real installed client and its supported configuration location/version.
2. Parse the existing configuration without discarding unrelated entries.
3. Show the proposed target in WorkIsland before writing.
4. Create a recoverable backup.
5. Add or update only the `workisland` MCP entry.
6. Verify the resulting configuration parses successfully.
7. Offer disconnect, which removes only the WorkIsland-owned entry.

The initial release supports only clients whose current local configuration has been verified in this repository and on a real machine. Other clients receive a generated manual configuration snippet. WorkIsland does not claim “connected” merely because a file exists; connection status requires a real MCP initialization or tool call from that client.

## Audit and privacy

WorkIsland stores a bounded local activity log containing:

- Timestamp.
- MCP client label/version when supplied during initialization.
- Tool name.
- Changed setting keys and safe old/new display values.
- Success, rejection, conflict, or unavailable result.

The log never stores prompts, session text, working directories, terminal contents, environment variables, secrets, or raw MCP arguments unrelated to allowlisted values. It is local-only and capped by count/size.

Client-reported names are untrusted display strings: they are length-bounded and never used for authorization. Under the selected authorization model, the user authorizes local control globally with the master switch; configured clients do not receive separate permanent credentials.

## Error handling

- WorkIsland not running: return `WORKISLAND_UNAVAILABLE` with instructions to start it.
- Master switch off: return `LOCAL_CONTROL_DISABLED`.
- Unknown or non-writable setting: return `SETTING_NOT_ALLOWED` without partial changes.
- Invalid value: return the schema constraint and normalized examples.
- Newer change blocks undo: return `UNDO_CONFLICT`.
- Session disappeared or cannot jump: return `SESSION_UNAVAILABLE`.
- Client config cannot be parsed: do not write; preserve the original file and show manual setup.
- Notification cannot be shown because an attention surface is active: keep the audit entry and do not interrupt the user.

## Testing and acceptance

### Automated

- Registry tests cover every exposed type, constraint, formatter, and exclusion.
- Update tests prove atomic validation, normalized persistence, side effects, master-switch enforcement, and compare-and-swap undo.
- Redaction tests prove session text, paths, PIDs, and raw payloads never cross the control API.
- Protocol tests cover request IDs, malformed frames, bounded payloads, old hook-client compatibility, and disabled control.
- MCP integration tests spawn the stdio server against a fake local WorkIsland socket and exercise tool discovery and calls.
- CLI integration tests verify equivalent results and exit codes.
- Client installer tests preserve unrelated config, create backups, avoid duplicates, and disconnect cleanly.
- Renderer tests verify grouped change notices, priority below attention surfaces, auto-dismiss, open-settings, and undo.
- Full macOS and Windows project checks remain green.

### Real-machine acceptance

- Enable Agent Control from WorkIsland Settings.
- Install the MCP entry into at least one verified local client through the UI.
- Start a fresh client session and observe a real MCP initialize/tool call before showing “connected”.
- Ask the agent to describe settings, change completion duration, list sessions, focus one session, and open a Settings section.
- Confirm changes take effect, the Island notice identifies the client, undo works, and the local audit entry is present.
- Turn the master switch off and confirm the same configured client is rejected immediately.

## Delivery boundaries

This feature does not make every installed agent discover MCP automatically. It provides one-click configuration for verified clients and a manual path for the rest. It does not create a remote WorkIsland API, grant agents general shell access, or make agent-originated approval decisions.

The implementation is complete only when source tests, packaged artifacts, at least one real configured client call, settings feedback, undo, and master-switch revocation have all been verified independently.
