# Background Choice Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the indistinguishable glass choice and restore the last cropped custom image when users switch back from a solid background.

**Architecture:** Keep `islandAppearance` as the active background and add a validated `lastIslandImageAppearance` setting as durable image memory. The main-process settings boundary mirrors every active image into that memory; the renderer restores it before opening the picker.

**Tech Stack:** Electron, JavaScript ESM/CommonJS, Node test runner, CSS.

---

### Task 1: Define and verify image-memory semantics

**Files:**
- Modify: `tests/appearance-settings-model.test.mjs`
- Modify: `src/renderer/shared/appearance-settings-model.mjs`

- [ ] **Step 1: Write failing tests** asserting `glass` maps to `solid` and a helper returns a validated remembered image or `null`.
- [ ] **Step 2: Run `node --test tests/appearance-settings-model.test.mjs`** and verify the new assertions fail for the missing behavior.
- [ ] **Step 3: Implement the minimal pure helper** and remove `glass` from the renderer material mapping.
- [ ] **Step 4: Rerun the focused test** and verify it passes.

### Task 2: Persist the last valid image independently

**Files:**
- Modify: `tests/settings.test.mjs`
- Modify: `tests/app-coordinator.test.mjs`
- Modify: `src/shared/settings.cjs`
- Modify: `src/renderer/shared/settings.js`
- Modify: `src/main/app-coordinator.cjs`

- [ ] **Step 1: Write failing tests** for migration from an active image and for retaining image memory when the active background changes to solid.
- [ ] **Step 2: Run the focused settings tests** and verify failures are caused by the absent `lastIslandImageAppearance` behavior.
- [ ] **Step 3: Add the default and normalization path**; mirror valid active image appearances at the coordinator boundary.
- [ ] **Step 4: Rerun focused tests** and verify they pass.

### Task 3: Simplify the selector and restore remembered images

**Files:**
- Modify: `tests/settings-ui.test.mjs`
- Modify: `src/renderer/settings-app.js`

- [ ] **Step 1: Write failing UI contract assertions** for two options, no glass entry, and remembered-image restoration before picker fallback.
- [ ] **Step 2: Run `node --test tests/settings-ui.test.mjs`** and verify the contract fails.
- [ ] **Step 3: Remove the glass entry** and route image selection through the remembered image when present.
- [ ] **Step 4: Rerun the UI test** and verify it passes.

### Task 4: Validate and install

**Files:**
- Verify all modified production and test files.

- [ ] **Step 1: Run `npm run check`** and require all tests to pass.
- [ ] **Step 2: Build the macOS arm64 app** with assets, native modules, and unsigned Electron packaging.
- [ ] **Step 3: Ad-hoc sign and install** `/Applications/WorkIsland.app`, retaining the previous app in a temporary backup.
- [ ] **Step 4: Verify code signature, app.asar hashes, running process path, branch ancestry, and clean intended diff.**
