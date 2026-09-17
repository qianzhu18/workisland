# Primary display sync implementation plan

**Goal:** Resolve primary display independently of the application's key window.

**Architecture:** Keep native notch metadata. Derive all DisplayManager primary flags from Electron's system primary display ID. Existing preference callbacks and window movement consume the corrected target.

**Tech Stack:** Electron, CommonJS, node:test with an isolated VM and screen fixture.

- [x] Reproduce with the real DisplayManager and two displays: Sidecar id 18 first, built-in primary id 1 second; legacy native metadata marks Sidecar main. Verify auto → primary emits id 1. Before fix all four tests fail.
- [x] In `src/main/display-manager.cjs`, read `electron.screen.getPrimaryDisplay().id` once per enumeration. Use ID equality for labels, external count and `screenInfo.isMain`.
- [x] Run `node --test tests/display-manager.test.mjs`: four cases pass, including explicit external selection, missing native metadata, system primary changes and disconnected pinned fallback.
- [ ] Run packaged build checks, verify signing and installed payload, restart the installed app, then inspect actual window geometry.
- [ ] Hand off for the user's Sidecar acceptance test before PR publication.
