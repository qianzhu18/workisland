# Shelf Quick Share and Drag Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every shelf drag release the Island interaction lock and provide a persistent, user-selectable macOS quick-share service.

**Architecture:** A small drag-lease state object owns the active state and fails closed after a bounded timeout. The native AppKit addon asynchronously discovers share services and directly invokes the selected service; the main process resolves trusted shelf IDs and persists only the selected service name.

**Tech Stack:** Electron 43, Node.js IPC, React renderer, Objective-C++ AppKit N-API addon, node:test.

---

### Task 1: Make drag locking self-releasing

**Files:**
- Modify: `src/main/island-file-drop-interaction.cjs`
- Modify: `src/main/windows.cjs`
- Modify: `src/renderer/island/components/ShelfPanel.js`
- Test: `tests/island-file-drop-interaction.test.mjs`
- Test: `tests/productivity-toolbox-ui.test.mjs`

- [ ] Add a failing fake-timer test proving an active drag lease expires and a source `dragend` is wired to release it.
- [ ] Run `node --test tests/island-file-drop-interaction.test.mjs tests/productivity-toolbox-ui.test.mjs` and verify the missing lease/`dragend` assertions fail.
- [ ] Implement `createFileDropInteraction({ setTimeout, clearTimeout, timeoutMs })` so `setActive(true)` renews a bounded lease, `setActive(false)` clears it, and expiry restores mouse forwarding.
- [ ] Add `onDragEnd` and Promise-finally cleanup to shelf item drag sources.
- [ ] Re-run the two tests and verify they pass.

### Task 2: Discover and execute native quick-share services

**Files:**
- Modify: `native/panel-fix/src/panel_fix.mm`
- Modify: `src/main/native-platform-service.cjs`
- Modify: `src/main/index.cjs`
- Test: `tests/productivity-ipc.test.mjs`
- Test: `scripts/test-source.mjs`

- [ ] Add failing source-contract tests for `getShareProviders` and `shareFilesViaProvider`, provider icons, AirDrop-first ordering, and system-menu fallback.
- [ ] Run the targeted tests and verify the new native methods are missing.
- [ ] Implement AppKit provider enumeration from `NSSharingService.sharingServicesForItems`, producing bounded PNG icons and stable titles; inject essential services and the system-menu fallback.
- [ ] Implement direct provider execution with `canPerformWithItems`; return a structured result so callers can distinguish direct share, fallback and failure.
- [ ] Expose both methods through the native platform service and main-process dependency injection.
- [ ] Rebuild with `npm run build:native` and re-run targeted tests.

### Task 3: Persist the default and expose narrow IPC

**Files:**
- Modify: `src/shared/settings.cjs`
- Modify: `src/shared/ipc.cjs`
- Modify: `src/preload/island.js`
- Modify: `src/preload/settings.js`
- Modify: `src/main/ipc-services.cjs`
- Test: `tests/settings-ui.test.mjs`
- Test: `tests/productivity-ipc.test.mjs`

- [ ] Add failing tests for `shelfQuickShareProvider: "AirDrop"`, provider-list IPC, trusted shelf-ID sharing, and a narrow default-provider setter.
- [ ] Verify the tests fail because the setting and IPC contracts do not exist.
- [ ] Add normalized persistence for the provider name and IPC methods `getShelfShareProviders`, `setShelfQuickShareProvider`, `shareShelfItemsViaDefault`.
- [ ] Resolve IDs to available local paths in the main process and fall back to the system picker when the provider is unavailable.
- [ ] Re-run targeted tests.

### Task 4: Replace the duplicate share UI

**Files:**
- Modify: `src/renderer/island/components/ShelfPanel.js`
- Modify: `src/renderer/island/app.css`
- Modify: `src/renderer/island/app.js`
- Modify: `src/renderer/settings-app.js`
- Modify: `src/renderer/settings-app.css`
- Test: `tests/productivity-toolbox-ui.test.mjs`
- Test: `tests/settings-ui.test.mjs`

- [ ] Add failing UI-contract tests for current-provider artwork/name, a switch popover, direct default drops, an explicit one-time system-share action, and synchronized settings selection.
- [ ] Verify the UI tests fail for the missing quick-share controls.
- [ ] Render the current provider in the left drop zone, add the compact switch popover, and invoke default sharing for internal and native drops.
- [ ] Add the settings selector using the same provider list and persistence setter.
- [ ] Re-run UI tests.

### Task 5: Verify the complete interaction

**Files:**
- Modify only if a test exposes a defect.

- [ ] Run `npm run check` and require all tests to pass.
- [ ] Build the native addon and launch the development app independently of the terminal.
- [ ] Verify repeated file drag-out/cancel cycles restore hover expansion.
- [ ] Verify AirDrop direct sharing, provider switching, restart persistence and one-time system sharing.
- [ ] Build/install only after the user accepts the development preview; do not commit or push before acceptance.
