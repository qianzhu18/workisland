# Kiro Agent Integration Implementation Plan

**Goal:** Recognize native Kiro IDE / CLI lifecycle events using the existing local bridge, with honest capabilities and no default-engine/profile changes.

**Architecture:** A scoped Kiro hook installer writes owned hook documents in a temporary/tested home; a Kiro adapter normalizes verified lifecycle payloads. Reuse the existing hooks CLI, agent catalog, hook manager lifecycle, health verification and terminal navigation.

**Tech Stack:** CommonJS/Node, existing Electron/bridge, Kiro shared v1 JSON and classic agent profile, node:test. No new dependency.

- [x] Add failing adapter and config ownership tests; verify native event names and IDs from official docs.
- [x] Implement `src/main/adapters-kiro.cjs`, pure configuration helpers and a small Electron hook-manager wrapper. Preserve other hooks/configs, atomic writes and backup, explicit legacy profile.
- [x] Add Kiro payload enrichment to `src/island/hooks-cli/index.cjs` using bounded existing process inspection; recognize Kiro IDE host and stable CLI ancestry. Test that unrelated processes cannot supply identity.
- [x] Wire catalog, default-off hook toggle, adapter registry, manager, UI brand and navigation. Keep approvals native.
- [x] Validate generated profile with installed CLI, exercise the actual generated command through an isolated bridge, run full checks. Record actual model-turn limitations.
- [ ] Update docs/changelog, commit/push branch and open a reviewable PR; verify CI. No automatic merge or installed-app replacement.

## Local evidence (2026-10-28)

`npm run check`: 748 passed. `node scripts/smoke-kiro-hooks.mjs`: generated command, actual local bridge, lifecycle/routing, classic/V3 duplicate suppression, disable/offline/hung-bridge handling passed. Installed `kiro-cli agent validate` accepted the generated helper profile. Isolated Kiro V3 actual model turn returned the requested synthetic text and emitted prompt/Stop events with one native session ID. Actual Electron settings preview displayed the Kiro card and bundled logo. IDE 1.4.51 global v1 loading verified against its installed JS; IDE model-turn verification remains pending.

Local evidence lives in `.local-data/kiro/` and `kiro-*.log`; no user config or installed app was modified.
