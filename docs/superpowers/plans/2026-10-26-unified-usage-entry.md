# Unified Usage Entry Implementation Plan

**Goal:** Merge Codex subscription quota and local API/Agent usage into one toolbar module without losing its entry when quota is unavailable.

**Architecture:** Extend existing usage module and reuse portal, floating-layer placement and usage summary APIs; no new provider integration.

**Tech Stack:** React runtime, JavaScript modules, Electron IPC, Node tests.

- [x] Confirm live preview returns an empty quota map while display settings remain enabled; preserve paused release edits in stash.
- [x] Add failing tests for missing/malformed quota, remaining percentage, secondary window and unknown pricing.
- [x] Add usage-entry-model.mjs and UsageEntry.js; integrate the existing usage slot and remove duplicate Codex leading cell.
- [x] Add bilingual text and existing-theme styles; document unavailable data and provider balance boundary.
- [x] Run model/full checks, actual renderer interactions, build local candidate and launch validated preview without publishing.
