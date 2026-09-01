# Embedded Terminal Keyboard Priority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure interactive programs inside WorkIsland's full terminal receive Escape, Up, Down, and Return without Island global shortcuts intercepting them.

**Architecture:** The full terminal renderer reports an interactive boolean through a narrow IPC channel. The main process passes it to `ShortcutService`, which suspends conflicting unmodified shortcuts while the terminal is active and restores them when interaction ends.

**Tech Stack:** Electron IPC, JavaScript/CommonJS, React/xterm, Node.js test runner

---

### Task 1: Reproduce shortcut capture at the service boundary

**Files:**
- Create: `tests/shortcut-terminal-interactive.test.mjs`
- Modify: `src/main/shortcut-service.cjs`

- [ ] **Step 1: Write the failing test**

Create a fake `electron.globalShortcut`, expand the panel with collapse and session switching enabled, and assert that calling the wished-for `setTerminalInteractive(true)` unregisters `Esc`, `Up`, `Down`, and `Return`. Then assert `false` restores `Esc`, `Up`, and `Down`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/shortcut-terminal-interactive.test.mjs`

Expected: FAIL because `setTerminalInteractive` does not exist.

- [ ] **Step 3: Write minimal implementation**

Inject `globalShortcut` through the constructor, add `terminalInteractive`, add `setTerminalInteractive(interactive)`, and prevent `registerCollapse`, `registerSwitchSession`, and `registerConfirmKey` from registering while interactive. Reset the state when the panel collapses.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/shortcut-terminal-interactive.test.mjs`

Expected: PASS.

### Task 2: Connect terminal lifecycle through IPC

**Files:**
- Modify: `tests/productivity-ipc.test.mjs`
- Modify: `tests/productivity-toolbox-ui.test.mjs`
- Modify: `src/shared/ipc.cjs`
- Modify: `src/preload/island.js`
- Modify: `src/renderer/island/components/TerminalPanel.js`
- Modify: `src/main/index.cjs`

- [ ] **Step 1: Write failing source-contract tests**

Require `TERMINAL_INTERACTIVE_CHANGED` in the IPC contract, `setTerminalInteractive` in preload, effect entry and cleanup calls in `TerminalPanel`, and the main-process listener forwarding the boolean into `ShortcutService`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/productivity-ipc.test.mjs tests/productivity-toolbox-ui.test.mjs`

Expected: FAIL on the missing channel and lifecycle calls.

- [ ] **Step 3: Write minimal wiring**

Add the channel, preload method, terminal effect entry/cleanup calls, and main listener. Use `Boolean(interactive)` at the trusted main-process boundary.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `node --test tests/shortcut-terminal-interactive.test.mjs tests/productivity-ipc.test.mjs tests/productivity-toolbox-ui.test.mjs`

Expected: PASS.

### Task 3: Regression verification

**Files:**
- Verify only

- [ ] **Step 1: Run renderer syntax and terminal tests**

Run: `node --test tests/renderer-syntax.test.mjs tests/terminal-service.test.mjs tests/terminal-package.test.mjs`

Expected: PASS.

- [ ] **Step 2: Run the full unit suite**

Run: `npm run test:unit`

Expected: all tests PASS.

- [ ] **Step 3: Run source/build checks**

Run: `npm run check`

Expected: renderer build, source checks, and unit tests PASS.

- [ ] **Step 4: Review intended diff only**

Run: `git diff --check` and inspect the diff for the files named above. Confirm unrelated dirty-worktree files are unchanged.
