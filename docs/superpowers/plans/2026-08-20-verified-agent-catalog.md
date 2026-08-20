# Verified Agent Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove unsupported agent connection claims, conditionally restore TRAE IDE only after a real current Hook works, and harden DeepSeek Harness for other computers.

**Architecture:** The catalog remains an allowlist of first-party managers and adapters. Custom connection plumbing is removed from settings and IPC. DSH configuration writes use one serialized atomic writer, while TRAE IDE acceptance is gated by an actual event from the installed v3.5.87 application.

**Tech Stack:** Electron, CommonJS/ES modules, Node.js test runner, pnpm, electron-builder

---

### Task 1: Remove speculative custom connections

**Files:**
- Modify: `tests/settings-ui.test.mjs`
- Modify: `src/renderer/settings-app.js`
- Modify: `src/preload/index.cjs`
- Modify: `src/shared/ipc.cjs`
- Modify: `src/main/app-coordinator.cjs`
- Delete: `src/main/custom-agent-connections.cjs`
- Delete: `src/main/adapters-custom-agent.cjs`
- Delete: `tests/custom-agent-connections.test.mjs`

- [ ] Change the settings test to assert that `接入我的智能体`, preview, install, and uninstall controls are absent.
- [ ] Run `node --test tests/settings-ui.test.mjs` and verify it fails on the existing custom UI.
- [ ] Remove the renderer section, preload methods, IPC channels, coordinator methods, custom adapter registration, and custom verification recorder.
- [ ] Run `node --test tests/settings-ui.test.mjs` and verify it passes.

### Task 2: Make DSH verification writes concurrency-safe

**Files:**
- Modify: `tests/dsh-profile-discovery.test.mjs`
- Create: `tests/dsh-hook-manager.test.mjs`
- Modify: `src/main/hooks-custom.cjs`

- [ ] Add a test that launches two `recordEvent` calls together and asserts the final configuration parses as JSON and contains a verification timestamp.
- [ ] Add discovery cases using a different username, custom `DSH_HOME`, named profile, and non-default port.
- [ ] Run the focused tests and verify the concurrent-write test fails against direct `writeFile` calls.
- [ ] Add a per-manager write queue and atomic temporary-file rename for configuration updates.
- [ ] Run the focused tests and verify they pass.

### Task 3: Validate current TRAE IDE Hooks

**Files:**
- Modify if verified: `src/shared/agent-catalog.cjs`
- Modify if verified: `src/main/app-coordinator.cjs`
- Modify if verified: `tests/settings-ui.test.mjs`
- Modify if verified: `README.md`

- [ ] Inspect TRAE IDE v3.5.87 Settings -> Hooks and capture the supported event names and generated configuration format.
- [ ] Install WorkIsland's command through that official interface and send one real prompt.
- [ ] If a real event arrives, restore only the TRAE IDE manager/descriptor with configured-versus-verified status; otherwise leave it absent and update stale README wording.
- [ ] Run the focused catalog and settings tests.

### Task 4: Verify and install

**Files:**
- Modify: only files required by failures found in this plan

- [ ] Run `pnpm test` and require all tests to pass.
- [ ] Run the repository's package command and require a successful macOS artifact.
- [ ] Install the artifact to `/Applications/WorkIsland.app` without touching unrelated user files.
- [ ] Launch WorkIsland and verify Settings contains no MiMo, TRAE Work, or custom connection entry; verify DSH remains connectable.
- [ ] Commit only the files belonging to this change and report any real-device or second-computer verification still outstanding.

