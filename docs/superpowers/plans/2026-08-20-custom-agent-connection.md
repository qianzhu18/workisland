# 自定义智能体接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变既有灵动岛会话展示的前提下，让非技术用户通过设置向导安全接入支持官方 Hook 的本地智能体，并用真实事件验证连接。

**Architecture:** 新增一个独立的自定义连接存储和 Hook 管理器，严格校验用户输入的 agent id、配置路径、事件映射和命令模板；管理器只把 WorkIsland 所有的 Hook group 合并到用户确认的 JSON 配置。通过已有 `hooks-cli` 和 `BridgeServer` 把事件交给一个自定义 adapter，再复用现有 `AppCoordinator` 的会话、计时、灵动岛与通知逻辑。设置页仅调用新增的专用 IPC，先展示发现提示词和写入预览，获得用户确认后才安装。

**Tech Stack:** Electron、Node.js CommonJS、现有 Unix socket bridge、Node built-in test runner、原生 Settings renderer。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `src/main/custom-agent-connections.cjs` | 配置 schema、受限路径检查、JSON Hook 合并/卸载、manifest、验证时间戳。 |
| `src/main/adapters-custom-agent.cjs` | 将用户映射后的 Hook payload 规范化为既有 session events。 |
| `src/main/agent-registry.cjs` | 注册运行时自定义 adapter 的创建/销毁入口。 |
| `src/main/app-coordinator.cjs` | 持有连接服务、允许其 Hook source、将首个真实事件记为 verified。 |
| `src/shared/settings.cjs` | 持久化无敏感的自定义连接摘要与启用状态。 |
| `src/shared/ipc.cjs` | 新增自定义连接的列表、预览、安装、卸载 IPC 常量。 |
| `src/main/ipc-services.cjs` | 把新增 IPC 转交给 coordinator。 |
| `src/preload/settings.js` | 仅暴露所需的受限 IPC API。 |
| `src/renderer/settings-app.js` | Agent 页的发现说明、表单、预览、确认、验证状态和卸载入口。 |
| `src/renderer/settings-app.css` | 向导和配置预览的局部样式。 |
| `tests/custom-agent-connections.test.mjs` | schema、路径、JSON 合并、卸载、verification 的契约测试。 |
| `tests/custom-agent-adapter.test.mjs` | 自定义 lifecycle 事件到既有 session event 的映射测试。 |
| `tests/settings-ui.test.mjs` | Settings 向导文本、状态、发现提示词和确认按钮测试。 |

## Task 1: 受限自定义连接 schema 与 Hook 配置管理

**Files:**
- Create: `src/main/custom-agent-connections.cjs`
- Create: `tests/custom-agent-connections.test.mjs`

- [ ] **Step 1: 写失败测试，定义有效连接的最小输入与规范化结果。**

```js
test('normalizes an approved Hook connection without retaining raw discovery text', () => {
  const result = normalizeCustomConnection({
    id: 'mimo',
    label: 'MIMO',
    configPath: '/tmp/home/.mimo/hooks.json',
    eventMap: { prompt: 'UserPromptSubmit', stop: 'Stop' },
  }, { homeDir: '/tmp/home' });

  assert.deepEqual(result, {
    id: 'custom:mimo',
    source: 'custom:mimo',
    label: 'MIMO',
    configPath: '/tmp/home/.mimo/hooks.json',
    eventMap: { UserPromptSubmit: 'prompt', Stop: 'stop' },
  });
});
```

- [ ] **Step 2: 运行测试，确认失败原因是 `normalizeCustomConnection` 尚未导出。**

Run: `node --test tests/custom-agent-connections.test.mjs`

Expected: FAIL with `normalizeCustomConnection is not a function`.

- [ ] **Step 3: 实现最小 schema。**

```js
const ID_RE = /^[a-z0-9-]{1,32}$/;
const SUPPORTED_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'Notification']);

function normalizeCustomConnection(input, { homeDir }) {
  if (!input || typeof input !== 'object') throw new Error('连接信息无效');
  if (!ID_RE.test(input.id || '')) throw new Error('智能体标识只能包含小写字母、数字和连字符');
  if (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 48) throw new Error('请填写 1-48 个字符的智能体名称');
  const configPath = assertConfigPath(input.configPath, homeDir);
  const eventMap = normalizeEventMap(input.eventMap);
  if (!eventMap.UserPromptSubmit || !eventMap.Stop) throw new Error('至少需要映射“提交任务”和“任务完成”事件');
  return { id: `custom:${input.id}`, source: `custom:${input.id}`, label: input.label.trim(), configPath, eventMap };
}
```

`assertConfigPath` 必须解析绝对路径，仅允许 `homeDir` 下以 `.` 开头的配置目录，拒绝 `..` 逃逸和非 `.json` 文件。`normalizeEventMap` 必须拒绝未知 WorkIsland event、重复外部事件和非字符串值。

- [ ] **Step 4: 运行测试，确认通过。**

Run: `node --test tests/custom-agent-connections.test.mjs`

Expected: PASS.

- [ ] **Step 5: 写失败测试，覆盖拒绝不安全路径、未知事件和缺少关键 lifecycle。**

```js
test('rejects unsafe config paths and incomplete lifecycle maps', () => {
  assert.throws(() => normalizeCustomConnection({ id: 'mimo', label: 'MIMO', configPath: '/tmp/other/hooks.json', eventMap: { prompt: 'UserPromptSubmit', stop: 'Stop' } }, { homeDir: '/tmp/home' }), /配置文件/);
  assert.throws(() => normalizeCustomConnection({ id: 'mimo', label: 'MIMO', configPath: '/tmp/home/.mimo/hooks.json', eventMap: { prompt: 'UnknownEvent', stop: 'Stop' } }, { homeDir: '/tmp/home' }), /不支持/);
  assert.throws(() => normalizeCustomConnection({ id: 'mimo', label: 'MIMO', configPath: '/tmp/home/.mimo/hooks.json', eventMap: { start: 'SessionStart' } }, { homeDir: '/tmp/home' }), /提交任务/);
});
```

- [ ] **Step 6: 运行测试，确认新增断言先失败，再补齐校验并验证通过。**

Run: `node --test tests/custom-agent-connections.test.mjs`

Expected before implementation: FAIL on the first missing validation; after implementation: PASS.

- [ ] **Step 7: 写失败测试，覆盖 Hook group 合并、保留用户 group 和只移除 WorkIsland group。**

```js
test('installs and uninstalls only its own marked Hook groups', async () => {
  await writeFile(configPath, JSON.stringify({ version: 1, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'user-command' }] }] } }));
  await manager.install(connection);
  const installed = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(installed.hooks.Stop.length, 2);
  assert.match(installed.hooks.Stop[1].hooks[0].command, /--source custom:mimo/);
  await manager.uninstall(connection);
  const removed = JSON.parse(await readFile(configPath, 'utf8'));
  assert.deepEqual(removed.hooks.Stop, [{ hooks: [{ type: 'command', command: 'user-command' }] }]);
});
```

- [ ] **Step 8: 实现 `CustomAgentConnectionManager`。**

管理器构造参数为 `{ homeDir, hookCommandForSource, manifestDir }`；写入的 command 必须由 `hookCommandForSource(connection.source)` 生成，绝不执行用户输入的任意命令。每一个 Hook group 添加 `workIsland: { connectionId, version: 1 }` 标识；安装前解析 JSON，遇到不存在可创建 `{ version: 1, hooks: {} }`，遇到不合法 JSON 必须抛错且不写入；卸载只移除带相同 `connectionId` 标识的 group。

- [ ] **Step 9: 运行 manager 测试，确认通过。**

Run: `node --test tests/custom-agent-connections.test.mjs`

Expected: PASS.

- [ ] **Step 10: 写失败测试，验证 preview 与真实事件验证状态。**

```js
test('reports configured until it receives a real event, then reports verified', async () => {
  await manager.install(connection);
  assert.equal((await manager.getStatus(connection)).state, 'configured');
  await manager.recordVerifiedEvent('custom:mimo', new Date('2026-08-20T08:00:00.000Z'));
  assert.deepEqual(await manager.getStatus(connection), {
    state: 'verified', verifiedAt: '2026-08-20T08:00:00.000Z'
  });
});
```

- [ ] **Step 11: 实现 manifest 与状态读取。**

manifest 写入 `<manifestDir>/custom-mimo.json`，仅包含 `id`、`label`、`configPath`、`eventMap`、`installedAt`、`verifiedAt` 和 `hookCommandFingerprint`。`preview(connection)` 返回要新增的每个 event/group 和目标路径，但不写文件。

- [ ] **Step 12: 运行完整测试并提交。**

Run: `node --test tests/custom-agent-connections.test.mjs`

Expected: PASS.

```bash
git add src/main/custom-agent-connections.cjs tests/custom-agent-connections.test.mjs
git commit -m "feat(agents): manage custom Hook connections"
```

## Task 2: 自定义事件 adapter 与 BridgeServer 注册

**Files:**
- Create: `src/main/adapters-custom-agent.cjs`
- Modify: `src/main/agent-registry.cjs`
- Modify: `src/main/app-coordinator.cjs`
- Test: `tests/custom-agent-adapter.test.mjs`

- [ ] **Step 1: 写失败测试，确认提示词事件复用既有会话字段。**

```js
test('maps custom prompt and stop events into existing session lifecycle events', () => {
  const adapter = new CustomAgentAdapter(connection);
  const events = collectAdapterEvents(adapter, [
    { hook_event_name: 'prompt', session_id: 'mimo-1', cwd: '/tmp/project', prompt: '修复登录' },
    { hook_event_name: 'stop', session_id: 'mimo-1', last_assistant_message: '完成' },
  ]);
  assert.deepEqual(events.map(event => event.type), ['sessionStarted', 'activityUpdated', 'activityUpdated', 'sessionCompleted']);
  assert.equal(events[0].title, 'project');
  assert.equal(events[1].latestUserPrompt, '修复登录');
  assert.equal(events[3].lastAssistantMessage, '完成');
});
```

- [ ] **Step 2: 运行测试，确认失败。**

Run: `node --test tests/custom-agent-adapter.test.mjs`

Expected: FAIL because `CustomAgentAdapter` does not exist.

- [ ] **Step 3: 实现最小 adapter。**

`CustomAgentAdapter` 接受规范化 connection，使用 connection 的反向 eventMap 将外部 `hook_event_name` 解析为标准 event。`UserPromptSubmit` 发出 `sessionStarted`（首次时含 `path.basename(cwd)` title 和 prompt summary）及 `activityUpdated`（含 `latestUserPrompt`）；`PreToolUse`/`PostToolUse` 更新 activity；`Stop` 发出 `sessionCompleted`；`Notification` 发出既有 notification 对应 event。缺少 `session_id` 的 payload 返回 acknowledged 且不创建会话。

- [ ] **Step 4: 运行 adapter 测试，确认通过。**

Run: `node --test tests/custom-agent-adapter.test.mjs`

Expected: PASS.

- [ ] **Step 5: 写失败测试，确认 registry 能按动态 source 取得自定义 adapter。**

```js
test('resolves custom agent sources only when a saved connection exists', () => {
  const registry = createCustomAdapterRegistry([connection]);
  assert.equal(registry.get('custom:mimo').agentId, 'custom:mimo');
  assert.equal(registry.get('custom:unknown'), undefined);
});
```

- [ ] **Step 6: 实现动态 registry 和 coordinator 注入。**

在 `agent-registry.cjs` 导出 `createCustomAdapterRegistry(connections)`；在 `AppCoordinator` 构造时从自定义连接服务加载已安装连接，合并到 bridge 的 adapter 查找逻辑，并在 `shouldAcceptHookSource` 中仅允许已安装的 `custom:<id>`。收到可接受的自定义事件后调用 `recordVerifiedEvent`，但只有 adapter 成功产生事件才记录。

- [ ] **Step 7: 运行两个测试文件，确认通过并提交。**

Run: `node --test tests/custom-agent-connections.test.mjs tests/custom-agent-adapter.test.mjs`

Expected: PASS.

```bash
git add src/main/adapters-custom-agent.cjs src/main/agent-registry.cjs src/main/app-coordinator.cjs tests/custom-agent-adapter.test.mjs
git commit -m "feat(agents): route custom Hook events"
```

## Task 3: 设置、IPC 与非技术用户向导

**Files:**
- Modify: `src/shared/ipc.cjs`
- Modify: `src/main/ipc-services.cjs`
- Modify: `src/preload/settings.js`
- Modify: `src/renderer/settings-app.js`
- Modify: `src/renderer/settings-app.css`
- Test: `tests/settings-ui.test.mjs`

- [ ] **Step 1: 写失败的 Settings UI 契约测试。**

```js
test('agents page explains Hook discovery and exposes a guided connection action', () => {
  const source = readFileSync('src/renderer/settings-app.js', 'utf8');
  assert.match(source, /接入我的智能体/);
  assert.match(source, /不知道 Hook 是什么/);
  assert.match(source, /先发送一条测试消息/);
  assert.match(source, /已收到真实事件/);
});
```

- [ ] **Step 2: 运行测试，确认 UI 文案尚不存在。**

Run: `node --test tests/settings-ui.test.mjs`

Expected: FAIL on `接入我的智能体`.

- [ ] **Step 3: 定义严格 IPC。**

在 `src/shared/ipc.cjs` 新增 `SETTINGS_LIST_CUSTOM_AGENT_CONNECTIONS`、`SETTINGS_PREVIEW_CUSTOM_AGENT_CONNECTION`、`SETTINGS_INSTALL_CUSTOM_AGENT_CONNECTION` 与 `SETTINGS_UNINSTALL_CUSTOM_AGENT_CONNECTION`。对应的 `ipc-services.cjs` handler 必须只将原始结构交给 coordinator 的同名方法；preload 只暴露 `listCustomAgentConnections`、`previewCustomAgentConnection`、`installCustomAgentConnection`、`uninstallCustomAgentConnection`。

- [ ] **Step 4: 实现 Settings 向导。**

在 `agentsPage()` 的内置 Agent 卡片前增加一个 section：标题为 `接入我的智能体`，正文解释“仅支持该智能体官方提供的本地 Hook；没有 Hook 时无法可靠显示项目、提示词和运行状态”。包含：

```js
const DISCOVERY_PROMPT = '请只查阅官方文档：这个智能体是否支持 macOS 本地生命周期 Hook？如支持，请给出配置文件路径、开始/提交任务/完成事件名称和 JSON 配置示例。不要执行命令，不要读取或修改文件。';
```

表单字段为名称、配置 JSON 路径，以及三项可选的外部事件名称（提交任务和完成任务为必填，开始/活动/通知可选）。点击 `预览接入` 必须先调用 preview；预览区显示路径、将注册的事件和 WorkIsland bridge command。只有点击 `确认写入并开始验证` 后才调用 install。卡片根据 status 显示 `未配置`、`已配置，等待真实事件`、`已验证接入` 或错误详情，并提供 `移除连接`。

- [ ] **Step 5: 运行 UI 测试，确认通过。**

Run: `node --test tests/settings-ui.test.mjs`

Expected: PASS.

- [ ] **Step 6: 增加预览确认前不写入的失败测试并实现。**

```js
test('preview route has no installation side effect', async () => {
  await coordinator.previewCustomAgentConnection(input);
  assert.equal(existsSync(configPath), false);
  await coordinator.installCustomAgentConnection(input);
  assert.equal(existsSync(configPath), true);
});
```

Run: `node --test tests/custom-agent-connections.test.mjs tests/settings-ui.test.mjs`

Expected before implementation: FAIL; after implementation: PASS.

- [ ] **Step 7: 提交 UI 与 IPC。**

```bash
git add src/shared/ipc.cjs src/main/ipc-services.cjs src/preload/settings.js src/renderer/settings-app.js src/renderer/settings-app.css tests/settings-ui.test.mjs tests/custom-agent-connections.test.mjs
git commit -m "feat(settings): guide custom agent connections"
```

## Task 4: 回归检查、真实 MIMO 验收与 PR

**Files:**
- Modify: `docs/README.md`
- Test: `tests/custom-agent-connections.test.mjs`
- Test: `tests/custom-agent-adapter.test.mjs`
- Test: `tests/settings-ui.test.mjs`

- [ ] **Step 1: 更新用户文档。**

在 `docs/README.md` 添加“自定义智能体接入”说明：它只支持官方本地 Hook；向导会先预览、再征求写入确认、最后要求真实测试；没有官方 Hook 的产品会显示不支持，不建议粘贴非官方或不理解的命令。

- [ ] **Step 2: 运行针对性测试。**

Run: `node --test tests/custom-agent-connections.test.mjs tests/custom-agent-adapter.test.mjs tests/settings-ui.test.mjs`

Expected: PASS.

- [ ] **Step 3: 运行完整质量检查。**

Run: `npm run check`

Expected: exit code 0.

- [ ] **Step 4: 真实 macOS 验收。**

1. 在 Settings 中完成一次不带 Hook 的 Agent 流程，确认无写入且显示不支持说明。
2. 使用 MIMO 或另一个未内置、拥有官方 Hook 的本地 Agent，按向导填写官方路径和事件名。
3. 在确认页面核对命令、配置路径和事件列表。
4. 安装后向 Agent 发送真实提示词。
5. 确认灵动岛显示 Agent 名称、项目、提示词、运行时长和状态变化；确认 Settings 状态变为 `已验证接入`。
6. 移除连接，确认只删除 WorkIsland-owned Hook group。

- [ ] **Step 5: 提交文档并创建 PR。**

```bash
git add docs/README.md
git commit -m "docs(agents): explain custom Hook connection"
gh pr create --base main --head feature/custom-agent-connection --title "feat(agents): add guided custom Hook connections" --body-file .github/PULL_REQUEST_TEMPLATE.md
```

PR 说明必须链接 `#32`，标注 Trae 与 DeepSeek Harness 为后续独立 PR，且只在完成真实 MIMO 验收后使用 `Closes #32`。

## 后续独立 PR

### Trae

先完成国际版与国内版真实 Hook 触发验证，再为实际被读取的配置路径写出失败测试、最小路径修复、`npm run check` 和真实对话证据。不能用“配置文件存在”代替真实触发。

### DeepSeek Harness

先锁定 DSH 当时的公开插件 API 版本，做一个只订阅官方 lifecycle event 的本地桥接插件；用现有 `hooks-cli` source 和 session event contract 接入。SQLite 监视只作为明确版本/路径的只读降级，不作为第一版默认路径。
