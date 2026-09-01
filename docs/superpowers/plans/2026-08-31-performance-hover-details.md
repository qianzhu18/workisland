# Performance Hover Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore reliable process details in the system performance popover by showing explicit loading/empty feedback, immediately reusing the latest successful process sample, and making pointer transfer forgiving.

**Architecture:** Extend `PerformanceService` with an in-memory last-successful process cache and explicit process-detail status fields. Keep hidden sampling lightweight, publish cached data synchronously when details open, then refresh on demand. Let the existing renderer choose between loading, list, and empty/unavailable rows from those fields, while preserving all existing sorting and process actions.

**Tech Stack:** Electron, Node.js CommonJS service, React renderer, Node test runner, CSS.

---

## Task 1: Specify cached process-detail behavior with failing tests

**Files:**
- Modify: `tests/performance-service.test.mjs`

- [ ] Add a test that completes one successful macOS process sample, hides details, reopens them with the next `/bin/ps` call deferred, and asserts that `getSnapshot()` immediately contains the cached list with `processesLoading: true`.
- [ ] Add a test that completes one successful process sample, makes the next `/bin/ps` call fail, and asserts that the cached list remains available after refresh while loading ends.
- [ ] Run `node --test tests/performance-service.test.mjs` and confirm both new tests fail for the missing cache/status behavior.
- [ ] Commit the failing behavioral specification together with its eventual implementation in Task 2.

## Task 2: Implement service cache and status transitions

**Files:**
- Modify: `src/main/performance-service.cjs`
- Test: `tests/performance-service.test.mjs`

- [ ] Initialize a last-successful process cache and process-detail state flags without enabling hidden process sampling.
- [ ] When details become visible, synchronously publish cached processes and a loading state, then start the existing on-demand sample.
- [ ] On a successful `/bin/ps` or PowerShell process sample, replace the cache and publish `processesLoaded: true`, `processesLoading: false`, and `processesUnavailable: false`.
- [ ] On a failed process refresh, preserve the cache, end loading, and publish an unavailable state only when there is no usable cached list.
- [ ] When details are hidden, continue publishing an empty active process list and do not execute process-detail commands.
- [ ] Run `node --test tests/performance-service.test.mjs` and confirm all service tests pass.
- [ ] Commit with message `fix(performance): preserve process details across hover`.

## Task 3: Specify and implement renderer feedback and hover grace

**Files:**
- Modify: `tests/workstation-ipc.test.mjs`
- Modify: `src/renderer/island/components/PerformancePopover.js`
- Modify: `src/renderer/island/app.css`

- [ ] Add renderer contract assertions for an explicit process status row, loading copy, empty/unavailable copy, and a 350 ms close delay.
- [ ] Run `node --test tests/workstation-ipc.test.mjs` and confirm the new assertions fail.
- [ ] Change the close grace period from 140 ms to 350 ms.
- [ ] Render a compact `role="status"` row when no process records exist: loading during the first sample, unavailable after a failed first sample, and empty after a successful zero-row sample.
- [ ] Add restrained styling for the status row without changing the existing process list, sorting, pinning, or action controls.
- [ ] Run `node --test tests/workstation-ipc.test.mjs tests/renderer-syntax.test.mjs` and confirm both pass.
- [ ] Commit with message `fix(performance): show process loading feedback`.

## Task 4: Regression and build verification

**Files:**
- Verify only; no planned source edits.

- [ ] Run the focused performance and IPC tests.
- [ ] Run the full project test command from `package.json`.
- [ ] Run the production build/package command used by the repository and confirm the artifact is produced successfully.
- [ ] Inspect `git diff --check`, `git status --short`, and the branch diff to confirm only the intended plan, service, renderer, CSS, and test files are committed; preserve unrelated user changes.

## Task 5: Deliver through PR and close Issue #67

**Files:**
- No local source edits planned.

- [ ] Push `codex/fix-performance-hover-details` to origin.
- [ ] Open a pull request whose body includes `Closes #67`, summarizes the cached-first/loading behavior, and lists exact verification evidence.
- [ ] Wait for required CI checks and address any failures within scope.
- [ ] Merge the pull request.
- [ ] Fetch `origin --prune` and verify the feature commits are ancestors of `origin/main`.
- [ ] Verify GitHub Issue #67 is closed and report the PR, merged commit, tests, build artifact, and any remaining local-only verification gate.

## Plan self-review

- [ ] Confirm every approved design requirement is represented: first-open loading, cached reopen, failed-refresh preservation, explicit empty/unavailable feedback, 350 ms hover grace, no hidden process scanning, and unchanged process controls.
- [ ] Scan changed files for placeholders such as `TODO`, `FIXME`, mock-only branches, or skipped assertions.
- [ ] Confirm service state fields use consistent boolean semantics across macOS, Windows, IPC snapshots, and renderer conditions.
