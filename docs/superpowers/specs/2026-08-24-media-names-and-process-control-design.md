# Media Names and Process Control Design

## Goal

Show recognizable media application names and let users terminate a high-usage
process from WorkIsland with Activity Monitor-style safety and feedback.

## Media application names

`MediaService` resolves a now-playing bundle identifier to a display name once
per bundle identifier and caches the result. Resolution order:

1. WorkIsland brand overrides for names users expect, including
   `com.apple.Music` as `Apple Music` and `com.netease.163music` as
   `网易云音乐`.
2. The installed application's localized macOS display name when available.
3. A readable fallback derived from the final bundle identifier component.

The renderer continues to receive a plain `appName`; no filesystem lookup is
performed in the renderer.

## Process actions

Each sampled process row carries the PID, display name, owning UID, and a
command fingerprint used only for validation. Clicking a row opens an inline
confirmation area inside the performance popover with two actions:

- **退出** sends `SIGTERM`.
- **强制退出** sends `SIGKILL` and uses destructive red styling.

No signal is sent until the user chooses one of these actions.

## Safety boundary

The main process owns all validation and signaling. Renderer input is treated
as untrusted. Immediately before signaling, WorkIsland reads the process again
and rejects the request when:

- PID is not a positive integer greater than 1;
- the process no longer exists;
- the current UID does not own the process;
- the current command no longer matches the sampled fingerprint;
- the target is WorkIsland or one of its helper processes.

The implementation uses Node's `process.kill(pid, signal)` and never builds a
shell command from renderer input. Root-owned and other-user processes are not
actionable.

## IPC and feedback

A narrow request-response IPC accepts the sampled process identity and one of
`terminate` or `force`. It returns a structured result with `ok` and a stable
reason code. The UI translates the code into concise Chinese feedback:

- operation succeeded;
- process already ended;
- process identity changed;
- protected process;
- insufficient permission;
- operation failed.

After success, the performance service samples immediately so the row
disappears without waiting for the regular interval. While a request is in
progress, both action buttons are disabled to prevent duplicate signals.

## Testing

Tests cover:

- Apple Music and NetEase Cloud Music brand names;
- localized-name and readable fallbacks;
- PID, ownership, fingerprint, and WorkIsland self-protection;
- correct `SIGTERM` and `SIGKILL` selection;
- IPC/preload contract exposure;
- confirmation and result-state behavior in pure renderer models;
- the complete existing unit suite and packaged macOS build.

No code is merged until the locally installed application is visually checked
and accepted.
