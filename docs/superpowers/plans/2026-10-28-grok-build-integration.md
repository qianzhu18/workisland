# Grok Build Implementation Plan

**Goal:** Integrate reliable local Grok Build lifecycle and native approval-wait observation without changing user settings or claiming unsupported Grok Bot integration.

**Architecture:** A pure payload/adapter module and an owned JSON hook store, wrapped in the normal Electron manager. Extend existing registry/catalog/runner/navigation; no new runtime dependency or watcher.

**Tech Stack:** Node/CommonJS, existing Electron hooks CLI/Unix bridge, Grok native hook JSON, node:test.

- [x] Write failing lifecycle, identity, errors/cancellation, native permission and owned-config preservation tests.
- [x] Implement adapter/payload, installer/manager and bounded observer transport. Drop compatibility wrappers under a proven Grok hook environment.
- [x] Wire default-off catalog, registry, settings and source jump metadata; test actual UI/runtime.
- [x] Validate generated command with a real bridge and offline/deadline behavior; verify native released parser/hooks if available without installing on PATH.
- [x] Run full local checks, document Bot scope and remaining acceptance, push independent branch and draft PR. No installed-app update or merge.
- [ ] Final-head cross-platform CI and user acceptance (tracked in PR).

## Local validation

- `npm run check`: 748 tests, 747 passed, Windows-only PowerShell execution test skipped on macOS; no failures.
- Generated command/real bridge smoke passed, including two sessions, native approval observation, compatibility suppression and offline/hung fail-open.
- Official Grok Build 1.0.70 (f50904eaee6c), isolated HOME/GROK_HOME and local mock model: actual CLI prompt, completion and session end received. No Grok cloud-model claim.
- Source Electron settings UI: configured-to-verified transition checked with a synthetic event. No installed-app update.
- Tracking issue: https://github.com/qianzhu18/workisland/issues/206. Draft PR: https://github.com/qianzhu18/workisland/pull/207. Final-head CI pending.
