# Embedded Terminal Keyboard Priority Design

Date: 2026-08-31

## Problem

WorkIsland's full terminal is backed by a real persistent PTY, but the expanded
Island also registers global shortcuts. The collapse shortcut captures Escape,
and optional session-navigation shortcuts capture Up, Down, and Return before
xterm can send those keys to the PTY. Interactive terminal programs therefore
cannot provide the same keyboard behavior as a normal terminal.

The persistent PTY is intentional and remains unchanged. Leaving and reopening
the terminal should preserve the current shell process, working directory, and
recent output.

## Desired Behavior

When the full terminal is mounted and ready for input, terminal interaction has
priority over Island-only ephemeral shortcuts:

- Escape reaches the PTY instead of collapsing the Island.
- Up, Down, and Return reach the PTY instead of navigating or confirming an
  Island session.
- Approval and jump shortcuts that include the configured modifier continue to
  work unless they conflict with ordinary terminal input in a future change.
- Leaving the full terminal restores the normal Island collapse and session
  navigation shortcuts.
- Closing or unmounting the renderer restores shortcuts even if the terminal
  session itself continues running.

## Considered Approaches

### 1. Renderer event interception

Intercept keyboard events on the xterm element and stop propagation. This does
not solve the bug because Electron global shortcuts are handled outside the DOM
and can prevent the renderer from receiving the key at all.

### 2. Change the default shortcuts

Add modifiers to Escape and navigation keys. This reduces conflicts but changes
the product-wide shortcut contract and does not protect users with existing or
custom settings.

### 3. Suspend conflicting shortcuts while the terminal is interactive

The renderer reports terminal-interactive state to the main process. The
shortcut service unregisters only the unmodified collapse and session-selection
keys while that state is active, then restores them afterward. This directly
addresses the ownership conflict without changing PTY persistence or user
settings. This is the selected approach.

## Architecture and Data Flow

`TerminalPanel` owns whether the full terminal UI is mounted. On entry it sends
an idempotent `terminalInteractive: true` signal through the preload bridge; its
effect cleanup sends `false`.

The main process forwards this state to `ShortcutService`. `ShortcutService`
stores the state and reconciles registrations:

- interactive: unregister collapse, Up, Down, and Return;
- non-interactive and panel expanded: restore the configured collapse shortcut
  and eligible session-navigation shortcuts;
- panel collapsed: keep existing collapsed behavior and clear terminal
  interactivity defensively.

Repeated true or false signals are harmless. Renderer teardown cannot leave the
keyboard permanently unregistered because panel collapse also resets the state.

## Error Handling

The IPC message contains only a boolean and performs no privileged operation.
Missing bridge methods remain optional so a mismatched renderer does not crash.
Shortcut registration failures continue to use the service's existing status
and conflict handling.

## Verification

Automated tests will first reproduce the bug at the shortcut-service boundary:

1. Expanding the Island registers Escape and, when enabled, Up and Down.
2. Activating terminal interaction unregisters Escape, Up, Down, and Return.
3. Deactivating terminal interaction restores the appropriate shortcuts.
4. Collapsing the panel clears interactive state and preserves existing cleanup.
5. Renderer contract tests verify the enter and cleanup signals around the full
   terminal lifecycle.

The focused test must fail before implementation and pass afterward. The full
test suite and renderer syntax checks must remain green. A final manual smoke
test should run an interactive CLI in the packaged or development app and verify
Escape cancellation plus arrow-key selection in the embedded terminal.

## Out of Scope

- Creating multiple terminal tabs or sessions.
- Replacing the persistent PTY lifecycle.
- Changing saved-command behavior or terminal appearance.
- Redesigning global shortcut settings.
