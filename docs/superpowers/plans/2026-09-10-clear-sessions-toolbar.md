# Clear Sessions Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the bulk session cleanup action from a full-width list row into a draggable toolbar trash icon.

**Architecture:** Treat `clear-sessions` as an action-style `ToolbarTools` extra so it inherits ordering, slot placement, overflow, and drag persistence without becoming a navigable content module. `IslandPanel` supplies visible session IDs and the existing bridge action; settings validation admits the new stable tool ID.

**Tech Stack:** Electron renderer, React `createElement`, shared JSON i18n catalogs, Node test runner.

---

### Task 1: Lock the toolbar contract with failing tests

**Files:**
- Modify: `tests/toolbox-module-order.test.mjs`
- Create: `tests/clear-sessions-toolbar.test.mjs`

- [ ] **Step 1: Extend the settings test with `clear-sessions` preferences**

Add assertions that all four toolbar preference fields preserve `clear-sessions` and still reject unknown IDs.

- [ ] **Step 2: Add a source contract test**

Read `IslandPanel.js` and assert that it defines the `clear-sessions` extra, uses `t("session.clear")`, calls `deleteSessions(visibleSessionIds)`, applies a disabled state when the array is empty, and no longer renders `session-list-actions`.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `node --test tests/toolbox-module-order.test.mjs tests/clear-sessions-toolbar.test.mjs`

Expected: FAIL because `clear-sessions` is rejected by settings and the old list action remains.

### Task 2: Implement the draggable action tool

**Files:**
- Modify: `src/shared/settings.cjs`
- Modify: `src/renderer/island/components/ToolbarTools.js`
- Modify: `src/renderer/island/components/IslandPanel.js`
- Modify: `src/renderer/island/components/IslandPanel.css`

- [ ] **Step 1: Admit the stable tool ID**

Add `clear-sessions` to the toolbar settings whitelist and to the full order used by `handleToolboxModuleReorder`.

- [ ] **Step 2: Support disabled action tools**

Forward a tool definition's `disabled` value as `aria-disabled` and short-circuit activation so click and keyboard activation are blocked without affecting drag handles.

- [ ] **Step 3: Define and wire the trash action**

Add a `ClearSessionsToolIcon`, pass the visible IDs into `AgentUsageRow`, and append an action tool whose label is `t("session.clear")`, whose action calls `window.islandBridge?.deleteSessions(visibleSessionIds)`, and whose disabled state reflects an empty list.

- [ ] **Step 4: Remove the old row**

Delete the `session-list-actions` JSX and its two CSS rules.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `node --test tests/toolbox-module-order.test.mjs tests/clear-sessions-toolbar.test.mjs`

Expected: PASS.

### Task 3: Validate, deliver, and close the issue

**Files:**
- Modify only if validation reveals a scoped defect.

- [ ] **Step 1: Run the full repository check**

Run: `npm run check`

Expected: renderer build, i18n checks, source contracts, and unit tests all pass.

- [ ] **Step 2: Commit and push the implementation**

Stage only the spec, plan, tests, settings, toolbar component, panel component, and panel CSS. Commit with an Issue #139-focused message and push `codex/issue-139-clear-sessions-toolbar`.

- [ ] **Step 3: Open and merge the PR**

Create a PR targeting `main` with `Closes #139`, wait for required checks, merge it, fetch, and verify the feature commit is an ancestor of `origin/main`.

- [ ] **Step 4: Verify issue closure**

Confirm Issue #139 is closed after the PR merge and report the PR URL, merge commit, checks, and branch/worktree isolation.
