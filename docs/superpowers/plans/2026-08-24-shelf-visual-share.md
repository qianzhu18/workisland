# 文件架原生分享、选择与复制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让文件架使用 macOS 原生分享能力，并支持文件单选、多选、批量复制和批量拖出。

**Architecture:** Renderer 只传受信任的 shelf item id；主进程重新解析并过滤文件，再调用 AppKit 原生分享面板或文件剪贴板。选择逻辑保留在文件架组件内，Electron `startDrag({ files })` 负责一次向外拖出多个已选文件。

**Tech Stack:** Electron 43、React、macOS AppKit/NSSharingServicePicker/NSPasteboard、Node test runner。

---

### Task 1: 收窄的批量文件 IPC

**Files:**
- Modify: `src/shared/ipc.cjs`
- Modify: `src/preload/island.js`
- Modify: `src/main/ipc-services.cjs`
- Test: `tests/productivity-ipc.test.mjs`

- [x] **Step 1: 写失败测试**：要求 `SHELF_COPY_ITEMS`、`SHELF_SHARE_ITEMS` 和数组形式的 `startShelfDrag(ids)` 存在。
- [x] **Step 2: 运行 `node --test tests/productivity-ipc.test.mjs`**，确认因接口缺失失败。
- [x] **Step 3: 实现最小 IPC**：所有操作只接收 id 数组，主进程通过 `coordinator.getShelfItem()` 解析并过滤不可用路径。
- [x] **Step 4: 重跑定向测试并确认通过。**

### Task 2: AppKit 原生分享与文件复制

**Files:**
- Modify: `native/panel-fix/src/panel_fix.mm`
- Modify: `src/main/native-platform-service.cjs`
- Modify: `src/main/index.cjs`
- Test: `tests/productivity-ipc.test.mjs`

- [x] **Step 1: 写失败测试**：要求原生模块暴露 `showFilesSharePicker`、`copyFilesToPasteboard`、`getAirDropIconDataUrl`。
- [x] **Step 2: 运行定向测试并观察预期失败。**
- [x] **Step 3: 用 `NSSharingServicePicker` 显示本机系统分享目标，用 `NSPasteboard writeObjects:` 写入文件 URL，并从系统 AirDrop sharing service/SF Symbol 生成原生图标。**
- [x] **Step 4: 运行 `npm run build:native` 与定向测试。**

### Task 3: 选择、复制与多文件拖出交互

**Files:**
- Modify: `src/renderer/island/components/ShelfPanel.js`
- Modify: `src/renderer/island/app.css`
- Test: `tests/productivity-toolbox-ui.test.mjs`

- [x] **Step 1: 写失败测试**：要求选择态、Command/Shift/Command+A/Command+C、批量工具条和系统分享文案存在。
- [x] **Step 2: 运行 `node --test tests/productivity-toolbox-ui.test.mjs` 并观察预期失败。**
- [x] **Step 3: 实现点击选择、区间选择、全选、复制、批量分享和 `startDrag({ files })` 路径。**
- [x] **Step 4: 增加清晰的选中视觉与紧凑批量操作，不压缩现有文件预览。**
- [x] **Step 5: 重跑 UI 定向测试。**

### Task 4: 回归与本机验收

**Files:**
- Verify only: entire feature worktree

- [x] **Step 1: 运行 `npm run check`，确认完整测试通过。**
- [x] **Step 2: 启动开发版，不生成安装包。**
- [ ] **Step 3: 验证原生分享面板、Finder 粘贴、单文件拖出与多文件拖出。**
- [ ] **Step 4: 等用户视觉与真实操作验收后再提交或推送。**
