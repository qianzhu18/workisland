# WorkIsland Productivity Toolbox Design

## Goal

Add three locally operated productivity modules to the expanded WorkIsland panel:

- a temporary file shelf;
- searchable clipboard history;
- saved quick commands plus a persistent interactive terminal.

The Agent workspace remains the product's primary surface. Agent approval, question, failure, and completion events retain priority over every utility module.

## Product structure

The expanded Island gains a compact module switcher:

`Agent | 文件架 | 剪贴板 | 终端`

Only enabled modules appear. Agent cannot be disabled. The current module is remembered locally, except that an Agent event requiring attention immediately selects Agent and opens the existing actionable view. Returning to a utility restores its prior scroll position and selection during the same app run.

Media keeps its existing collapsed presentation and Agent-side split behavior. Performance remains in the upper-right toolbar. Utility modules occupy the existing main content area instead of opening separate floating windows.

## Settings and defaults

The Workstation settings section adds:

- `fileShelfEnabled`, default `true`;
- `clipboardHistoryEnabled`, default `false`;
- `terminalEnabled`, default `true`;
- `clipboardHistoryLimit`, default `100`, allowed values `25`, `50`, `100`, and `250`;
- `clipboardRetentionHours`, default `24`, allowed values `1`, `8`, `24`, `168`, and `0` for manual deletion only;
- `terminalShell`, default to the user's login shell, with `/bin/zsh` as a safe fallback;
- `terminalDefaultDirectory`, default `agent-project`, with alternatives `home` and a user-selected directory;
- `terminalSavedCommands`, an ordered collection of user-created command cards.

Turning clipboard history off stops monitoring immediately and clears persisted clipboard entries after confirmation. Turning terminal off terminates its shell process after confirmation. Turning the shelf off hides it without deleting shelf references; the user can clear them explicitly.

## File shelf

### Interaction

- Dragging files, folders, images, text, or links over the collapsed Island opens the expanded Island directly on the shelf.
- Dropped files and folders are stored as references to their original paths. WorkIsland never moves, copies, uploads, or deletes the originals merely by shelving them.
- Dropped text and links are stored as small local shelf records.
- The shelf presents compact thumbnails or type icons, names, and missing-file status.
- A single click selects an item. Space opens Quick Look for file-backed items. Command-click and Shift-click support multiple selection.
- Items can be dragged back to Finder or another application. The operating system determines whether the destination copies or moves the source.
- Item actions are: Open, Reveal in Finder, Copy Path or Copy Content, and Remove from Shelf.
- “Remove from Shelf” only removes the reference. It never deletes the source file.
- A clear-all action requires confirmation and also removes references only.

### Persistence and validation

Shelf metadata is stored under Electron `userData` as versioned JSON. Paths are canonicalized, deduplicated, length-bounded, and revalidated before every open, reveal, preview, or drag-out operation. Missing files remain visible with a clear unavailable state until removed.

The renderer never receives arbitrary filesystem access. The main process owns path validation and exposes narrow IPC operations. The preload converts dropped browser `File` objects to trusted local paths through Electron's supported file-path bridge.

## Clipboard history

### Capture

Clipboard monitoring is opt-in and local-only. While enabled, the main process polls the macOS general pasteboard change count at a restrained interval and records a new entry only when the change count advances.

The first version supports:

- plain text and source-code-like text;
- web links;
- images with bounded dimensions and encoded size;
- file lists as references, without reading the file contents.

Identical consecutive entries are deduplicated. Empty values, oversized payloads, and unsupported clipboard formats are ignored. WorkIsland writes carry an internal fingerprint so selecting a history item does not create a duplicate entry.

### Storage and privacy

Entries are stored only under Electron `userData`. Text is length-bounded, image previews are resized, total storage is capped, and retention cleanup runs on startup and while monitoring. No clipboard content is included in telemetry, logs, crash context, Agent events, or network requests.

The clipboard panel provides search, type filters, copy, favorite, delete, and clear-all. Favorites are retained until manually removed even when ordinary entries expire, but still count toward the storage cap. Disabling history offers “关闭并清空” and “仅停止记录” choices.

Password-manager-specific detection is not treated as a security boundary because clipboard contents do not reliably identify their source application. The UI explains this plainly before enabling history.

## Quick commands and terminal

### Two-layer experience

The terminal module opens on a friendly command-card view. Each card has a name, command preview, working-directory rule, and Run button. Built-in cards are read-only examples such as “查看 Git 状态” and “运行项目测试”; they appear only when their prerequisites are detected.

“进入完整终端” opens a persistent PTY-backed shell rendered with a terminal emulator. It supports ANSI output, interactive programs, resize, scrolling, selection, copy/paste, Ctrl-C, and normal shell exit. Closing or switching the Island does not terminate the PTY. Quitting WorkIsland or disabling the terminal terminates it cleanly.

### Working directory

The initial directory resolves in this order:

1. the currently focused Agent session's valid project directory when the setting is `agent-project`;
2. the user-selected valid directory;
3. the user's home directory.

The terminal header always displays the current directory. Starting a new shell lets the user choose the current Agent project, Home, or another directory.

### Command safety

- WorkIsland does not silently generate or execute commands.
- Running a saved command is an explicit user action.
- Creating or editing a card displays the exact command and working directory before saving.
- Commands matching destructive shell patterns receive an additional warning, but the warning is advisory rather than presented as perfect detection.
- Quick commands and the terminal run as the current user and never request administrator privileges on the user's behalf.
- Output is local and is not sent to an Agent or model in this scope.

The implementation uses the `node-pty` package pinned in `package-lock.json`, rebuilt for the pinned Electron runtime and included in packaged macOS artifacts. Terminal creation, input, resize, and termination are isolated behind a `TerminalService`; the renderer only receives bounded output events and status.

## Main-process services and IPC

The feature is split into focused services:

- `ShelfService`: metadata persistence, path validation, Quick Look/open/reveal, and native drag-out preparation;
- `ClipboardHistoryService`: clipboard polling, normalization, deduplication, retention, and replay;
- `TerminalService`: one PTY lifecycle, working-directory resolution, input, resize, output throttling, and saved-command execution;
- `ProductivityToolboxModel`: pure renderer logic for enabled tabs, selection, attention preemption, search, and sorting.

Every IPC channel has a narrow request and response contract. Payload sizes, identifiers, indexes, paths, and terminal dimensions are validated in the main process. Services start only when their setting is enabled and stop immediately when disabled.

## Visual behavior

The switcher uses the same dark material, radii, spacing, and hover motion as the existing Agent panel. It does not add a second navigation bar or enlarge the collapsed pill.

- Empty shelf: a restrained drop target with “把文件拖到这里临时存放”.
- Empty clipboard: an explanation and one clear “启用剪贴板历史” action.
- Terminal cards: a two-column compact grid when width permits and one column at narrow widths.
- Full terminal: dark terminal canvas, small directory breadcrumb, New Shell and Back controls.
- Drag-over: the Island expands with a soft green outline and shelf icon pulse; reduced-motion users receive a static highlight.

All panels fit within the existing screen-aware maximum height and scroll internally. Focus, keyboard capture, and mouse-leave behavior must not collapse the Island while a user is typing in the terminal, searching clipboard history, selecting shelf items, or dragging.

## Failure handling

- A vanished shelf file becomes unavailable; it is never silently removed.
- Clipboard read failures are nonfatal and retried only on the next change.
- A terminated shell shows its exit code and offers Restart.
- PTY startup failure leaves Agent, media, performance, shelf, and clipboard functional.
- A failed quick command displays its exit status and retained output.
- Corrupt persisted JSON is quarantined and replaced with an empty versioned store rather than crashing startup.

## Testing and acceptance

Automated tests cover settings migration, enabled-tab selection, Agent attention preemption, shelf path validation, reference-only removal, clipboard normalization and deduplication, retention, replay suppression, PTY lifecycle, working-directory fallback, bounded IPC payloads, and packaged native-module inclusion.

Manual acceptance uses the packaged app installed in `/Applications` and verifies:

1. Drag a real file and folder into the collapsed Island, preview them, reveal them, drag them back out, then remove the references while originals remain intact.
2. Enable clipboard history, copy text, a URL, code, an image, and files, then search, favorite, replay, expire, clear, disable, and restart the app.
3. Run a saved command in the current Agent project, open the full terminal, run an interactive command, resize, use Ctrl-C, switch tabs, reopen, and confirm the session persists.
4. Trigger an Agent approval while every utility is active and confirm Agent immediately takes priority without losing utility state.
5. Toggle every module in Settings and confirm services actually start and stop, not merely hide their UI.
6. Verify reduced-motion behavior, no-notch/external-display layout, focus retention, and internal scrolling.
7. Run the full source contract and unit suite, build the macOS package, verify code signing, install it, and repeat the smoke tests outside development mode.

## Scope exclusions

This branch does not add AI chat, natural-language computer control, cloud sync, cross-device clipboard, AirDrop orchestration, file deletion, calendar, camera, keep-awake, Windows support, or mobile support.

Atoll and other GPL-licensed products are behavioral references only. WorkIsland implementation code, tests, styles, and assets are written independently.
