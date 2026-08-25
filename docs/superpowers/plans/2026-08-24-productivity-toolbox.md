# WorkIsland 生产力工具箱实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有灵动岛内加入可开关的文件架、剪贴板历史、快捷命令与完整终端，同时保持 Agent 提醒最高优先级。

**Architecture:** 主进程用三个独立服务持有文件系统、系统剪贴板和 PTY 权限；预加载只暴露窄 IPC；渲染层通过纯模型选择模块并呈现界面。文件架只保存引用，剪贴板默认关闭且只落本机，终端使用 `node-pty` 并在 Electron 打包阶段重建原生模块。

**Tech Stack:** Electron 43、Node.js 22、React createElement、Node test runner、node-pty、xterm.js、electron-builder。

---

### Task 1：设置契约与模块选择模型

**Files:**
- Modify: `src/shared/settings.cjs`
- Modify: `src/renderer/shared/settings.js`
- Modify: `src/renderer/settings-app.js`
- Create: `src/renderer/island/components/productivity-toolbox-model.mjs`
- Modify: `tests/settings-workstation.test.mjs`
- Create: `tests/productivity-toolbox-model.test.mjs`

- [ ] **Step 1：先写失败测试**

```js
test("productivity modules use privacy-conscious defaults", () => {
  assert.equal(settings.DEFAULT_SETTINGS.fileShelfEnabled, true);
  assert.equal(settings.DEFAULT_SETTINGS.clipboardHistoryEnabled, false);
  assert.equal(settings.DEFAULT_SETTINGS.terminalEnabled, true);
  assert.equal(settings.DEFAULT_SETTINGS.clipboardHistoryLimit, 100);
  assert.equal(settings.DEFAULT_SETTINGS.clipboardRetentionHours, 24);
});

test("attention always returns the toolbox to Agent", () => {
  assert.equal(selectToolboxModule({ current: "terminal", attention: true, enabled: ["agent", "terminal"] }), "agent");
});
```

- [ ] **Step 2：运行并确认因字段和模块缺失而失败**

Run: `node --test tests/settings-workstation.test.mjs tests/productivity-toolbox-model.test.mjs`
Expected: FAIL，缺少生产力字段或 `selectToolboxModule`。

- [ ] **Step 3：实现默认值、合并校验和纯选择模型**

```js
const TOOLBOX_MODULES = Object.freeze(["agent", "shelf", "clipboard", "terminal"]);
function selectToolboxModule({ current, attention, enabled }) {
  if (attention) return "agent";
  return TOOLBOX_MODULES.includes(current) && enabled.includes(current) ? current : "agent";
}
```

设置合并时将条数限制到 `[25, 50, 100, 250]`，保留期限制到 `[0, 1, 8, 24, 168]`，快捷命令只接受有名称和命令的有界字符串。

- [ ] **Step 4：运行测试并提交**

Run: `node --test tests/settings-workstation.test.mjs tests/productivity-toolbox-model.test.mjs`
Expected: PASS。

Commit: `git commit -m "feat(toolbox): define productivity settings and navigation"`

### Task 2：文件架数据模型与本机服务

**Files:**
- Create: `src/main/shelf-service.cjs`
- Create: `src/shared/shelf-state.cjs`
- Create: `tests/shelf-service.test.mjs`
- Create: `tests/shelf-state.test.mjs`

- [ ] **Step 1：先写路径与引用安全测试**

```js
test("removing a shelf item never deletes its source", async () => {
  const source = join(tempDir, "report.txt");
  await writeFile(source, "keep");
  const service = new ShelfService({ storePath, getFileIcon: async () => "" });
  const item = await service.addPaths([source]);
  await service.remove([item[0].id]);
  assert.equal(await readFile(source, "utf8"), "keep");
});

test("shelf deduplicates canonical paths and marks missing files", async () => {
  const first = await service.addPaths([source, source]);
  assert.equal(first.length, 1);
  await unlink(source);
  assert.equal(service.snapshot().items[0].available, false);
});
```

- [ ] **Step 2：验证 RED**

Run: `node --test tests/shelf-service.test.mjs tests/shelf-state.test.mjs`
Expected: FAIL，服务和规范化函数不存在。

- [ ] **Step 3：实现版本化 JSON、路径规范化和引用操作**

`ShelfService` 提供 `start()`、`snapshot()`、`addPaths()`、`addPayload()`、`remove()`、`clear()`、`open()`、`reveal()`、`quickLook()` 与 `dispose()`。所有路径经 `realpath`、长度检查与 `lstat`；删除操作只改 JSON。

- [ ] **Step 4：验证 GREEN 并提交**

Run: `node --test tests/shelf-service.test.mjs tests/shelf-state.test.mjs`
Expected: PASS。

Commit: `git commit -m "feat(shelf): persist safe local file references"`

### Task 3：文件架 IPC、拖放与拖出

**Files:**
- Modify: `src/shared/ipc.cjs`
- Modify: `src/preload/island.js`
- Modify: `src/main/ipc-services.cjs`
- Create: `tests/shelf-ipc.test.mjs`
- Modify: `tests/workstation-ipc.test.mjs`

- [ ] **Step 1：先写窄桥接测试**

```js
for (const method of ["getShelfState", "addShelfFiles", "addShelfPayload", "removeShelfItems", "openShelfItem", "revealShelfItem", "quickLookShelfItem", "startShelfDrag"]) {
  assert.match(preload, new RegExp(`${method}\\(`));
}
assert.doesNotMatch(preload, /require\(["']node:fs/);
```

- [ ] **Step 2：验证 RED**

Run: `node --test tests/shelf-ipc.test.mjs tests/workstation-ipc.test.mjs`
Expected: FAIL，IPC 和 preload 方法不存在。

- [ ] **Step 3：实现 IPC**

使用 `webUtils.getPathForFile(file)` 在 preload 将真实拖入文件转换为路径；主进程按 ID 执行打开、Finder 定位和 Quick Look。拖出使用 `webContents.startDrag({ file, icon })`，多选拖出先限制为同一批有效文件。

- [ ] **Step 4：验证并提交**

Run: `node --test tests/shelf-ipc.test.mjs tests/workstation-ipc.test.mjs`
Expected: PASS。

Commit: `git commit -m "feat(shelf): expose bounded drag and file actions"`

### Task 4：剪贴板历史服务

**Files:**
- Create: `src/shared/clipboard-history-state.cjs`
- Create: `src/main/clipboard-history-service.cjs`
- Create: `tests/clipboard-history-state.test.mjs`
- Create: `tests/clipboard-history-service.test.mjs`

- [ ] **Step 1：先写采集、去重、过期和回放抑制测试**

```js
test("clipboard history deduplicates replay and expires ordinary entries", () => {
  const history = reduceClipboardHistory([], { kind: "capture", entry: textEntry("hello", 1) }, policy);
  const replayed = reduceClipboardHistory(history, { kind: "capture", entry: textEntry("hello", 2), selfWrite: true }, policy);
  assert.equal(replayed.length, 1);
  assert.deepEqual(expireClipboardEntries(replayed, 25 * HOUR, 24), []);
});

test("favorite entries survive time retention but obey the global cap", () => {
  const favorite = { ...textEntry("keep", 1), favorite: true };
  assert.equal(expireClipboardEntries([favorite], 99 * HOUR, 24).length, 1);
});
```

- [ ] **Step 2：验证 RED**

Run: `node --test tests/clipboard-history-state.test.mjs tests/clipboard-history-service.test.mjs`
Expected: FAIL，历史模型和服务不存在。

- [ ] **Step 3：实现本机轮询与有界存储**

`ClipboardHistoryService` 注入 Electron clipboard 适配器，提供 `setEnabled()`、`setPolicy()`、`snapshot()`、`search()`、`replay()`、`favorite()`、`remove()`、`clear()`、`dispose()`。支持文本、URL、PNG 缩略图和文件引用；禁止向日志输出内容。

- [ ] **Step 4：验证并提交**

Run: `node --test tests/clipboard-history-state.test.mjs tests/clipboard-history-service.test.mjs`
Expected: PASS。

Commit: `git commit -m "feat(clipboard): add private local history service"`

### Task 5：剪贴板 IPC 与设置停用语义

**Files:**
- Modify: `src/shared/ipc.cjs`
- Modify: `src/preload/island.js`
- Modify: `src/main/ipc-services.cjs`
- Modify: `src/main/app-coordinator.cjs`
- Create: `tests/clipboard-history-ipc.test.mjs`

- [ ] **Step 1：先写停用与清空测试**

```js
test("disabling capture stops the service without silently deleting history", async () => {
  service.setEnabled(false);
  assert.equal(service.isMonitoring(), false);
  assert.equal(service.snapshot().items.length, 1);
  await service.clear();
  assert.equal(service.snapshot().items.length, 0);
});
```

- [ ] **Step 2：验证 RED**

Run: `node --test tests/clipboard-history-ipc.test.mjs`
Expected: FAIL，剪贴板 IPC 不存在。

- [ ] **Step 3：实现读取、搜索、回放、收藏、删除、清空 IPC**

主进程使用条目 ID 查找历史记录，不接受渲染层直接传入待写回的剪贴板内容；清空和停用保持两个独立操作。

- [ ] **Step 4：验证 GREEN 并提交**

Run: `node --test tests/clipboard-history-ipc.test.mjs`
Expected: PASS。

Commit: `git commit -m "feat(clipboard): connect history controls to Island"`

### Task 6：PTY 终端服务与打包依赖

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `scripts/test-source.mjs`
- Modify: `scripts/after-pack.cjs`
- Create: `src/main/terminal-service.cjs`
- Create: `src/shared/terminal-state.cjs`
- Create: `tests/terminal-service.test.mjs`
- Create: `tests/terminal-package.test.mjs`

- [ ] **Step 1：安装锁定依赖**

Run: `npm install --save-exact node-pty @xterm/xterm`
Expected: lockfile contains exact versions and npm audit reports no known vulnerability.

- [ ] **Step 2：先写注入式 PTY 生命周期测试**

```js
test("terminal persists across panel switches and stops only on disable", () => {
  const pty = fakePty();
  const service = new TerminalService({ spawnPty: () => pty, homeDir: "/Users/test" });
  service.start({ cwd: "/project" });
  service.setPanelVisible(false);
  assert.equal(pty.killed, false);
  service.setEnabled(false);
  assert.equal(pty.killed, true);
});

test("invalid project cwd falls back to home", () => {
  assert.equal(resolveTerminalCwd({ projectCwd: "/missing", homeDir: "/home", exists: p => p === "/home" }), "/home");
});
```

- [ ] **Step 3：验证 RED，最小实现 PTY 输入、输出、resize、Ctrl-C 与重启**

Run: `node --test tests/terminal-service.test.mjs tests/terminal-package.test.mjs`
Expected before implementation: FAIL；after implementation: PASS。

- [ ] **Step 4：重建并验证 Electron ABI**

Run: `npm rebuild node-pty --runtime=electron --target=43.3.0 --dist-url=https://electronjs.org/headers`
Expected: node-pty native binding can be required by Electron 43.

- [ ] **Step 5：提交**

Commit: `git commit -m "feat(terminal): add persistent local PTY service"`

### Task 7：终端 IPC 与快捷命令

**Files:**
- Modify: `src/shared/ipc.cjs`
- Modify: `src/preload/island.js`
- Modify: `src/main/ipc-services.cjs`
- Modify: `src/main/app-coordinator.cjs`
- Create: `tests/terminal-ipc.test.mjs`
- Create: `tests/quick-command-model.test.mjs`

- [ ] **Step 1：先写命令校验和 IPC 测试**

```js
test("saved commands require explicit bounded names and commands", () => {
  assert.equal(normalizeSavedCommand({ name: "Tests", command: "npm test" }).command, "npm test");
  assert.equal(normalizeSavedCommand({ name: "", command: "npm test" }), null);
});

test("terminal resize rejects impossible dimensions", () => {
  assert.equal(normalizeTerminalSize({ cols: 120, rows: 30 }).cols, 120);
  assert.equal(normalizeTerminalSize({ cols: 0, rows: 99999 }), null);
});
```

- [ ] **Step 2：验证 RED**

Run: `node --test tests/terminal-ipc.test.mjs tests/quick-command-model.test.mjs`
Expected: FAIL，终端 IPC 和命令模型不存在。

- [ ] **Step 3：实现 start/input/resize/restart/stop/runSavedCommand IPC**

输入限制单次 64 KiB，列数限制 20–500，行数限制 5–200；命令只按已保存的 ID 运行。

- [ ] **Step 4：验证 GREEN 并提交**

Run: `node --test tests/terminal-ipc.test.mjs tests/quick-command-model.test.mjs`
Expected: PASS。

Commit: `git commit -m "feat(terminal): expose quick commands and bounded PTY IPC"`

### Task 8：三个模块的界面组件

**Files:**
- Create: `src/renderer/island/components/ToolboxSwitcher.js`
- Create: `src/renderer/island/components/ShelfPanel.js`
- Create: `src/renderer/island/components/ClipboardPanel.js`
- Create: `src/renderer/island/components/TerminalPanel.js`
- Modify: `src/renderer/island/components/IslandPanel.js`
- Modify: `src/renderer/island/app.css`
- Modify: `tests/renderer-syntax.test.mjs`
- Create: `tests/productivity-toolbox-ui.test.mjs`

- [ ] **Step 1：先写结构契约测试**

```js
for (const label of ["Agent", "文件架", "剪贴板", "终端"]) assert.match(switcher, new RegExp(label));
assert.match(shelf, /onDragOver/);
assert.match(clipboard, /搜索剪贴板/);
assert.match(terminal, /进入完整终端/);
```

- [ ] **Step 2：验证 RED**

Run: `node --test tests/productivity-toolbox-ui.test.mjs tests/renderer-syntax.test.mjs`
Expected: FAIL，组件不存在。

- [ ] **Step 3：实现与现有视觉一致的组件和内部滚动**

`ToolboxSwitcher` 只渲染已启用项；`ShelfPanel` 支持拖入、选择、Quick Look 和引用删除；`ClipboardPanel` 支持搜索/筛选/收藏/复制；`TerminalPanel` 使用 xterm.js，命令卡与完整终端在一个模块内切换。

- [ ] **Step 4：验证并提交**

Run: `node --test tests/productivity-toolbox-ui.test.mjs tests/renderer-syntax.test.mjs`
Expected: PASS。

Commit: `git commit -m "feat(toolbox): render shelf clipboard and terminal modules"`

### Task 9：应用状态、Agent 抢占、拖入展开与焦点保护

**Files:**
- Modify: `src/renderer/island/app.js`
- Modify: `src/renderer/island/components/IslandPanel.js`
- Modify: `src/main/app-coordinator.cjs`
- Modify: `src/main/windows.cjs`
- Create: `tests/productivity-integration.test.mjs`

- [ ] **Step 1：先写抢占和焦点测试**

```js
test("approval preempts a utility but preserves its previous selection", () => {
  const next = reduceToolboxState({ current: "terminal", previousUtility: "terminal" }, { type: "agent-attention" });
  assert.deepEqual(next, { current: "agent", previousUtility: "terminal" });
});

test("interactive toolbox controls prevent focus-loss collapse", () => {
  assert.equal(isToolboxInteractionActive({ terminalFocused: true }), true);
});
```

- [ ] **Step 2：验证 RED**

Run: `node --test tests/productivity-integration.test.mjs`
Expected: FAIL，工具箱状态和焦点模型不存在。

- [ ] **Step 3：实现窗口拖入、服务启动/停止和交互保护**

拖入事件只在包含受支持数据时展开文件架；Agent actionable 事件抢占模块；终端输入、搜索框和拖拽期间抑制失焦收起。

- [ ] **Step 4：验证 GREEN 并提交**

Run: `node --test tests/productivity-integration.test.mjs`
Expected: PASS。

Commit: `git commit -m "feat(toolbox): preserve Agent priority and interactive focus"`

### Task 10：设置界面、中文说明与服务生命周期

**Files:**
- Modify: `src/renderer/settings-app.js`
- Modify: `src/renderer/settings-app.css`
- Modify: `src/main/app-coordinator.cjs`
- Modify: `tests/settings-ui.test.mjs`
- Modify: `tests/settings-workstation.test.mjs`

- [ ] **Step 1：先写设置文案和行为测试**

```js
for (const copy of ["文件架", "剪贴板历史", "快捷终端", "只保存在本机", "关闭并清空"]) assert.match(settingsSource, new RegExp(copy));
```

- [ ] **Step 2：验证 RED**

Run: `node --test tests/settings-ui.test.mjs tests/settings-workstation.test.mjs`
Expected: FAIL，设置文案和控件不存在。

- [ ] **Step 3：实现三个开关、历史策略、Shell/目录和快捷命令编辑器**

剪贴板开关首次开启展示本机隐私说明；关闭时展示“仅停止记录/关闭并清空”；终端关闭前确认结束当前 Shell。

- [ ] **Step 4：验证 GREEN 并提交**

Run: `node --test tests/settings-ui.test.mjs tests/settings-workstation.test.mjs`
Expected: PASS。

Commit: `git commit -m "feat(settings): configure productivity toolbox"`

### Task 11：完整自动化验证和本机验收构建

**Files:**
- Modify only if tests expose a defect in files already listed above.

- [ ] **Step 1：运行完整检查**

Run: `npm run check`
Expected: all static, source contract, renderer syntax, and unit tests pass with zero failures.

- [ ] **Step 2：构建打包产物**

Run: `npm run package:mac`
Expected: `release/mac-arm64/WorkIsland.app` and `release/WorkIsland-3.0.0-arm64.dmg` exist; node-pty binding is inside the packaged app and loads under Electron 43.

- [ ] **Step 3：签名校验**

Run: `codesign --verify --deep --strict release/mac-arm64/WorkIsland.app`
Expected: exit code 0.

- [ ] **Step 4：可恢复安装并真实冒烟**

将现有 `/Applications/WorkIsland.app` 移到废纸篓后安装新构建，保留用户设置。按设计文档的七组验收步骤验证真实拖入/拖出、剪贴板重启恢复、PTY 交互、设置开关和 Agent 抢占。

- [ ] **Step 5：最终提交但不推送**

Run: `git status --short && git diff --check`
Expected: 工作树干净；等待用户视觉和功能验收后再推送或创建 PR。
