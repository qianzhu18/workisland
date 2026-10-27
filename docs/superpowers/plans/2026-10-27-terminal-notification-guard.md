# Terminal Notification Guard Implementation Plan

**Goal:** Keep the terminal page and input intact during automatic Agent notifications, with explicit access to unresolved actions.

**Architecture:** Route automatic Agent surfaces through a pure renderer policy using committed terminal visibility. Derive pending items from live Agent sessions; explicit selection uses the existing session surface. Guard both scheduling and firing of auto-dismiss timers.

**Tech Stack:** Existing Electron, React, session store, xterm, node:test; no new dependencies.

## Steps

- [x] Add `tests/terminal-notification-policy.test.mjs`: `shouldDeferAgentSurface({surface,reason}, visible)` is true only for automatic `sessionList` / `completion` while viewing terminals; `terminalPendingSessions(sessions)` selects visible unresolved actions/errors, de-duplicates IDs and orders newest first. Run the file before implementation and observe the missing policy failure.
- [x] Implement `src/renderer/island/components/terminal-notification-policy.mjs`; use the existing `isVisibleInIsland`. In `app.js`, read `[data-terminal-viewing="true"]` at IPC receipt and timer firing; ignore only automatic Agent presentation while protected. In `TerminalPanel.js`, emit that attribute from `panelOpen && active` so managers and full terminals are both covered.
- [x] Add `TerminalAgentNotices.js` with native `details`/`summary`, pending count and per-session buttons. Feed live Agent sessions from `IslandPanel.js`. Explicit clicks call `onAgentNotice`, select the Agent tool and present a targeted click surface. Keep labels escaped and localized, list height bounded, and reuse existing terminal colors.
- [x] Run focused policy/presentation/terminal checks, then an isolated actual Electron interaction script with genuine PTY input and synthetic main-process IPC events. Prove no auto-switch/no auto-close, correct pending selection, later normal notifications, and context persistence. Keep existing user sessions and installed app untouched.
- [x] Update PRD-013, terminal guide and CHANGELOG. Run `npm run check`, inspect the real UI, commit and update PR #201 with exact results; verify CI on the final head (tracked in PR checks). No merge or public release.
