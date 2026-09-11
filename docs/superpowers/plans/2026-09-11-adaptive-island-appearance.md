# Adaptive Island Appearance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver polished frosted-glass, solid-color, and custom-image Island backgrounds with 0% background opacity, adaptive readable foregrounds, and a truly hollow performance gauge.

**Architecture:** Keep `src/shared/appearance.cjs` authoritative for persisted appearance validation, add a small renderer-side profile compiler for atomic background/foreground styling, and isolate settings transitions in a testable model. Reuse the existing managed-image service through one narrow file-picker IPC instead of exposing filesystem paths to the renderer.

**Tech Stack:** Electron IPC, renderer JavaScript/React, CSS custom properties and masks, Node.js test runner.

---

### Task 1: Extend the appearance contract and settings transition model

**Files:**
- Create: `src/renderer/shared/appearance-settings-model.mjs`
- Modify: `src/shared/appearance.cjs`
- Modify: `tests/appearance-theme.test.mjs`
- Create: `tests/appearance-settings-model.test.mjs`

- [ ] **Step 1: Write failing contract tests**

Add assertions that `MIN_OPACITY` is `0`, `normalizeIslandAppearance({ kind: "solid", color: "#ffffff", opacity: 0 })` preserves white and zero opacity, and `kind: "glass"` accepts a tint color plus opacity.

- [ ] **Step 2: Write failing transition-model tests**

Define the desired API before implementation:

```js
const solid = appearanceForMaterial({ kind: "default" }, "solid");
assert.deepEqual(solid, { kind: "solid", color: "#000000", opacity: 1 });
assert.deepEqual(withAppearanceColor({ kind: "default" }, "#ffffff"), {
  kind: "solid", color: "#ffffff", opacity: 1
});
assert.deepEqual(withAppearanceOpacity({ kind: "default" }, 0), {
  kind: "solid", color: "#000000", opacity: 0
});
assert.equal(materialForAppearance({ kind: "gradient" }), "solid");
```

- [ ] **Step 3: Run focused tests and verify RED**

Run: `node --test tests/appearance-theme.test.mjs tests/appearance-settings-model.test.mjs`  
Expected: FAIL because glass/zero-opacity and the settings model do not exist.

- [ ] **Step 4: Implement the minimal shared contract and model**

Add `glass` to `APPEARANCE_KINDS`, change the opacity lower bound to zero, preserve valid user colors instead of auto-darkening them, normalize glass like solid, and implement the four pure transition helpers used by the tests.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `node --test tests/appearance-theme.test.mjs tests/appearance-settings-model.test.mjs`  
Expected: all focused tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/shared/appearance.cjs src/renderer/shared/appearance-settings-model.mjs tests/appearance-theme.test.mjs tests/appearance-settings-model.test.mjs
git commit -m "feat(appearance): support glass and transparent color backgrounds"
```

### Task 2: Compile adaptive foreground profiles atomically

**Files:**
- Modify: `src/renderer/island/theme.mjs`
- Modify: `tests/renderer-theme.test.mjs`

- [ ] **Step 1: Write failing profile tests**

Cover dark opaque solid → `light`, light opaque solid → `dark`, low-opacity solid → `glass`, glass/image → `glass`, and gradient classification using both endpoints. Assert that applying and then restoring appearance updates/removes `--island-bg`, `--island-backdrop`, `data-island-tone`, `data-island-material`, and `data-island-transparent` together.

- [ ] **Step 2: Run the renderer test and verify RED**

Run: `node --test tests/renderer-theme.test.mjs`  
Expected: FAIL because `islandAppearanceProfile` and material properties do not exist.

- [ ] **Step 3: Implement the profile compiler**

Export `islandAppearanceProfile(appearance)` and have `applyIslandAppearance()` apply its result. Use a 0.58 opacity threshold for wallpaper-dependent glass protection, a luminance threshold chosen by measured contrast against the two foreground palettes, and `blur(24px) saturate(1.18)` only for `kind: "glass"`.

- [ ] **Step 4: Run the renderer test and verify GREEN**

Run: `node --test tests/renderer-theme.test.mjs`  
Expected: all renderer theme tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/island/theme.mjs tests/renderer-theme.test.mjs
git commit -m "feat(appearance): derive adaptive island foreground profiles"
```

### Task 3: Add the managed background-image picker

**Files:**
- Modify: `src/shared/ipc.cjs`
- Modify: `src/main/ipc-services.cjs`
- Modify: `src/preload/settings.js`
- Modify: `tests/productivity-ipc.test.mjs`
- Modify: `tests/settings-ui.test.mjs`

- [ ] **Step 1: Write failing IPC surface tests**

Assert a new `APPEARANCE_SELECT_BACKGROUND_IMAGE` channel, a settings preload method named `selectIslandBackgroundImage`, and an IPC handler that opens a PNG/JPEG/WebP file dialog, installs the selected image through `appearanceService.installBackgroundImage()`, and returns `null` on cancellation.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/productivity-ipc.test.mjs tests/settings-ui.test.mjs`  
Expected: FAIL because the channel and preload method do not exist.

- [ ] **Step 3: Implement the narrow picker IPC**

Return this renderer-safe result on success:

```js
{
  imageRef: installed.imageRef,
  width: installed.width,
  height: installed.height,
  bytes: installed.bytes,
  dataUrl: appearanceService.getBackgroundImageDataUrl(installed.imageRef)
}
```

Do not update settings inside the picker; the settings renderer applies the returned reference only after installation succeeds.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/productivity-ipc.test.mjs tests/settings-ui.test.mjs`  
Expected: all focused tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc.cjs src/main/ipc-services.cjs src/preload/settings.js tests/productivity-ipc.test.mjs tests/settings-ui.test.mjs
git commit -m "feat(settings): add managed island background image picker"
```

### Task 4: Rebuild the settings background section around three materials

**Files:**
- Modify: `src/renderer/settings-app.js`
- Modify: `src/renderer/settings-app.css`
- Modify: `src/locales/zh-CN.json`
- Modify: `src/locales/en.json`
- Modify: `tests/settings-ui.test.mjs`

- [ ] **Step 1: Write failing settings UI tests**

Assert three localized material controls (`glass`, `solid`, `image`), `min = "0"`, model-based color/opacity transitions, an awaited save followed by `renderPage()` after material/color changes, image-picker error feedback, and an image-dim control shown only for image mode.

- [ ] **Step 2: Run the settings UI test and verify RED**

Run: `node --test tests/settings-ui.test.mjs`  
Expected: FAIL because the material cards and contextual controls do not exist.

- [ ] **Step 3: Implement material cards and contextual controls**

Replace the preset-first layout with a three-card segmented selector. Keep concise preset swatches inside solid mode, expose tint plus transparency in glass mode, expose image preview/choose plus content-dim slider in image mode, and keep restore-default as the secondary action.

- [ ] **Step 4: Fix the stale disabled slider at its source**

After selecting a material, preset, or custom color, await `save(...)` and call `renderPage()` so controls reflect the new kind immediately. Keep range persistence on `change`; do not rerender during `input`, so pointer and keyboard interaction remain uninterrupted.

- [ ] **Step 5: Run settings and localization tests and verify GREEN**

Run: `node --test tests/settings-ui.test.mjs tests/i18n-quality.test.mjs tests/renderer-i18n.test.mjs`  
Expected: all tests pass and locale keys remain aligned.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/settings-app.js src/renderer/settings-app.css src/locales/zh-CN.json src/locales/en.json tests/settings-ui.test.mjs
git commit -m "feat(settings): present island background materials"
```

### Task 5: Apply semantic foreground tokens and hollow performance gauge

**Files:**
- Modify: `src/renderer/island/app.css`
- Modify: `tests/workstation-ipc.test.mjs`
- Modify: `tests/renderer-theme.test.mjs`

- [ ] **Step 1: Write failing visual-contract tests**

Assert that `.performance-gauge` uses a radial mask, `.performance-gauge::after` is absent, the Island root has semantic foreground/control variables, and the primary toolbar/performance selectors consume those variables instead of fixed black or white values.

- [ ] **Step 2: Run visual-contract tests and verify RED**

Run: `node --test tests/workstation-ipc.test.mjs tests/renderer-theme.test.mjs`  
Expected: FAIL on the fixed center and missing semantic tokens.

- [ ] **Step 3: Implement Adaptive Glass CSS**

Define light, dark, and glass token sets; bind Island text, toolbar controls, status labels, panel headings, and performance elements to them. Add a restrained highlight edge and material-specific backdrop filter. For `data-island-transparent="true"`, remove the outer Island shadow while retaining a dual dark halo on content and local translucent control fills.

- [ ] **Step 4: Replace the performance center with a mask**

Use:

```css
.performance-gauge {
  background: conic-gradient(var(--performance-accent) var(--load), var(--island-track) 0);
  -webkit-mask: radial-gradient(circle, transparent 0 42%, #000 46% 100%);
  mask: radial-gradient(circle, transparent 0 42%, #000 46% 100%);
}
```

Keep warning/critical states by changing `--performance-accent` only.

- [ ] **Step 5: Run visual-contract tests and verify GREEN**

Run: `node --test tests/workstation-ipc.test.mjs tests/renderer-theme.test.mjs`  
Expected: all focused tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/island/app.css tests/workstation-ipc.test.mjs tests/renderer-theme.test.mjs
git commit -m "fix(appearance): keep island content readable on custom backgrounds"
```

### Task 6: Full verification and real UI acceptance

**Files:**
- Modify only if verification exposes a defect in the files above.

- [ ] **Step 1: Run the repository check**

Run: `npm run check`  
Expected: lint, syntax, and all Node tests pass without warnings.

- [ ] **Step 2: Build the Electron renderer/application**

Run: `npm run build`  
Expected: build exits zero and produces the normal app artifacts.

- [ ] **Step 3: Verify the real settings flow**

Open the built app and verify: selecting a custom color enables the slider immediately; 0%, 50%, and 100% persist; each of the three material cards changes the Island; image cancellation preserves the current background; light and transparent backgrounds retain readable toolbar text; the performance gauge center shows the actual background.

- [ ] **Step 4: Record final repository state**

Run: `git status --short --branch` and `git log --oneline origin/main..HEAD`  
Expected: only the user's pre-existing `.pr-124-body.md` remains untracked, and all issue #148 commits are visible on the feature branch.
