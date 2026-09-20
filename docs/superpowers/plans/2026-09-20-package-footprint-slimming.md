# Package Footprint Slimming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce WorkIsland package size by retaining only supported Electron locales and removing resources duplicated between app.asar and extraResources.

**Architecture:** Express the package boundary in `package.json` and guard it with source-contract tests. Keep runtime assets at their existing `process.resourcesPath` destinations; retain only `resources/icon.png` and the unpacked native panel module inside the asar input.

**Tech Stack:** electron-builder, ASAR, Node.js source-contract tests, macOS codesign and DMG verification.

---

### Task 1: Lock the package allowlist

**Files:**
- Modify: `tests/local-control-package.test.mjs`
- Modify: `tests/media-bridge-build.test.mjs`
- Modify: `tests/terminal-package.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing package-boundary tests**

Assert `build.electronLanguages` equals `['en', 'zh_CN']`. Assert `build.files` does not contain `resources/**/*`, but contains `resources/icon.png` and `resources/bin/panel_fix.node`. Assert required extraResources still include sounds, pet sprites, templates, skills, hook/CLI launchers, AI manual, media adapter, scripts, DSH bridge, and remote helper.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `node --test tests/local-control-package.test.mjs tests/media-bridge-build.test.mjs tests/terminal-package.test.mjs`

Expected: FAIL because languages are unrestricted and resources use a broad glob.

- [ ] **Step 3: Apply the conservative builder configuration**

Set top-level `build.electronLanguages` to `['en', 'zh_CN']`. Replace `resources/**/*` in `build.files` with `resources/icon.png` and `resources/bin/panel_fix.node`. Do not change extraResources or asarUnpack.

- [ ] **Step 4: Run package-boundary tests**

Run: `node --test tests/local-control-package.test.mjs tests/media-bridge-build.test.mjs tests/terminal-package.test.mjs`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add package.json tests/local-control-package.test.mjs tests/media-bridge-build.test.mjs tests/terminal-package.test.mjs
git commit -m "build: trim unused packaged resources"
```

### Task 2: Package and verify every retained feature

**Files:**
- Modify: `docs/perf/2026-09-19-performance-audit.md`

- [ ] **Step 1: Record the baseline**

Record current App, DMG, app.asar, Electron Framework Resources, and extraResources sizes before rebuilding.

- [ ] **Step 2: Run the complete verification suite**

Run: `npm run check && npm run package:mac`

Expected: 641 or more tests pass; packaging and Developer ID signing succeed.

- [ ] **Step 3: Verify package integrity**

Run `codesign --verify --deep --strict` for the App and `hdiutil verify` for the DMG. Inspect the packaged locale list and confirm only English and Simplified Chinese remain.

- [ ] **Step 4: Run real packaged-app acceptance**

Launch the preview without replacing `/Applications/WorkIsland.app`. Verify Island search, Settings, language switch, pet, sound, media, terminal, templates, CLI, and MCP entrypoints.

- [ ] **Step 5: Record size results and commit**

```bash
git add docs/perf/2026-09-19-performance-audit.md
git commit -m "docs(perf): record package slimming results"
```

### Task 3: Cross-platform gate and delivery

**Files:**
- No source changes expected.

- [ ] **Step 1: Push the branch and open a PR**

Push `codex/perf-slimming-phase-2`, open a PR against `main`, and link Issue #185.

- [ ] **Step 2: Require all CI checks**

Require source contracts, native macOS, Windows x64, and Windows packaged smoke to pass.

- [ ] **Step 3: Merge only after evidence is complete**

Merge after CI, local package verification, and the measured report all agree. Do not merge a size exclusion that breaks any retained feature.
