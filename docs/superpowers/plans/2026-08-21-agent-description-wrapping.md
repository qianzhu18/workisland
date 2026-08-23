# Agent Description Wrapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every Agent description in Settings remains fully readable by wrapping instead of truncating long text.

**Architecture:** Keep the existing Agent card DOM and three-column grid. Change only the shared `.agent-detail` presentation rule, with a source-level regression test that prevents single-line ellipsis styles from returning.

**Tech Stack:** Electron renderer, CSS, Node.js built-in test runner

---

### Task 1: Protect Agent description wrapping

**Files:**
- Modify: `tests/settings-ui.test.mjs`
- Modify: `src/renderer/settings-app.css`

- [ ] **Step 1: Write the failing test**

Add a test that extracts `.agent-detail` from `settings-app.css`, requires `white-space: normal` and `overflow-wrap: anywhere`, and rejects `white-space: nowrap`, `overflow: hidden`, and `text-overflow: ellipsis`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test --test-name-pattern="Agent descriptions wrap" tests/settings-ui.test.mjs`

Expected: FAIL because the current rule contains the truncation declarations.

- [ ] **Step 3: Implement the minimal CSS fix**

Replace the truncation declarations in `.agent-detail` with:

```css
white-space:normal;
overflow-wrap:anywhere;
```

- [ ] **Step 4: Verify focused and full checks**

Run:

```bash
node --test --test-name-pattern="Agent descriptions wrap" tests/settings-ui.test.mjs
npm run check
```

Expected: the focused test passes and the full suite exits successfully.

- [ ] **Step 5: Commit the implementation**

```bash
git add tests/settings-ui.test.mjs src/renderer/settings-app.css
git commit -m "fix(settings): show complete agent descriptions"
```

### Task 2: Build and install for acceptance

**Files:**
- Build artifact: `release/mac-arm64/WorkIsland.app`

- [ ] **Step 1: Build the signed macOS application**

Run: `CSC_NAME='Kun Yang (NV5R86Q3MS)' npm run package:mac`

Expected: all checks pass and Electron Builder produces a signed arm64 application.

- [ ] **Step 2: Verify and install safely**

Verify the new app with `codesign --verify --deep --strict`, quit the current WorkIsland process, move the existing app to Trash as a timestamped backup, install the new app, and relaunch it.

- [ ] **Step 3: Verify runtime readiness**

Confirm the WorkIsland process is running and `~/.flux/run/bridge.sock` exists before handing the build to the user for acceptance.
