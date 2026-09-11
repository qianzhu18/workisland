# Toolbar Free Home Slot Implementation Plan

> **For agentic workers:** Implement inline with test-driven development.

**Goal:** Remove the permanent Agent Home slot and return the reclaimed space to draggable toolbar tools.

**Architecture:** Keep the existing two-bank slot model and persistence contract. Change only right-bank slot generation and selectable-tool activation; fixed action tools remain unchanged.

**Tech Stack:** Electron renderer, React runtime, JavaScript, Node test runner.

---

### Task 1: Lock layout and navigation behavior

**Files:**
- Modify: `tests/toolbar-model.test.mjs`
- Modify: `tests/productivity-toolbox-ui.test.mjs`

- [x] Assert that no `home` position exists in the layout result.
- [x] Assert that the reclaimed right slot remains outside the camera safety zone.
- [x] Assert that re-selecting the active tool resolves to Agent Home.
- [x] Run the focused tests and confirm they fail against the old implementation.

### Task 2: Reclaim the slot

**Files:**
- Modify: `src/renderer/island/components/toolbar-model.mjs`
- Modify: `src/renderer/island/components/ToolbarTools.js`
- Modify: `src/renderer/island/components/IslandPanel.js`
- Modify: `src/renderer/island/components/IslandPanel.css`

- [x] Start right-bank slots at the already-expanded camera safety boundary.
- [x] Remove the fixed Home control and its icon plumbing.
- [x] Toggle an active selectable tool back to Agent Home.
- [x] Reuse the active tool's slot for a contextual Home icon and label.
- [x] Keep action-only tools, More, Settings, and drag persistence unchanged.

### Task 3: Verify and deliver

**Files:**
- Verify: `tests/toolbar-model.test.mjs`
- Verify: `tests/productivity-toolbox-ui.test.mjs`
- Verify: `tests/clear-sessions-toolbar.test.mjs`

- [x] Run focused tests.
- [x] Run `npm run check`.
- [x] Build and install a local signed preview.
- [x] Verify the visible toolbar and return interaction.
- [x] Open a PR and wait for user acceptance before merge.
