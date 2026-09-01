# Popup Click-Through Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让灵动岛展开时仅可见面板接收鼠标，透明区域不再阻塞其他应用。

**Architecture:** 渲染进程通过新的 IPC 上报实际面板矩形，主进程用该矩形和系统光标坐标决定 Electron 窗口是否穿透鼠标。文件拖放保持最高优先级，收起胶囊继续沿用现有临近热区。

**Tech Stack:** Electron IPC、CommonJS 主进程、React 渲染进程、Node.js `node:test`

---

### Task 1: 定义展开面板的命中规则

**Files:**
- Modify: `tests/island-file-drop-interaction.test.mjs`
- Modify: `src/main/island-file-drop-interaction.cjs`

- [ ] **Step 1: 写失败测试**

```js
test("an expanded panel only captures the pointer inside its visible bounds", () => {
  const state = { fileDragActive: false, panelExpanded: true, concealed: false };
  assert.equal(resolveDropProximityMouseMode({ ...state, pointerInside: true }), "interactive");
  assert.equal(resolveDropProximityMouseMode({ ...state, pointerInside: false }), "forward");
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/island-file-drop-interaction.test.mjs`
Expected: FAIL，展开面板且光标在可见区域外时当前结果仍为 `interactive`。

- [ ] **Step 3: 最小实现**

```js
if (fileDragActive) return "interactive";
if (concealed) return "preserve";
return pointerInside ? "interactive" : "forward";
```

同时让 `shouldForwardMouseEventsOnLeave()` 只受活跃文件拖放控制，以便离开可见面板后立即穿透。

- [ ] **Step 4: 运行测试并确认通过**

Run: `node --test tests/island-file-drop-interaction.test.mjs`
Expected: PASS

### Task 2: 打通可见区域 IPC

**Files:**
- Modify: `src/shared/ipc.cjs`
- Modify: `src/preload/island.js`
- Modify: `src/renderer/island/app.js`
- Modify: `src/main/windows.cjs`
- Test: `tests/island-file-drop-interaction.test.mjs`

- [ ] **Step 1: 为边界校验写失败测试**

```js
assert.deepEqual(normalizeIslandInteractionBounds({ x: 20, y: 0, width: 700, height: 320 }), {
  x: 20, y: 0, width: 700, height: 320
});
assert.equal(normalizeIslandInteractionBounds({ x: 0, y: 0, width: -1, height: 20 }), null);
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/island-file-drop-interaction.test.mjs`
Expected: FAIL，`normalizeIslandInteractionBounds` 尚未导出。

- [ ] **Step 3: 实现边界上报和屏幕坐标换算**

新增 `ISLAND_INTERACTION_BOUNDS`；预加载层暴露 `setInteractionBounds(bounds)`；渲染层在 `panelWidth` 或 `actualPanelH` 变化时上报：

```js
window.islandBridge?.setInteractionBounds({
  x: (WINDOW_W - panelWidth) / 2,
  y: 0,
  width: panelWidth,
  height: actualPanelH
});
```

主进程校验并保存矩形。展开时使用 `windowBounds + interactionBounds` 判断 `pointerInside`，未上报时兼容回退为当前窗口矩形。

- [ ] **Step 4: 运行相关测试**

Run: `node --test tests/island-file-drop-interaction.test.mjs`
Expected: PASS

### Task 3: 回归检查与交付构建

**Files:**
- Verify: `src/main/windows.cjs`
- Verify: `src/renderer/island/app.js`
- Verify: `src/main/shortcut-service.cjs`

- [ ] **Step 1: 运行完整检查**

Run: `npm run check`
Expected: renderer build、static checks、source contracts 和全部单元测试通过。

- [ ] **Step 2: 生成 macOS 安装包**

Run: `npm run package:mac`
Expected: `release/` 下生成新的 arm64 DMG，且打包过程通过签名步骤或明确报告本机签名限制。

- [ ] **Step 3: 核对打包内容**

解包构建产物的 `app.asar`，确认同时包含 `ISLAND_INTERACTION_BOUNDS` 与 `setTerminalInteractive`，避免再次出现“源码已修、正式应用仍旧”的交付断层。
