# Media Source App Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the native icon of the application owning the current macOS media session instead of a text source badge.

**Architecture:** Add an injected, cached main-process resolver that maps a validated bundle identifier to a local `.app` icon data URL. Enrich media snapshots asynchronously and render a bounded 32 px icon overlay with a neutral fallback.

**Tech Stack:** Electron main process, Node.js child processes and filesystem, React renderer, CSS, Node test runner.

---

### Task 1: Native application icon resolver

**Files:**
- Create: `src/main/app-icon-resolver.cjs`
- Create: `tests/app-icon-resolver.test.mjs`

- [ ] **Step 1: Write failing resolver tests**

Test a valid Spotlight `.app` lookup and PNG conversion, invalid bundle identifiers, non-application output, failure, and repeated cache access.

- [ ] **Step 2: Run the resolver test and verify RED**

Run: `node --test tests/app-icon-resolver.test.mjs`

Expected: FAIL because `app-icon-resolver.cjs` does not exist.

- [ ] **Step 3: Implement the minimal resolver**

Expose `createAppIconResolver({ locateApplication, getFileIcon, pathExists, maxDataUrlLength })`. Validate bundle identifiers, require an existing `.app` path, convert the native image with `resize({ width: 64, height: 64 }).toPNG()`, return a bounded PNG data URL, and cache the resulting promise.

- [ ] **Step 4: Run the resolver test and verify GREEN**

Run: `node --test tests/app-icon-resolver.test.mjs`

Expected: PASS.

### Task 2: Media snapshot icon contract and enrichment

**Files:**
- Modify: `src/shared/media-state.cjs`
- Modify: `src/main/media-service.cjs`
- Modify: `src/main/app-coordinator.cjs`
- Modify: `tests/media-state.test.mjs`
- Modify: `tests/media-service.test.mjs`

- [ ] **Step 1: Write failing contract and enrichment tests**

Require `appIconDataUrl` to accept only bounded PNG data URLs. Require `MediaService` to emit metadata immediately, then emit icon-enriched state, reuse the resolver cache, and reject a completed icon lookup after the media source changed.

- [ ] **Step 2: Run the media tests and verify RED**

Run: `node --test tests/media-state.test.mjs tests/media-service.test.mjs`

Expected: FAIL because the new field and resolver injection are absent.

- [ ] **Step 3: Implement minimal enrichment**

Add `appIconDataUrl` to the empty and normalized media contract. Inject `resolveAppIcon` into `MediaService`, start resolution after each adapter snapshot, and update only when the current bundle identifier still matches. Wire Electron `app.getFileIcon` and the resolver into `AppCoordinator`.

- [ ] **Step 4: Run media tests and verify GREEN**

Run: `node --test tests/media-state.test.mjs tests/media-service.test.mjs`

Expected: PASS.

### Task 3: Artwork overlay UI

**Files:**
- Modify: `src/renderer/island/components/MediaCard.js`
- Modify: `src/renderer/island/app.css`
- Modify: `tests/workstation-ipc.test.mjs`

- [ ] **Step 1: Write failing renderer contract test**

Assert the media card uses an image source icon, includes a neutral fallback class, and no longer renders `media.appName` inside the artwork badge.

- [ ] **Step 2: Run the renderer test and verify RED**

Run: `node --test tests/workstation-ipc.test.mjs`

Expected: FAIL because the text badge is still present.

- [ ] **Step 3: Implement the overlay**

Render a 32 px image when `appIconDataUrl` exists and a neutral bundled media mark otherwise. Add lower-right positioning, border, shadow, a one-shot scale/fade entrance, and reduced-motion handling.

- [ ] **Step 4: Run renderer and full tests**

Run: `npm run check`

Expected: all tests pass.

### Task 4: Package and local visual acceptance

**Files:**
- No source changes expected.

- [ ] **Step 1: Build the macOS package**

Run: `npm run package:mac`

Expected: signed `release/mac-arm64/WorkIsland.app` and DMG.

- [ ] **Step 2: Install recoverably**

Move the current `/Applications/WorkIsland.app` to a uniquely named Trash backup, copy the new app into `/Applications`, verify its signature, and launch it.

- [ ] **Step 3: Capture live Apple Music or NetEase evidence**

Play media, expand WorkIsland, and confirm the lower-right overlay is the owning app's icon with no text badge.

- [ ] **Step 4: Stop before publishing**

Do not push or update PR #45 until the user accepts the installed visual result.

