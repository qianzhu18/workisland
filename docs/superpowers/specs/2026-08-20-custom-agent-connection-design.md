# Custom Agent Connection Design

## Goal

Let a non-technical WorkIsland user connect an otherwise unsupported local AI agent when that agent exposes an official local lifecycle Hook, while preserving WorkIsland's existing session, island, duration, and notification behavior.

## User outcome

A user can choose **Connect my agent** in Settings, follow plain-language guidance to discover whether their agent offers an official Hook, safely supply its documented configuration, and verify the connection by sending one real prompt. After a verified event, WorkIsland displays the same project, prompt, running duration, activity, and state-change notifications it shows for built-in agents.

The first validation target is a small, non-built-in local agent such as MIMO, provided it has an official Hook or equivalent local lifecycle interface.

## Scope

### In scope

- A Settings wizard for a user-defined Hook-backed agent.
- A copyable discovery prompt that asks an agent or its official documentation for Hook capability, macOS configuration location, event names, and configuration example, without asking it to execute commands.
- Review, validation, installation, health, uninstall, and real-event verification for user-provided Hook configuration.
- A constrained event mapping from external event names to WorkIsland's existing lifecycle states.
- Clear user-facing states: `not configured`, `needs information`, `configuration invalid`, `configured`, `verified by a real event`, and `unsupported`.
- Built-in investigation/fixes for Trae and DeepSeek Harness remain separate, focused adapters under the parent feature issue.

### Out of scope

- Claiming universal support for every agent.
- Browser DOM injection, private protocol/network interception, OCR/screen scraping, or synthetic lifecycle events.
- Arbitrary file-system watching or arbitrary shell automation supplied by an untrusted agent response.
- Replacing the existing WorkIsland session state machine, island UI, notifications, duration calculation, or built-in adapter registry.
- Automatic installation of a third-party plugin that the user has not reviewed.

## Design choices

### Option A: advanced raw configuration form

Expose only a JSON and command form. This is inexpensive but requires users to understand Hooks and creates a high risk of pasting unsafe or incomplete configuration.

### Option B: fully automatic detection

Scan applications, files, and network traffic to infer agent behavior. This cannot reliably recover prompt/project/lifecycle semantics, has high privacy risk, and produces false positives.

### Option C: guided, verified Hook connection (selected)

Use a visual wizard to teach users what WorkIsland needs, collect only documented Hook details, preview the exact installation action, and require a real event before claiming success. The wizard makes the common case accessible while preserving user consent and a precise unsupported result.

## User flow

1. In Settings, the user selects **Connect my agent**.
2. The wizard explains that WorkIsland can monitor a local agent only when it exposes an official lifecycle Hook, plugin event API, or stable local session data. Version one supports official Hooks.
3. The wizard offers a copyable discovery prompt. It asks for official documentation and the agent's macOS Hook location, event names, and example; it explicitly says not to run commands.
4. The user identifies the agent and supplies its official configuration details through structured fields. Pasting raw JSON is optional; the UI never executes pasted text at this stage.
5. WorkIsland validates the agent display name, config path, supported event mapping, and command template. It rejects paths outside a supported user configuration directory and commands that cannot be parsed into the constrained Hook bridge format.
6. The wizard previews the exact config file and the exact WorkIsland bridge command that will be installed. The user explicitly confirms installation.
7. WorkIsland merges only its marked Hook entries into the documented file and records a manifest for uninstall and health checks.
8. The wizard asks the user to send a real message to that agent. It waits for a bridge event.
9. On receipt, WorkIsland marks the connection **verified**, creates or updates an ordinary session, and shows the normal island behavior. If no event is received, it reports **configured but not verified** with targeted troubleshooting.

## Event contract

The custom connection normalizes only the fields the existing session pipeline already consumes:

```json
{
  "agent": "mimo",
  "event": "UserPromptSubmit",
  "session_id": "agent-owned-session-id",
  "cwd": "/absolute/project/path",
  "prompt": "user prompt",
  "activity": "optional short activity"
}
```

The supported first-version mappings are:

| External lifecycle event | WorkIsland event | Required information |
| --- | --- | --- |
| session start | `SessionStart` | session id |
| user submits work | `UserPromptSubmit` | session id, prompt; cwd recommended |
| agent starts an action | `PreToolUse` | session id |
| agent finishes an action | `PostToolUse` | session id |
| agent finishes turn | `Stop` | session id |
| agent requests attention | `Notification` | session id, optional message |

The event contract is not a public promise that any arbitrary executable may send data. It is an internal normalized payload passed through WorkIsland's existing local `hooks-cli` bridge after the user approves a documented Hook installation.

## Security and privacy boundaries

- The user must explicitly confirm the file and command preview before installation.
- The wizard accepts official Hook configuration only; it does not run arbitrary discovery output.
- It writes only an identified WorkIsland-owned group, preserving user-owned groups and removing only that group on uninstall.
- It stores the minimum connection manifest required for health/uninstall. Prompt content stays in the existing local session behavior; no new telemetry is introduced.
- A failed validation explains the missing capability and offers the discovery prompt again; it never silently falls back to monitoring arbitrary processes.

## Components and boundaries

| Component | Responsibility |
| --- | --- |
| custom connection schema | Validate the user-entered agent identity, documented config target, event map, and bridge command template. |
| custom Hook manager | Merge/remove only WorkIsland-owned entries and persist a manifest. |
| existing hooks-cli and BridgeServer | Receive normalized local events and dispatch them into the existing adapter/session pipeline. |
| custom adapter | Normalize the constrained event map into existing session events; no island-specific logic. |
| Settings wizard | Teach, collect, preview, install, show verification state, and explain unsupported results. |
| verification recorder | Record the timestamp of the first real event for this connection, separate from mere configuration health. |

## Error handling

- Missing Hook capability: show `unsupported` and explain that project, prompt, and lifecycle state cannot be safely inferred.
- Unknown event names: show the supported event list and do not install.
- Unsafe path or malformed config: show the field error and do not write.
- Existing malformed target config: make no modification; direct the user to repair the original configuration.
- No event after installation: show `configured but not verified`; retain an uninstall action and deterministic test instructions.
- Bridge unavailable during a Hook invocation: preserve the agent's workflow, matching existing Hook behavior; show a local health error when WorkIsland next checks the connection.

## Verification

Automated tests must prove:

1. Valid structured input produces a WorkIsland-owned Hook group and preserves user groups.
2. Invalid paths, missing session IDs, unknown events, and malformed JSON are rejected without writes.
3. Uninstall removes only the WorkIsland-owned group.
4. A normalized custom `UserPromptSubmit` event creates the same project/prompt session shape as an existing Hook-managed agent.
5. The first received real event changes the connection state from configured to verified.

Manual macOS evidence must prove:

1. A user can complete the wizard without prior Hook knowledge.
2. A real prompt to MIMO or another non-built-in Hook-capable agent produces island running state, project/prompt information, elapsed duration, and final notification.
3. A deliberately unsupported agent receives a clear unsupported explanation and no configuration write.

## Delivery decomposition

1. Custom connection schema, manifest, manager, and contract tests.
2. Custom adapter and verified-event state, with session-pipeline tests.
3. Settings wizard, preview/consent UI, and renderer tests.
4. Trae real-device root-cause fix as a separate narrowly scoped pull request.
5. DeepSeek Harness plugin adapter as a separate narrowly scoped pull request.

This decomposition deliberately keeps the user-defined Hook feature independently shippable and testable before product-specific integrations.
