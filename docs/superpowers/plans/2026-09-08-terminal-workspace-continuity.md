# Terminal Workspace Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the embedded full terminal and its xterm view intact across Island collapse, tool switching, and agent notifications without allowing hidden terminal input to capture Island shortcuts.

**Architecture:** Separate presentation changes from workspace state. `IslandPanel` keeps `TerminalPanel` mounted while the terminal feature is enabled, reports whether the full terminal is active to `IslandApp`, and never lets agent attention rewrite the selected module. `TerminalPanel` owns the session-scoped full/quick state and xterm instance, while a separate visibility effect controls shortcut ownership, resize, and focus.

**Tech Stack:** Electron, React runtime, xterm.js, Node.js built-in test runner.

---

### Task 1: Stop agent attention from rewriting workspace navigation

**Files:**
- Modify: `src/renderer/island/components/productivity-toolbox-model.mjs`
- Test: `tests/productivity-toolbox-model.test.mjs`

- [ ] **Step 1: Replace the preemption expectation with failing continuity tests**

```js
test("attention preserves the current enabled workspace", () => {
  assert.equal(selectToolboxModule({
    current: "terminal",
    attention: true,
    enabled: ["agent", "terminal"]
  }), "terminal");
});

test("workspace selection falls back when the current module is disabled", () => {
  assert.equal(selectToolboxModule({
    current: "terminal",
    attention: true,
    enabled: ["agent"]
  }), "agent");
});

test("attention events preserve the current workspace", () => {
  assert.deepEqual(reduceToolboxState(
    { current: "terminal", previousUtility: "terminal" },
    { type: "agent-attention" }
  ), { current: "terminal", previousUtility: "terminal" });
});
```

- [ ] **Step 2: Run the focused model test and verify RED**

Run: `node --test tests/productivity-toolbox-model.test.mjs`

Expected: FAIL because `selectToolboxModule()` currently returns `agent` whenever `attention` is true.

- [ ] **Step 3: Remove notification-driven navigation from the selector**

```js
function selectToolboxModule({ current = "agent", enabled = ["agent"] } = {}) {
  return TOOLBOX_MODULES.includes(current) && enabled.includes(current) ? current : "agent";
}
```

Update `reduceToolboxState()` so an `agent-attention` event preserves `{ current, previousUtility }` instead of forcing `current: "agent"`. This keeps the exported state model consistent with the live selector and prevents future callers from reintroducing the same interruption.

- [ ] **Step 4: Run the focused model test and verify GREEN**

Run: `node --test tests/productivity-toolbox-model.test.mjs`

Expected: all tests pass.

- [ ] **Step 5: Commit the navigation policy change**

```bash
git add src/renderer/island/components/productivity-toolbox-model.mjs tests/productivity-toolbox-model.test.mjs
git commit -m "fix(island): keep notifications from stealing workspace focus"
```

### Task 2: Keep xterm mounted while independently controlling keyboard ownership

**Files:**
- Modify: `src/renderer/island/components/TerminalPanel.js`
- Modify: `src/renderer/island/components/IslandPanel.js`
- Modify: `src/renderer/island/app.css`
- Test: `tests/productivity-toolbox-ui.test.mjs`

- [ ] **Step 1: Add failing source-contract tests for the terminal lifecycle**

```js
test("terminal remains mounted while another workspace is visible", () => {
  const panel = read("IslandPanel.js");
  assert.match(panel, /terminalEnabled && React\.createElement\(TerminalPanel/);
  assert.match(panel, /active: activeModule === "terminal"/);
  assert.doesNotMatch(panel, /activeModule === "terminal" && .*TerminalPanel/);
});

test("terminal visibility controls shortcuts without owning xterm lifetime", () => {
  const terminal = read("TerminalPanel.js");
  assert.match(terminal, /visible && full/);
  assert.match(terminal, /setTerminalInteractive\?\.\(interactive\)/);
  assert.match(terminal, /terminalRef\.current\?\.focus\(\)/);
  assert.match(terminal, /terminal-panel\$\{active \? "" : " is-hidden"\}/);
});
```

- [ ] **Step 2: Run the focused UI test and verify RED**

Run: `node --test tests/productivity-toolbox-ui.test.mjs`

Expected: FAIL because `TerminalPanel` is conditionally mounted and its xterm creation effect also owns shortcut activation.

- [ ] **Step 3: Make terminal visibility explicit in `TerminalPanel`**

Change the component API to:

```js
export function TerminalPanel({ active = false, panelOpen = false, savedCommands = [], onOpenSettings, onFullChange }) {
```

Add a resize callback ref, keep the xterm creation effect dependent only on `full`, and report full-mode changes:

```js
React.useEffect(() => {
  onFullChange?.(full);
}, [full, onFullChange]);

React.useEffect(() => {
  const interactive = Boolean(panelOpen && active && full);
  window.islandBridge?.setTerminalInteractive?.(interactive);
  if (!interactive) return undefined;
  const frame = requestAnimationFrame(() => {
    resizeRef.current?.();
    terminalRef.current?.focus();
  });
  return () => cancelAnimationFrame(frame);
}, [active, full, panelOpen]);
```

The xterm creation cleanup must still dispose the terminal when `full` becomes false or the component genuinely unmounts, but it must no longer be the normal tool-switch path. Render the section with:

```js
className: `toolbox-panel terminal-panel${active ? "" : " is-hidden"}`,
"aria-hidden": active ? undefined : "true",
"data-terminal-interactive": panelOpen && active && full ? "true" : "false"
```

- [ ] **Step 4: Keep `TerminalPanel` mounted from `IslandPanel`**

Add `panelOpen` and `onTerminalFullChange` to `IslandPanel` props. Replace the conditional terminal render with:

```js
terminalEnabled && React.createElement(TerminalPanel, {
  active: activeModule === "terminal",
  panelOpen,
  savedCommands: terminalSavedCommands,
  onOpenSettings: () => onOpenSettings("general"),
  onFullChange: onTerminalFullChange
})
```

Allow explicit requested modules even while an agent needs attention:

```js
if (requestedToolboxModule?.id && enabledModules.includes(requestedToolboxModule.id)) {
  setActiveModule(requestedToolboxModule.id);
}
```

- [ ] **Step 5: Hide inactive terminal content without unmounting it**

Add:

```css
.toolbox-panel.is-hidden { display: none; }
```

- [ ] **Step 6: Run focused UI and model tests and verify GREEN**

Run: `node --test tests/productivity-toolbox-ui.test.mjs tests/productivity-toolbox-model.test.mjs`

Expected: all tests pass.

- [ ] **Step 7: Commit the persistent terminal component**

```bash
git add src/renderer/island/components/TerminalPanel.js src/renderer/island/components/IslandPanel.js src/renderer/island/app.css tests/productivity-toolbox-ui.test.mjs
git commit -m "fix(terminal): preserve the full workspace across navigation"
```

### Task 3: Resume a full terminal after Island collapse

**Files:**
- Modify: `src/renderer/island/app.js`
- Modify: `src/renderer/island/components/IslandPanel.js`
- Test: `tests/productivity-toolbox-ui.test.mjs`

- [ ] **Step 1: Add a failing source-contract test for collapse and reopen priority**

```js
test("a collapsed full terminal reopens ahead of the generic toolbox preference", () => {
  const app = readFileSync(new URL("../src/renderer/island/app.js", import.meta.url), "utf8");
  assert.match(app, /terminalFullRef/);
  assert.match(app, /activeModuleRef\.current === "terminal" && terminalFullRef\.current/);
  assert.match(app, /onTerminalFullChange/);
  assert.match(app, /panelOpen: isOpen/);
});
```

- [ ] **Step 2: Run the focused UI test and verify RED**

Run: `node --test tests/productivity-toolbox-ui.test.mjs`

Expected: FAIL because `collapsePanelToPill()` always resolves through `toolboxReopenMode` and cannot distinguish a full terminal.

- [ ] **Step 3: Track full-terminal state in `IslandApp` without persisting it**

Add the session-scoped ref and callback:

```js
const terminalFullRef = reactExports.useRef(false);
const reportTerminalFull = reactExports.useCallback((full) => {
  terminalFullRef.current = Boolean(full);
}, []);
```

Choose the reopen module before calling the generic policy:

```js
const resumeFullTerminal = activeModuleRef.current === "terminal" && terminalFullRef.current;
const nextModule = resumeFullTerminal
  ? "terminal"
  : resolveToolboxReopenModule({
      mode: toolboxReopenMode,
      lastModule: activeModuleRef.current,
      enabled: enabledModules
    });
```

Pass these props to `IslandPanel`:

```js
panelOpen: isOpen,
onTerminalFullChange: reportTerminalFull,
```

- [ ] **Step 4: Run focused UI tests and verify GREEN**

Run: `node --test tests/productivity-toolbox-ui.test.mjs`

Expected: all tests pass.

- [ ] **Step 5: Commit collapse/reopen continuity**

```bash
git add src/renderer/island/app.js src/renderer/island/components/IslandPanel.js tests/productivity-toolbox-ui.test.mjs
git commit -m "fix(terminal): resume full terminal after Island collapse"
```

### Task 4: Verify, package, install, and open the PR

**Files:**
- Verify all files changed in Tasks 1-3
- Create: `/tmp/workisland-terminal-continuity-pr.md`

- [ ] **Step 1: Run formatting and repository checks**

Run: `git diff --check origin/main...HEAD`

Expected: no output.

Run: `npm run check`

Expected: renderer build, source checks, and all unit tests pass.

- [ ] **Step 2: Review the isolated branch diff**

Run: `git status --short --branch && git diff --stat origin/main...HEAD && git diff origin/main...HEAD -- src/renderer/island/components/productivity-toolbox-model.mjs src/renderer/island/components/TerminalPanel.js src/renderer/island/components/IslandPanel.js src/renderer/island/app.js src/renderer/island/app.css tests/productivity-toolbox-model.test.mjs tests/productivity-toolbox-ui.test.mjs`

Expected: only the approved terminal continuity implementation, tests, specification, and plan appear.

- [ ] **Step 3: Build a macOS preview artifact**

Run: `npm run package:mac`

Expected: an arm64 DMG under `release/`, with the full check suite passing inside the packaging workflow.

- [ ] **Step 4: Verify and install the actual application**

Verify the DMG with `hdiutil verify`, the packaged app with `codesign --verify --deep --strict`, replace `/Applications/WorkIsland.app` only after preserving the existing installation as a recoverable backup, restart WorkIsland, and confirm the running process path is `/Applications/WorkIsland.app`.

Expected: the installed app contains the branch implementation; notarization status is reported separately from local signature validity.

- [ ] **Step 5: Perform live acceptance checks**

In the installed app:

1. Enter the full terminal and type an unsubmitted partial command.
2. Focus another app so the Island collapses, then reopen it.
3. Confirm the full terminal, partial command, output buffer, and cursor context remain.
4. Trigger or observe an agent notification and confirm it does not switch the selected module.
5. Switch manually to another tool and back; confirm the same full terminal remains.
6. Click “返回快捷命令”, collapse, reopen, and confirm the quick-command screen remains the terminal's selected subview.
7. Confirm hidden terminal state releases Island shortcuts and visible full-terminal state restores xterm keyboard ownership.

- [ ] **Step 6: Push and create the PR**

Prepare `/tmp/workisland-terminal-continuity-pr.md` with this content:

```markdown
## 用户问题

完整终端会在 Island 收起或智能体通知到来时被切回主页。再次打开终端还会退回快捷命令首页，打断正在输入的工作。

## 修改

- 将通知从导航事件改为只读关注提示，不再抢占当前工具。
- 在终端功能启用期间持续挂载 `TerminalPanel` 和 xterm 实例。
- 将 xterm 生命周期与可见时的快捷键所有权分离。
- 收起前正在使用完整终端时，重新展开直接恢复该终端。
- 用户主动切换工具或返回快捷命令仍保持原有明确导航语义。

## 验证

- `node --test tests/productivity-toolbox-model.test.mjs tests/productivity-toolbox-ui.test.mjs`
- `npm run check`
- `npm run package:mac`
- 已安装到 `/Applications/WorkIsland.app` 并完成真实失焦、通知、工具切换、返回快捷命令和键盘所有权验证。
```

```bash
git push -u origin codex/fix-terminal-workspace-continuity
gh pr create --base main --head codex/fix-terminal-workspace-continuity --title "fix(terminal): preserve workspace across Island interruptions" --body-file /tmp/workisland-terminal-continuity-pr.md
```

The PR body must explain the user-visible behavior, identify the structural cause, list automated and installed-app verification evidence, and explicitly state that the change preserves terminal work instead of allowing notifications or collapse to reset it.

- [ ] **Step 7: Verify remote PR state and CI**

Run: `gh pr view --json number,url,state,isDraft,headRefName,baseRefName,statusCheckRollup`

Expected: an open non-draft PR targeting `main`; report each CI check separately and do not claim merge or Issue closure unless verified.
