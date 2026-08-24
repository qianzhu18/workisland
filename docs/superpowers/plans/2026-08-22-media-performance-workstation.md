# Media and Performance Workstation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a polished macOS system-media player and lightweight performance monitor to WorkIsland without weakening its existing Agent monitoring workflow.

**Architecture:** A small independently written Objective-C++ helper dynamically observes macOS Now Playing state and exchanges JSON Lines with an Electron main-process `MediaService`. A separate `PerformanceService` samples CPU, memory pressure, and process rankings. Both services expose narrow IPC snapshots and events to isolated renderer components that form a responsive media/Agent split layout.

**Tech Stack:** Electron 43, Node.js 22 CommonJS services, Objective-C++/Foundation/AppKit with dynamically resolved MediaRemote symbols, React runtime already bundled in the repository, Node test runner, CSS spring-style transitions.

---

### Task 1: Media state contract and reducer

**Files:**
- Create: `src/shared/media-state.cjs`
- Test: `tests/media-state.test.mjs`

- [ ] **Step 1: Write the failing reducer tests**

Cover an empty snapshot, normalized playing metadata, missing artwork, progress clamping, pause retention, and media-session removal. Use a public API shaped as:

```js
const { EMPTY_MEDIA_STATE, normalizeMediaSnapshot, reduceMediaEvent } = require("../src/shared/media-state.cjs");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/media-state.test.mjs`

Expected: FAIL because `src/shared/media-state.cjs` does not exist.

- [ ] **Step 3: Implement the minimal media contract**

Define the stable renderer payload:

```js
{
  active: false,
  playing: false,
  title: "",
  artist: "",
  album: "",
  appBundleId: "",
  appName: "",
  durationSec: 0,
  elapsedSec: 0,
  playbackRate: 0,
  artworkDataUrl: "",
  canPlayPause: false,
  canNext: false,
  canPrevious: false,
  updatedAt: 0
}
```

Reject unknown event kinds, cap artwork data URLs at 8 MiB, and clamp elapsed time into the available duration.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/media-state.test.mjs`

Expected: all media-state tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/media-state.cjs tests/media-state.test.mjs
git commit -m "feat(media): define now playing state contract"
```

### Task 2: Native macOS Now Playing helper

**Files:**
- Create: `native/media-bridge/src/media_bridge.mm`
- Modify: `scripts/build-native.mjs`
- Modify: `package.json`
- Test: `tests/media-bridge-build.test.mjs`

- [ ] **Step 1: Write the failing packaging test**

Assert that `build-native.mjs` compiles `media_bridge.mm`, copies `media-bridge` to `resources/bin`, and that `package.json` includes the executable in packaged resources.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/media-bridge-build.test.mjs`

Expected: FAIL because the helper source and packaging declaration are absent.

- [ ] **Step 3: Implement an independent native helper**

Use `dlopen`/`dlsym` against `/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote`. Dynamically resolve notification registration, current metadata, current playing state, source PID, transport controls, and elapsed-time controls. Do not copy Atoll source, binaries, names, assets, or comments.

The helper must:

```text
stdout: one JSON object per line with kind=state|unavailable|error
stdin:  one JSON object per line with command=toggle|play|pause|next|previous|seek|openSource
```

Convert artwork bytes to a base64 PNG/JPEG field, resolve the source application through `NSRunningApplication`, emit initial state, emit on Now Playing notifications, and update elapsed time once per second while playing. Missing private symbols produce one `unavailable` event and a clean exit rather than a WorkIsland crash.

- [ ] **Step 4: Build and smoke the helper**

Run: `npm run build:native`

Expected: both `resources/bin/panel_fix.node` and executable `resources/bin/media-bridge` exist. Running `resources/bin/media-bridge --probe` returns valid JSON and exits zero whether MediaRemote is available or unavailable.

- [ ] **Step 5: Run tests and commit**

```bash
node --test tests/media-bridge-build.test.mjs
git add native/media-bridge/src/media_bridge.mm scripts/build-native.mjs package.json tests/media-bridge-build.test.mjs
git commit -m "feat(media): add macOS now playing bridge"
```

### Task 3: Electron media service and IPC

**Files:**
- Create: `src/main/media-service.cjs`
- Modify: `src/shared/ipc.cjs`
- Modify: `src/preload/island.js`
- Modify: `src/main/app-coordinator.cjs`
- Modify: `src/main/ipc-services.cjs`
- Test: `tests/media-service.test.mjs`
- Test: `tests/ipc-contract.test.mjs`

- [ ] **Step 1: Write failing service tests**

Use an injected child-process factory to verify JSON Lines chunking, invalid-line tolerance, restart backoff, snapshot broadcasting, command allowlisting, disabled-state shutdown, and no full media title in logs.

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/media-service.test.mjs tests/ipc-contract.test.mjs`

Expected: FAIL because the service and media IPC channels do not exist.

- [ ] **Step 3: Implement `MediaService`**

Expose `start()`, `stop()`, `setEnabled(enabled)`, `getSnapshot()`, `sendCommand(command)`, and an `update` event. Resolve the helper from `process.resourcesPath` in packaged builds and `resources/bin` in development. Use bounded exponential restart delays and stop retrying when disabled.

- [ ] **Step 4: Add narrow IPC channels**

Add:

```js
MEDIA_GET_STATE
MEDIA_STATE_UPDATE
MEDIA_COMMAND
```

The preload exposes `getMediaState()`, `onMediaStateUpdate(cb)`, and `mediaCommand(command)`. Main-process validation accepts only `toggle`, `play`, `pause`, `next`, `previous`, `seek`, and `openSource`; seek accepts a finite non-negative number.

- [ ] **Step 5: Run tests and commit**

```bash
node --test tests/media-service.test.mjs tests/ipc-contract.test.mjs
git add src/main/media-service.cjs src/shared/ipc.cjs src/preload/island.js src/main/app-coordinator.cjs src/main/ipc-services.cjs tests/media-service.test.mjs tests/ipc-contract.test.mjs
git commit -m "feat(media): stream system playback into the island"
```

### Task 4: Performance sampling service

**Files:**
- Create: `src/main/performance-service.cjs`
- Create: `src/shared/performance-state.cjs`
- Modify: `src/shared/ipc.cjs`
- Modify: `src/preload/island.js`
- Modify: `src/main/app-coordinator.cjs`
- Modify: `src/main/ipc-services.cjs`
- Test: `tests/performance-service.test.mjs`

- [ ] **Step 1: Write failing sampling tests**

Test CPU delta calculation, memory percentage, pressure parsing, bounded process rows, detail sampling only while requested, stale-data fallback, and start/stop behavior when settings change.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/performance-service.test.mjs`

Expected: FAIL because the performance modules do not exist.

- [ ] **Step 3: Implement the sampler**

Use `os.cpus()`, `os.totalmem()`, `os.freemem()`, `/usr/bin/memory_pressure`, and `/bin/ps`. Emit a lightweight summary every two seconds while enabled; collect top CPU and memory processes only while the popover is open or pinned. Sanitize process names and never expose command-line arguments.

- [ ] **Step 4: Add performance IPC**

Add snapshot, update, and detail-visibility channels. Preload methods are `getPerformanceState()`, `onPerformanceUpdate(cb)`, and `setPerformanceDetailsVisible(visible)`.

- [ ] **Step 5: Run tests and commit**

```bash
node --test tests/performance-service.test.mjs tests/ipc-contract.test.mjs
git add src/main/performance-service.cjs src/shared/performance-state.cjs src/shared/ipc.cjs src/preload/island.js src/main/app-coordinator.cjs src/main/ipc-services.cjs tests/performance-service.test.mjs tests/ipc-contract.test.mjs
git commit -m "feat(performance): add lightweight system monitoring"
```

### Task 5: Workstation settings and lifecycle

**Files:**
- Modify: `src/shared/settings.cjs`
- Modify: `src/renderer/shared/settings.js`
- Modify: `src/renderer/settings-app.js`
- Modify: `src/renderer/settings-app.css`
- Modify: `src/main/app-coordinator.cjs`
- Test: `tests/settings-workstation.test.mjs`

- [ ] **Step 1: Write failing settings tests**

Assert defaults for `mediaEnabled`, `mediaTrackChangeNotifications`, `performanceEnabled`, and `performanceAlertsEnabled`; assert normalization of persisted partial settings; assert service lifecycle follows the toggles.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/settings-workstation.test.mjs`

Expected: FAIL because workstation settings are missing.

- [ ] **Step 3: Add the Workstation settings section**

Add four understandable toggles under “工作台”. Media and performance display default on; track-change notifications default on; performance alerts default off. Turning a feature off must stop its service.

- [ ] **Step 4: Run tests and commit**

```bash
node --test tests/settings-workstation.test.mjs
git add src/shared/settings.cjs src/renderer/shared/settings.js src/renderer/settings-app.js src/renderer/settings-app.css src/main/app-coordinator.cjs tests/settings-workstation.test.mjs
git commit -m "feat(settings): configure workstation activity"
```

### Task 6: Media card, responsive split, and performance popover

**Files:**
- Create: `src/renderer/island/components/MediaCard.js`
- Create: `src/renderer/island/components/PerformancePopover.js`
- Create: `src/renderer/island/components/workstation-model.mjs`
- Modify: `src/renderer/island/components/IslandPanel.js`
- Modify: `src/renderer/island/app.js`
- Modify: `src/renderer/island/components/IslandPanel.css`
- Modify: `src/renderer/island/app.css`
- Test: `tests/workstation-model.test.mjs`
- Test: `tests/island-ui.test.mjs`

- [ ] **Step 1: Write failing presentation-model tests**

Cover full-width Agent layout without media, 40/60 split with media, compact media layout at narrow widths, paused appearance, missing-artwork fallback, popover hover/pin state, and Agent attention priority.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/workstation-model.test.mjs tests/island-ui.test.mjs`

Expected: FAIL because the components and model are absent.

- [ ] **Step 3: Build the media card**

Render artwork as the visual anchor with a blurred color-matched glow, subtle scale/parallax on playback and hover, crisp title/artist typography, progress scrubber, and three transport controls. Use CSS transitions and transforms only; avoid continuous layout animation. Use the source app icon or a neutral music glyph when artwork is absent.

- [ ] **Step 4: Build the responsive workspace split**

Wrap the existing session list rather than rewriting it. With active media, animate grid columns from `0fr 1fr` to `minmax(220px, .72fr) minmax(0, 1fr)`; without media, remove the divider and return the Agent panel to full width. Preserve approval buttons, question inputs, scrolling, and jump actions.

- [ ] **Step 5: Build the performance popover**

Add a performance icon beside the pet/settings controls. Hover opens the popover, click pins it, Escape closes it, and pointer transfer between button and popover does not flicker. Display CPU and memory rings/bars, memory pressure, and sanitized top-process rows.

- [ ] **Step 6: Run tests and commit**

```bash
node --test tests/workstation-model.test.mjs tests/island-ui.test.mjs
git add src/renderer/island/components/MediaCard.js src/renderer/island/components/PerformancePopover.js src/renderer/island/components/workstation-model.mjs src/renderer/island/components/IslandPanel.js src/renderer/island/app.js src/renderer/island/components/IslandPanel.css src/renderer/island/app.css tests/workstation-model.test.mjs tests/island-ui.test.mjs
git commit -m "feat(ui): add responsive media and performance workspace"
```

### Task 7: Live-activity transitions and notification priority

**Files:**
- Create: `src/renderer/island/live-activity-model.mjs`
- Modify: `src/renderer/island/components/IslandPill.js`
- Modify: `src/renderer/island/app.js`
- Modify: `src/renderer/island/app.css`
- Modify: `src/main/presentation-policy.cjs`
- Test: `tests/live-activity-model.test.mjs`
- Test: `tests/presentation-policy.test.mjs`

- [ ] **Step 1: Write failing priority tests**

Assert that approval/question and errors override media, Agent completion overrides song-change activity, song changes auto-expire, and normal media never hides an actionable Agent session.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/live-activity-model.test.mjs tests/presentation-policy.test.mjs`

Expected: FAIL because media activity is not part of the presentation model.

- [ ] **Step 3: Implement transient media activity**

Show a compact artwork/title treatment on track changes, then restore the previous pill or Agent presentation. Use one cancellable timer and stable event IDs so rapid track changes replace rather than stack animations.

- [ ] **Step 4: Add polished motion and accessibility**

Use spring-like cubic Bézier curves for split expansion and artwork entrance, crossfade metadata, respect `prefers-reduced-motion`, keep keyboard focus visible, and provide accessible labels for transport and performance controls.

- [ ] **Step 5: Run tests and commit**

```bash
node --test tests/live-activity-model.test.mjs tests/presentation-policy.test.mjs
git add src/renderer/island/live-activity-model.mjs src/renderer/island/components/IslandPill.js src/renderer/island/app.js src/renderer/island/app.css src/main/presentation-policy.cjs tests/live-activity-model.test.mjs tests/presentation-policy.test.mjs
git commit -m "feat(island): prioritize agent and media live activities"
```

### Task 8: Full verification, packaging, and local installation

**Files:**
- Modify as required by verified failures only
- Verify: `THIRD_PARTY_NOTICES.md`

- [ ] **Step 1: Run the complete test and static-check suite**

Run: `npm run check`

Expected: renderer build, source checks, and all unit tests pass with no warnings introduced by this branch.

- [ ] **Step 2: Build the signed local macOS artifact**

Run: `npm run package:mac`

Expected: an arm64 DMG and application bundle under `release/`; the packaged app contains executable `Contents/Resources/bin/media-bridge`.

- [ ] **Step 3: Install without losing the previous build**

Quit WorkIsland, move the current `/Applications/WorkIsland.app` to a timestamped backup, copy the new application into `/Applications`, and launch it. Do not touch user-owned untracked repository files.

- [ ] **Step 4: Perform real-app acceptance**

Verify Apple Music, Spotify, and browser playback where available; verify play/pause/next/previous, artwork and metadata changes, no-media full-width Agent layout, simultaneous Agent/media split, approval visibility, performance hover/pin behavior, and clean fallback when the helper is unavailable.

- [ ] **Step 5: Inspect runtime cost and logs**

Confirm idle CPU remains low, process rankings are not sampled while hidden, media titles and command lines are absent from logs, and no repeated helper restart loop occurs.

- [ ] **Step 6: Commit verified fixes and hand off**

```bash
git status --short
git log --oneline --decorate -12
```

Report exact automated results, installed application path, features physically verified, and any remaining user-only acceptance checks. Do not merge until the user accepts the installed build.
