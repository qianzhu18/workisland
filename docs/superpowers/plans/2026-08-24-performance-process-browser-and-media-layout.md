# Performance Process Browser and Media Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CPU/memory process browsing with an expandable scrollable list and stabilize the media column.

**Architecture:** The main service publishes all manageable current-user process samples with resident memory. A small renderer model selects and sorts the metric, while the popover owns interaction state. CSS fixes the media column independently of the agent pane.

**Tech Stack:** Electron, Node.js, React runtime, CSS, Node test runner.

---

### Task 1: Publish complete current-user process samples

**Files:**
- Modify: `tests/performance-service.test.mjs`
- Modify: `src/main/performance-service.cjs`

- [ ] Add failing tests proving UID filtering, resident-byte conversion, protected-process marking, and retention beyond five rows.
- [ ] Run `node --test tests/performance-service.test.mjs` and confirm the new assertions fail.
- [ ] Parse `pid,uid,%cpu,%mem,rss,command`, filter to the current UID, and retain all rows.
- [ ] Run the focused test and confirm it passes.

### Task 2: Add testable metric selection and process ordering

**Files:**
- Create: `src/renderer/island/components/performance-process-model.mjs`
- Create: `tests/performance-process-model.test.mjs`

- [ ] Add failing tests for adaptive default metric, CPU/memory ordering, and byte formatting.
- [ ] Run `node --test tests/performance-process-model.test.mjs` and confirm module-not-found failure.
- [ ] Implement pure model helpers and run the focused test to green.

### Task 3: Build the process browser interaction

**Files:**
- Modify: `tests/workstation-ipc.test.mjs`
- Modify: `src/renderer/island/components/PerformancePopover.js`
- Modify: `src/renderer/island/app.css`

- [ ] Add contract assertions for metric buttons, `查看全部`, memory display, protected rows, and a scrollable process list.
- [ ] Run `node --test tests/workstation-ipc.test.mjs` and verify failure.
- [ ] Implement the selected metric, five-row summary, full-list expansion, row metrics, and protected state.
- [ ] Run focused renderer tests and confirm success.

### Task 4: Anchor media to the left column

**Files:**
- Modify: `tests/workstation-ipc.test.mjs`
- Modify: `src/renderer/island/app.css`

- [ ] Add a failing assertion for a stable 300px media column.
- [ ] Replace the proportional media/agent grid with `300px minmax(0, 1fr)` and center the media card within the left column.
- [ ] Run the focused contract test.

### Task 5: Verify and install

**Files:**
- No source files.

- [ ] Run `npm run check` and require all tests to pass.
- [ ] Run `npm run package:mac`, verify the code signature, and replace `/Applications/WorkIsland.app` with a recoverable Trash backup.
- [ ] Inspect CPU mode, memory mode, list scrolling, process confirmation, and stable media placement locally.
- [ ] Commit locally but do not push until user acceptance.
