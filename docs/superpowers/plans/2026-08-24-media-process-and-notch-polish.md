# Media, Process Control, and Notch Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct media brand names, add safe Activity Monitor-style process actions, and polish collapsed notch media presentation.

**Architecture:** Keep media naming and process validation in the main process, expose one narrow request-response IPC, and keep confirmation state in the renderer. Model notch geometry and process-action UI state with pure functions so safety and visual decisions are testable without Electron.

**Tech Stack:** Electron IPC, Node.js process APIs, React, CSS animations, Node test runner.

---

### Task 1: Resolve recognizable media application names

**Files:**
- Modify: `src/shared/media-state.cjs`
- Test: `tests/media-state.test.mjs`

- [ ] **Step 1: Write failing brand-name tests**

Add assertions that `com.apple.Music` resolves to `Apple Music` and
`com.netease.163music` resolves to `网易云音乐` through `normalizeAdapterPayload()`.

- [ ] **Step 2: Verify RED**

Run `node --test tests/media-state.test.mjs`; expect the current `音乐` and
`163music` values to fail.

- [ ] **Step 3: Implement the minimal resolver**

Add a `MEDIA_APP_NAMES` lookup and use it before the readable bundle fallback:

```js
const MEDIA_APP_NAMES = Object.freeze({
  "com.apple.Music": "Apple Music",
  "com.netease.163music": "网易云音乐"
});
```

- [ ] **Step 4: Verify GREEN**

Run `node --test tests/media-state.test.mjs`; expect all media-state tests to pass.

### Task 2: Validate and signal user processes

**Files:**
- Modify: `src/main/performance-service.cjs`
- Test: `tests/performance-service.test.mjs`

- [ ] **Step 1: Write failing process-action tests**

Cover owned process termination, force termination, PID 1, another UID,
WorkIsland commands, vanished processes, and changed command fingerprints.

- [ ] **Step 2: Verify RED**

Run `node --test tests/performance-service.test.mjs`; expect
`actOnProcess is not a function` or equivalent assertion failures.

- [ ] **Step 3: Implement safe process actions**

Add `actOnProcess({ pid, name, action })`, re-read the process with
`/bin/ps -p PID -o uid=,command=`, compare identity, and invoke injected
`killProcess(pid, action === "force" ? "SIGKILL" : "SIGTERM")` only after all
checks pass. Return stable `{ ok, reason }` results and call `sample()` after
success.

- [ ] **Step 4: Verify GREEN**

Run `node --test tests/performance-service.test.mjs`; expect all safety cases to pass.

### Task 3: Expose confirmation and process actions through IPC

**Files:**
- Modify: `src/shared/ipc.cjs`
- Modify: `src/main/ipc-services.cjs`
- Modify: `src/main/app-coordinator.cjs`
- Modify: `src/preload/island.js`
- Modify: `src/renderer/island/components/PerformancePopover.js`
- Modify: `src/renderer/island/app.css`
- Test: `tests/workstation-ipc.test.mjs`

- [ ] **Step 1: Write the failing IPC contract test**

Assert the shared channel, preload `actOnProcess()` function, coordinator
delegation, and main handler all exist.

- [ ] **Step 2: Verify RED**

Run `node --test tests/workstation-ipc.test.mjs`; expect missing contract assertions.

- [ ] **Step 3: Implement the narrow IPC and inline confirmation UI**

Expose only `{ pid, name, action }`, render `取消`, `退出`, and destructive
`强制退出` buttons, disable them while pending, and translate stable reason codes
to Chinese status text.

- [ ] **Step 4: Verify GREEN**

Run the IPC and renderer source tests; expect both to pass.

### Task 4: Move artwork into the notch safe zone and add playback motion

**Files:**
- Modify: `src/renderer/island/components/IslandPill.js`
- Modify: `src/renderer/island/app.css`
- Test: `tests/workstation-model.test.mjs`

- [ ] **Step 1: Write failing notch-media model assertions**

Assert playing and paused media expose the dedicated notch-media markup and
that the artwork safe-zone offset stays outside half the physical notch width.

- [ ] **Step 2: Verify RED**

Run the workstation model and renderer source tests; expect missing notch media
structure assertions.

- [ ] **Step 3: Implement dual safe zones and micro-animation**

Keep artwork at 28px, offset the left wing from the notch boundary, render four
right-wing bars, stagger bar animation, add subtle artwork float/track-change
motion, and disable animation under `prefers-reduced-motion`.

- [ ] **Step 4: Verify and package**

Run `npm run check`, build the signed macOS package, install it to
`/Applications/WorkIsland.app`, and verify real media metadata plus the process
confirmation flow before requesting visual acceptance.
