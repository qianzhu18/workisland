# Settings Productivity Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将工作台和效率工具的详细设置收进可展开的父功能行，让通用设置页更清晰紧凑。

**Architecture:** 在现有原生 DOM 设置渲染器中增加一个可访问的折叠功能卡片 helper，并用内存中的 Set 管理展开状态。保留所有现有设置字段与保存函数，只调整 DOM 层级和 CSS。

**Tech Stack:** Electron renderer, vanilla JavaScript DOM, CSS, Node test runner

---

### Task 1: 锁定设置层级与折叠行为

**Files:**
- Modify: `tests/settings-ui.test.mjs`

- [ ] **Step 1: Write the failing test**

增加断言，要求存在 `featureSettingsRow`、`aria-expanded`、`aria-controls`，并要求通用页不再创建独立的“剪贴板”和“快捷终端” section。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/settings-ui.test.mjs`
Expected: FAIL because the disclosure helper does not exist yet.

### Task 2: 实现可展开功能卡片

**Files:**
- Modify: `src/renderer/settings-app.js`
- Modify: `src/renderer/settings-app.css`
- Test: `tests/settings-ui.test.mjs`

- [ ] **Step 1: Write minimal implementation**

增加当前窗口的展开状态、父功能行 helper 和详情容器；把媒体、性能、文件架、剪贴板、终端的从属设置移入各自容器。

- [ ] **Step 2: Add accessible interaction**

展开按钮设置 `aria-expanded`、`aria-controls` 与明确标签；点击后只切换目标功能并重新渲染。

- [ ] **Step 3: Add responsive styling**

父行右侧并排开关和展开按钮，详情行缩进；窄屏时控件占满可用宽度。

- [ ] **Step 4: Run targeted tests**

Run: `node --test tests/settings-ui.test.mjs`
Expected: PASS.

### Task 3: 回归和本机视觉验证

**Files:**
- Verify: `src/renderer/settings-app.js`
- Verify: `src/renderer/settings-app.css`

- [ ] **Step 1: Run full validation**

Run: `npm run check`
Expected: all checks pass.

- [ ] **Step 2: Restart the local development app**

重新启动当前工作树的 Electron 开发版，不制作安装包。

- [ ] **Step 3: Inspect collapsed and expanded screenshots**

打开通用设置，分别检查默认收起状态和快捷终端展开状态，确认层级、间距、滚动与控件均正常。
