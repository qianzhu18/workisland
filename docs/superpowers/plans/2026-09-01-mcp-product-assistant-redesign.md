# WorkIsland MCP Product Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the settings-first MCP experience with a product assistant that explains WorkIsland, reports redacted agent status, diagnoses common problems, and keeps explicit settings actions secondary.

**Architecture:** Keep the existing local stdio MCP, Unix socket/Windows named-pipe bridge, master switch, audit log, and settings allowlist. Add three pure data/service boundaries—capability catalog, integration summaries, and bounded diagnostics—then expose them through `LocalControlService` and focused MCP tools. Recompose the Settings page as a low-priority MCP page placed immediately before About, with manual TOML collapsed under advanced controls.

**Tech Stack:** Electron, CommonJS main process, ESM MCP server, `@modelcontextprotocol/server`, Zod 4, Node test runner, GitHub Actions.

---

## File map

- Create `src/shared/product-capabilities.cjs`: static product capability catalog plus safe state projection.
- Create `src/main/mcp-diagnostics.cjs`: bounded, evidence-based diagnosis rules.
- Modify `src/main/local-control-service.cjs`: orchestrate capabilities, integrations, sessions, and diagnosis without exposing raw coordinator state.
- Modify `src/main/app-coordinator.cjs`: inject settings, module state, and existing hook-health reports into local control.
- Modify `src/island/workisland-mcp/tools.mjs`: register discovery, integration, active-session, and diagnosis tools.
- Modify `src/renderer/island/renderer/settings.html`: rename and move MCP navigation to the penultimate position.
- Modify `src/renderer/settings-app.js` and `src/renderer/settings-app.css`: recompose the MCP page and collapse advanced configuration.
- Modify `src/main/mcp-client-config.cjs`, `src/main/ipc-services.cjs`, `src/preload/settings.js`, and `src/shared/ipc.cjs`: retain narrow client configuration/status APIs while changing user-visible naming.
- Modify `docs/local-agent-control.md` and `README.md`: document the product-assistant value and privacy boundary.
- Add or update `tests/product-capabilities.test.mjs`, `tests/mcp-diagnostics.test.mjs`, `tests/local-control-service.test.mjs`, `tests/workisland-mcp.test.mjs`, `tests/agent-control-ui.test.mjs`, and package/source-contract tests.

### Task 1: Remove the unapproved MCP merge from `main`

**Files:**
- Git history only; preserve every commit after merge `791956c`.

- [ ] **Step 1: Create an isolated rollback worktree**

Run:

```bash
git fetch origin --prune
git worktree add -b codex/revert-unapproved-mcp /tmp/workisland-mcp-revert origin/main
```

Expected: clean worktree at current `origin/main`.

- [ ] **Step 2: Revert only PR #70**

Run:

```bash
git revert -m 1 791956c7c4bde6be298e973e8be393beb1def77f
git rev-parse HEAD > /tmp/workisland-mcp-rollback-commit.txt
```

Expected: one revert commit removing PR #70 while retaining the later terminal and popup fixes. If Git reports conflicts, preserve the `791956c..origin/main` versions of unrelated terminal, shortcut, popup, and productivity code; remove only symbols introduced by the MCP commits.

- [ ] **Step 3: Verify rollback source and tests**

Run:

```bash
git diff --check HEAD^..HEAD
npm run check
```

Expected: source contracts pass and all remaining unit tests pass with no MCP package/config references.

- [ ] **Step 4: Push a rollback PR and merge only after CI**

Run:

```bash
git push -u origin codex/revert-unapproved-mcp
gh pr create --base main --head codex/revert-unapproved-mcp --title "revert: remove MCP pending product validation" --body "Reverts PR #70 from the released main line while the MCP product experience is redesigned in a separate Draft PR."
gh pr checks --watch --interval 10
gh pr merge --merge --delete-branch
```

Expected: rollback PR merged, current feature work remains unmerged.

- [ ] **Step 5: Reopen the product issue**

Run:

```bash
gh issue reopen 11
gh issue comment 11 --body "PR #70 was reverted because the product experience had not been accepted. Redesign continues in a Draft PR focused on product discovery, redacted agent status, diagnostics, and secondary settings actions."
```

Expected: Issue #11 is OPEN.

- [ ] **Step 6: Rebuild the implementation branch on the reverted main line**

The exact revert SHA was recorded in Step 2. In the design worktree run:

```bash
git branch -m codex/mcp-product-redesign-spec
git fetch origin --prune
git switch -c codex/mcp-product-redesign origin/main
git revert "$(cat /tmp/workisland-mcp-rollback-commit.txt)"
git cherry-pick 1018b29
```

Expected: the new branch is based on MCP-free `origin/main`, contains one explicit revert-of-revert commit restoring the existing MCP foundation for review, and then contains the approved design commit. Never infer the rollback SHA from a commit message.

### Task 2: Lock the MCP navigation name and placement

**Files:**
- Modify: `tests/agent-control-ui.test.mjs`
- Modify: `tests/local-control-service.test.mjs`
- Modify: `src/renderer/island/renderer/settings.html`
- Modify: `src/renderer/settings-app.js`
- Modify: `src/main/local-control-service.cjs`

- [ ] **Step 1: Write the failing navigation test**

Add assertions that extract `data-tab` values and require:

```js
const tabs = [...html.matchAll(/data-tab="([^"]+)"/g)].map((match) => match[1]);
assert.equal(tabs.at(-2), "mcp");
assert.equal(tabs.at(-1), "about");
assert.match(html, /data-tab="mcp"[^>]*>.*MCP/s);
assert.doesNotMatch(html, />智能体控制</);
assert.match(renderer, /function mcpPage\s*\(/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/agent-control-ui.test.mjs`

Expected: FAIL because the current tab is `agent-control`, appears third, and uses the old name.

- [ ] **Step 3: Implement the navigation contract**

Move the MCP button immediately before About, change `data-tab` to `mcp`, render text `MCP`, rename `agentControlPage` to `mcpPage`, and map legacy navigation requests with:

```js
const aliases = { hooks: "agents", pet: "appearance", display: "general", "agent-control": "mcp" };
```

Add `mcp` to the service settings-section allowlist and normalize legacy `agent-control` requests to `mcp`. Keep stored setting keys and IPC channel constants compatible for this iteration; only user-visible naming and page routing change.

- [ ] **Step 4: Verify GREEN and commit**

Run:

```bash
node --test tests/agent-control-ui.test.mjs tests/local-control-service.test.mjs
git add tests/agent-control-ui.test.mjs tests/local-control-service.test.mjs src/renderer/island/renderer/settings.html src/renderer/settings-app.js src/main/local-control-service.cjs
git commit -m "feat(mcp): rename and demote settings navigation"
```

Expected: focused tests pass.

### Task 3: Add the complete product capability catalog

**Files:**
- Create: `tests/product-capabilities.test.mjs`
- Create: `src/shared/product-capabilities.cjs`
- Modify: `tests/local-control-service.test.mjs`
- Modify: `src/main/local-control-service.cjs`
- Modify: `src/main/app-coordinator.cjs`

- [ ] **Step 1: Write failing catalog coverage tests**

Require stable IDs for:

```js
const REQUIRED_IDS = [
  "agent-monitoring", "media", "lyrics", "performance", "file-shelf",
  "quick-share", "clipboard-history", "terminal", "saved-commands",
  "usage", "notifications", "sound", "display-mode", "desktop-pet", "shortcuts"
];
```

Assert every returned record contains only these public fields:

```js
["id", "name", "category", "summary", "platforms", "available", "enabled",
 "howToUse", "privacy", "relatedSettings", "settingsSection", "requirements"]
```

Also assert each `relatedSettings` entry exists in `DEFAULT_SETTINGS`, including dotted paths.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/product-capabilities.test.mjs`

Expected: FAIL with module-not-found for `product-capabilities.cjs`.

- [ ] **Step 3: Implement the pure catalog projection**

Export:

```js
function listProductCapabilities({ settings, platform, modules })
function getProductCapability(id, context)
const PRODUCT_CAPABILITIES
```

Catalog entries are immutable metadata. Projection derives `enabled` from settings, derives `available` from platform/requirements, and never includes paths, session content, config values, or arbitrary objects.

Inject `getPlatform` and the existing product module state into `LocalControlService`. Add `control.listCapabilities` and `control.getCapability` command cases that call the pure catalog projection and return `CAPABILITY_NOT_FOUND` for unknown IDs.

- [ ] **Step 4: Verify GREEN and commit**

Run:

```bash
node --test tests/product-capabilities.test.mjs tests/local-control-service.test.mjs
git add tests/product-capabilities.test.mjs tests/local-control-service.test.mjs src/shared/product-capabilities.cjs src/main/local-control-service.cjs src/main/app-coordinator.cjs
git commit -m "feat(mcp): add WorkIsland capability catalog"
```

### Task 4: Expose redacted integrations and active sessions

**Files:**
- Modify: `tests/local-control-redaction.test.mjs`
- Modify: `tests/local-control-service.test.mjs`
- Modify: `src/main/local-control-service.cjs`
- Modify: `src/main/app-coordinator.cjs`

- [ ] **Step 1: Write failing redaction and semantics tests**

Add harness dependencies `getIntegrationStatus` and assert `control.listIntegrations` returns only:

```js
{
  id: "codex",
  name: "Codex",
  enabled: true,
  installed: true,
  verifiedByEvent: true,
  capabilities: { liveStatus: true, toolActivity: true, completion: "native", approval: "observe", question: "observe", jump: "terminal" }
}
```

Reject fields matching `path`, `command`, `manifest`, `errorStack`, `pid`, or config content. Rename the public command to `control.listActiveSessions` while preserving opaque session IDs and the current redacted fields.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/local-control-redaction.test.mjs tests/local-control-service.test.mjs`

Expected: FAIL with unknown `control.listIntegrations` and `control.listActiveSessions` commands.

- [ ] **Step 3: Implement safe service projections**

Inject:

```js
getIntegrationStatus: () => this.getHookStatus(),
getPlatform: () => process.platform
```

Normalize health reports inside `LocalControlService`; never return raw manager reports. `verifiedByEvent` must be true only when the health report carries the existing real-event verification evidence, not merely `installed: true`.

- [ ] **Step 4: Verify GREEN and commit**

Run:

```bash
node --test tests/local-control-redaction.test.mjs tests/local-control-service.test.mjs
git add tests/local-control-redaction.test.mjs tests/local-control-service.test.mjs src/main/local-control-service.cjs src/main/app-coordinator.cjs
git commit -m "feat(mcp): expose redacted agent monitoring state"
```

### Task 5: Add bounded, evidence-based diagnostics

**Files:**
- Create: `tests/mcp-diagnostics.test.mjs`
- Create: `src/main/mcp-diagnostics.cjs`
- Modify: `src/main/local-control-service.cjs`

- [ ] **Step 1: Write failing diagnostic tests**

Cover identifiers:

```js
[
  "agent-not-visible", "session-disappeared", "media-not-visible",
  "performance-details-not-visible", "file-shelf-not-visible",
  "clipboard-not-visible", "terminal-not-visible", "usage-not-visible"
]
```

Assert a diagnosis has exactly `subject`, `status`, `evidence`, `possibleReasons`, `nextSteps`, and `settingsSection`; arbitrary identifiers throw `DIAGNOSIS_NOT_ALLOWED`. Assert output contains no path, PID, prompt, command, terminal identifier, or raw error.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/mcp-diagnostics.test.mjs`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement deterministic diagnosis rules**

Export:

```js
function diagnoseMcpSubject(subject, context)
const DIAGNOSIS_SUBJECTS
```

Use only projected settings, module state, redacted sessions, and redacted integration health. Wording must say “WorkIsland 当前没有观察到可见会话” rather than claiming no process is running.

- [ ] **Step 4: Wire, verify, and commit**

Run:

```bash
node --test tests/mcp-diagnostics.test.mjs tests/local-control-service.test.mjs
git add tests/mcp-diagnostics.test.mjs src/main/mcp-diagnostics.cjs src/main/local-control-service.cjs
git commit -m "feat(mcp): add bounded product diagnostics"
```

### Task 6: Publish the product-assistant MCP tools

**Files:**
- Modify: `tests/workisland-mcp.test.mjs`
- Modify: `src/island/workisland-mcp/tools.mjs`

- [ ] **Step 1: Update the expected safe tool surface**

The exact list becomes:

```js
[
  "describe_settings", "diagnose", "focus_session", "get_capability",
  "get_product_state", "get_settings", "list_active_sessions",
  "list_capabilities", "list_integrations", "open_settings",
  "set_display_surface", "undo_settings_change", "update_settings"
]
```

Add forwarding assertions for `control.listCapabilities`, `control.getCapability`, `control.listIntegrations`, `control.listActiveSessions`, and `control.diagnose`. Restrict capability IDs and diagnostic subjects with Zod enums derived from exported constants or duplicated frozen public lists checked by a contract test.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/workisland-mcp.test.mjs`

Expected: FAIL because the new tools are absent and `list_visible_sessions` still exists.

- [ ] **Step 3: Register tools with discovery-first descriptions**

Descriptions must explicitly guide the model:

```js
"Use this first when the user asks what WorkIsland or the Island can do."
"List only sessions currently observed by WorkIsland; this is not a system-wide process list."
"Diagnose without changing settings."
"Change settings only when the user explicitly asks for a change."
```

- [ ] **Step 4: Verify GREEN and commit**

Run:

```bash
node --test tests/workisland-mcp.test.mjs
git add tests/workisland-mcp.test.mjs src/island/workisland-mcp/tools.mjs
git commit -m "feat(mcp): publish discovery and diagnosis tools"
```

### Task 7: Recompose the MCP Settings page

**Files:**
- Modify: `tests/agent-control-ui.test.mjs`
- Modify: `src/renderer/settings-app.js`
- Modify: `src/renderer/settings-app.css`
- Modify: `src/main/mcp-client-config.cjs`

- [ ] **Step 1: Write failing information-architecture tests**

Require the user-visible copy:

```js
[
  "MCP 服务", "启用 WorkIsland MCP", "连接智能体", "你可以这样问",
  "权限与隐私", "最近活动", "高级设置"
]
```

Require examples for feature discovery, active agents, attention, integrations, and diagnosis. Assert the TOML block lives inside a closed `<details>` element and old copy `允许智能体控制 WorkIsland` is absent.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/agent-control-ui.test.mjs`

Expected: FAIL on new structure and copy.

- [ ] **Step 3: Implement the page hierarchy**

Build six sections in the order from the design. Use a native `<details>` element for advanced configuration, default closed. Keep connection state, errors, activity, copy-config, and remove actions functional. Do not add a feature hero, onboarding modal, or extra navigation badge.

- [ ] **Step 4: Verify GREEN and commit**

Run:

```bash
node --test tests/agent-control-ui.test.mjs
git add tests/agent-control-ui.test.mjs src/renderer/settings-app.js src/renderer/settings-app.css src/main/mcp-client-config.cjs
git commit -m "feat(mcp): focus settings page on user value"
```

### Task 8: Update documentation and full contracts

**Files:**
- Modify: `docs/local-agent-control.md`
- Modify: `README.md`
- Modify: `tests/local-control-package.test.mjs`
- Modify: `scripts/check.mjs`
- Modify: `scripts/test-source.mjs`

- [ ] **Step 1: Write failing documentation/package assertions**

Require documentation phrases `产品功能`, `WorkIsland 已观察到`, `诊断`, `明确要求`, `MCP 服务`, and `倒数第二` where appropriate. Extend package scans to include the new catalog and diagnostic files.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/local-control-package.test.mjs`

Expected: FAIL until documentation and package contracts include the new files and terminology.

- [ ] **Step 3: Update docs and contracts**

Document the 13-tool surface, example questions, observation boundary, explicit-action rule, connection/removal steps, and privacy restrictions. Keep the exact Codex compatibility configuration under Advanced setup.

- [ ] **Step 4: Run the full suite and commit**

Run:

```bash
npm run check
git diff --check
git add docs/local-agent-control.md README.md tests/local-control-package.test.mjs scripts/check.mjs scripts/test-source.mjs
git commit -m "docs(mcp): document product assistant experience"
```

Expected: all tests pass.

### Task 9: Create the Draft PR and perform real acceptance

**Files:**
- GitHub Draft PR plus local packaged artifact.

- [ ] **Step 1: Synchronize with the reverted `origin/main`**

Run:

```bash
git fetch origin --prune
git rebase origin/main
```

Expected: redesign commits, including the explicit revert-of-revert that restores the MCP foundation for review, are ahead of the MCP-free main branch, with unrelated main changes retained.

- [ ] **Step 2: Push and create a Draft PR**

Run:

```bash
git push -u origin codex/mcp-product-redesign
gh pr create --draft --base main --head codex/mcp-product-redesign --title "feat: redesign MCP as a WorkIsland product assistant" --body "Reopens #11. This remains Draft until product-owner acceptance."
```

Expected: PR state is DRAFT; do not run `gh pr ready` or merge.

- [ ] **Step 3: Package and install the preview**

Run:

```bash
npm run package:mac
codesign --verify --deep --strict release/mac-arm64/WorkIsland.app
```

Install to `/Applications/WorkIsland.app` only after preserving the current app as a timestamped backup.

- [ ] **Step 4: Run exact real-Codex prompts**

Use a fresh installed Codex session and verify MCP calls for all seven prompts in the design. Capture tool names and returned answer summaries. The first six must use MCP data without repository reads; the settings change must show a reversible WorkIsland notice.

- [ ] **Step 5: Verify CI and stop before merge**

Run:

```bash
gh pr checks --watch --interval 10
gh pr view --json isDraft,state,url
```

Expected: all CI passes, `isDraft: true`, `state: OPEN`. Report the preview artifact, remaining platform/notarization gates, and the Draft PR URL to the user for acceptance.
