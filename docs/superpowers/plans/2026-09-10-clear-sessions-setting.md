# Clear Sessions Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the clear-sessions toolbar action discoverable and reversible from Productivity Tools settings.

**Architecture:** Add one default-on `clearSessionsEnabled` setting and carry it through the existing settings renderer, Island live-settings state, and `IslandPanel` props. The toggle controls whether the `clear-sessions` tool definition exists; toolbar layout preferences remain untouched, so re-enabling restores the user's placement.

**Tech Stack:** Electron renderer, React `createElement`, shared CommonJS settings model, JSON locale catalogs, Node test runner.

---

### Task 1: Specify the setting contract with failing tests

**Files:**
- Modify: `tests/settings-workstation.test.mjs`
- Modify: `tests/settings-ui.test.mjs`
- Modify: `tests/clear-sessions-toolbar.test.mjs`
- Modify: `tests/settings-control-schema.test.mjs`

- [ ] **Step 1: Assert default and persisted values**

Add `assert.equal(settings.DEFAULT_SETTINGS.clearSessionsEnabled, true)` and verify `mergeSettings({ clearSessionsEnabled: false })` remains false while an invalid stored value falls back to true.

- [ ] **Step 2: Assert settings and Island wiring**

Require `settings.general.clearSessions.title`, `save({ clearSessionsEnabled: v })`, Island state synchronization, and conditional inclusion `...(clearSessionsEnabled ? [{ id: 'clear-sessions' ... }] : [])`.

- [ ] **Step 3: Assert controlled-settings consistency**

Add `clearSessionsEnabled` to the expected reversible settings allowlist and assert its default is true.

- [ ] **Step 4: Run focused tests and verify RED**

Run: `node --test tests/settings-workstation.test.mjs tests/settings-ui.test.mjs tests/clear-sessions-toolbar.test.mjs tests/settings-control-schema.test.mjs`

Expected: FAIL because the setting, UI row, and Island prop do not exist.

### Task 2: Implement the default-on setting and live UI behavior

**Files:**
- Modify: `src/shared/settings.cjs`
- Modify: `src/shared/settings-control-schema.cjs`
- Modify: `src/renderer/settings-app.js`
- Modify: `src/renderer/island/app.js`
- Modify: `src/renderer/island/components/IslandPanel.js`
- Modify: `src/renderer/island/components/SettingsChangeCard.js`
- Modify: `src/locales/en.json`
- Modify: `src/locales/zh-CN.json`

- [ ] **Step 1: Add and normalize the setting**

Add `clearSessionsEnabled: true` beside productivity defaults and normalize with `merged.clearSessionsEnabled = parsed.clearSessionsEnabled !== false`.

- [ ] **Step 2: Add localized settings copy**

Add English title/description “Clear Sessions” / “Show a draggable trash button in the Island toolbar for clearing all visible sessions.” and Chinese title/description “清理会话” / “在 Island 顶部快捷栏显示可拖动的垃圾桶按钮，用于清理全部可见会话。”

- [ ] **Step 3: Add the Productivity Tools row**

Append a `featureSettingsRow("clear-sessions", ...)` with `toggle(state.settings.clearSessionsEnabled, v => save({ clearSessionsEnabled: v }), ...)`.

- [ ] **Step 4: Synchronize live Island state**

Create `clearSessionsEnabled` state from `DEFAULT_SETTINGS`, update it in both `getSettings` and `onSettingsChanged`, pass it to `IslandPanel`, and conditionally create the existing toolbar action.

- [ ] **Step 5: Register reversible local control**

Add a boolean controlled setting and a localized SettingsChangeCard label for `clearSessionsEnabled`.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `node --test tests/settings-workstation.test.mjs tests/settings-ui.test.mjs tests/clear-sessions-toolbar.test.mjs tests/settings-control-schema.test.mjs`

Expected: PASS.

### Task 3: Build the preview for user acceptance

**Files:**
- Modify only if validation finds a scoped regression.

- [ ] **Step 1: Run full validation**

Run: `npm run check`

Expected: renderer build, aligned locale catalogs, source checks, and all unit tests pass.

- [ ] **Step 2: Commit and push the PR branch**

Commit only the scoped setting, localization, renderer, tests, spec, and plan files; push `codex/issue-139-clear-sessions-setting` and open a PR without auto-merge.

- [ ] **Step 3: Package and install**

Build the arm64 macOS app from this branch, ad-hoc sign the local preview, back up `/Applications/WorkIsland.app`, install the preview, verify the installed `app.asar` hash, and launch it.

- [ ] **Step 4: Stop at the acceptance gate**

Report the open PR, installed build, tests, and backup path. Do not merge until the user explicitly approves the installed preview.
