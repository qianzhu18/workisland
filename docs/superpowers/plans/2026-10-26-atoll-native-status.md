# Native System Status Implementation Plan

> Execute task-by-task with independent native and download workers; main agent owns integration and final verification.

**Goal:** Add real macOS battery/power, audio, network, capture, download and lock-screen status to WorkIsland.

**Architecture:** A small Swift helper owns macOS subscriptions and native lock-screen windows, sending newline-delimited JSON to a lifecycle-managed Node service. Downloads use a separate directory observer. Existing IPC carries combined snapshots to the existing island; a toolbar button opens full details and transient changes present a compact notification without replacing Agent attention.

**Tech Stack:** Swift/AppKit/IOKit/CoreAudio/Network, Node CommonJS, React, existing Electron tooling.

## Data contract

Helper emits `{type:"snapshot",state:{battery,network,audio,capture,locked}}`. Each capability has `available`; battery adds `present,percent,charging,externalConnected,chargingWatts,inputWatts,adapterWatts`; network adds `connected,type,name,expensive`; audio adds `devices:[{id,name,transport,connected,batteryPercent}],activeDeviceId`; capture adds `active`. Null telemetry remains null. stdin accepts `{type:"configure",enabled:{battery,audio,network,capture,lockScreen},locale}` and `{type:"lockContent",title,subtitle}`. Diagnostic `--once` returns one snapshot; `--preview-lock-screen` previews the native panel without locking the Mac.

## Tasks

- [x] Native worker: add `native/system-status` Swift sources, build script, real subscriptions, optional capture symbols and native lock-screen host; verify `--once`, compile and preview. Add meaningful native power tests before implementation.
- [x] Download worker: add `src/main/download-monitor.cjs` and `tests/download-monitor.test.mjs`; watch configured Downloads path, sample only active files, distinguish rename completion from cancellation, ignore stale startup partials; execute failing tests then implementation.
- [x] Main: add `src/main/system-status-service.cjs` and `tests/system-status-service.test.mjs` covering bounded helper output, restart/stop and unavailable capabilities; merge native/download events, honor independent settings, feed filtered media lock-screen content.
- [x] Main: wire `app-coordinator.cjs`, `ipc-services.cjs`, `shared/ipc.cjs`, preload snapshots and subscriptions. Start/stop service with app lifecycle and update it from settings/media.
- [x] Main: add toolbar-hosted `SystemStatus` React component and existing-theme CSS, English/Chinese labels, independent settings and capability descriptions. Agent attention remains visible; downloads/capture persist, connection changes briefly announce.
- [x] Main: include helper in native build, packaging and signing; record dependency licenses. Run `npm run check`, native compilation and isolated Electron smoke.
- [x] Main: capture real rendered status/details and native panel preview; report physical-event and actual lock/unlock checks separately. Commit branch, push, open and attach PR with exact verification and remaining gates.

## Validation

Run targeted suites with `node --test tests/download-monitor.test.mjs tests/system-status-service.test.mjs`, native tests through the helper build script, and project-wide `npm run check`. Run isolated Electron with a separate debug port and user data so existing app and hook configuration are preserved. Validate actual helper output before rendering. No fabricated battery values, download totals or capture-owner claims; UI fixtures, if used for edge-state layout, are explicitly labeled in evidence.

## Verification outcome

693 Node tests and native power assertions passed; arm64 and Intel helpers compiled. Actual screen recording exercised start/end notifications and stable automatic retraction. The native lock panel was previewed and captured; actual lock/unlock and physical headphone/network changes remain device acceptance gates. PR #192 contains the implementation.
