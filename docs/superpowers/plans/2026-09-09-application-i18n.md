# WorkIsland Application Internationalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship complete Simplified Chinese and English application UI with system-language detection, a live manual override, and CI enforcement that prevents untranslated product strings.

**Architecture:** A main-process localization service loads two flat JSON catalogs, resolves `system | zh-CN | en`, translates native surfaces, and broadcasts locale snapshots. Renderer roots initialize a shared synchronous translator before first paint and rerender in place on locale changes, preserving terminal and session state. A source/catalog checker is part of `npm run check`.

**Tech Stack:** Electron 43, CommonJS main process, ES-module React renderer surfaces, authored DOM Settings renderer, Node test runner, JSON locale catalogs.

---

## File map

- `src/locales/zh-CN.json`, `src/locales/en.json`: the only product translation sources.
- `src/shared/locale.cjs`: preference validation, system resolution, interpolation, catalog validation.
- `src/main/localization-service.cjs`: catalog loading, authoritative locale, main translation, change broadcasts.
- `src/main/i18n.cjs`: mutable main-process translator used by existing services and adapters.
- `src/renderer/shared/i18n.js`: renderer initialization, synchronous `t()`, and change subscriptions.
- `src/renderer/vendor/react-runtime.js`: legacy proxy compatibility while calls move to semantic `t(key)`.
- `scripts/check-i18n.mjs`: catalog parity, placeholder parity, and presentation-source guard.
- `docs/I18N.md`: contributor contract and new-language procedure.

### Task 1: Locale core and settings migration

**Files:**
- Create: `src/shared/locale.cjs`
- Modify: `src/shared/settings.cjs`
- Create: `tests/locale-core.test.mjs`
- Modify: `tests/settings-repository.test.mjs`

- [ ] **Step 1: Write failing locale-resolution and translation tests**

Cover these exact cases:

```js
assert.equal(resolveLocale("system", ["zh-Hans-CN", "en-US"]), "zh-CN");
assert.equal(resolveLocale("system", ["ja-JP", "en-GB"]), "en");
assert.equal(resolveLocale("system", ["zh-Hant-TW", "en-US"]), "en");
assert.equal(resolveLocale("zh-CN", ["en-US"]), "zh-CN");
assert.equal(normalizeLanguagePreference("fr"), "system");
assert.equal(interpolate("Hello, {name}", { name: "Skyler" }), "Hello, Skyler");
```

Add a settings assertion that `mergeSettings({ locale: "zh" })` returns `languagePreference: "system"` and has no own `locale` property.

- [ ] **Step 2: Run RED tests**

Run: `node --test tests/locale-core.test.mjs tests/settings-repository.test.mjs`

Expected: FAIL because `src/shared/locale.cjs` and `languagePreference` do not exist.

- [ ] **Step 3: Implement the dependency-free locale core**

Export this public contract:

```js
const SUPPORTED_LOCALES = Object.freeze(["zh-CN", "en"]);
const LANGUAGE_PREFERENCES = Object.freeze(["system", ...SUPPORTED_LOCALES]);

function normalizeLanguagePreference(value) {
  return LANGUAGE_PREFERENCES.includes(value) ? value : "system";
}

function resolveLocale(preference, preferredLanguages = []) {
  const normalized = normalizeLanguagePreference(preference);
  if (normalized !== "system") return normalized;
  for (const raw of preferredLanguages) {
    const tag = String(raw || "").toLowerCase();
    if (tag === "zh" || tag === "zh-cn" || tag.startsWith("zh-hans")) return "zh-CN";
    if (tag === "en" || tag.startsWith("en-")) return "en";
  }
  return "en";
}
```

Implement named `{placeholder}` interpolation without evaluating strings. Add `languagePreference: "system"` to defaults, normalize it in `mergeSettings()`, and delete the legacy `locale` field.

- [ ] **Step 4: Run GREEN tests**

Run: `node --test tests/locale-core.test.mjs tests/settings-repository.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/locale.cjs src/shared/settings.cjs tests/locale-core.test.mjs tests/settings-repository.test.mjs
git commit -m "feat(i18n): define locale policy and settings migration"
```

### Task 2: Catalog contract and authoritative main service

**Files:**
- Create: `src/locales/zh-CN.json`
- Create: `src/locales/en.json`
- Create: `src/main/localization-service.cjs`
- Modify: `src/main/i18n.cjs`
- Create: `tests/localization-service.test.mjs`

- [ ] **Step 1: Write failing service tests**

Use temporary fixture catalogs and injected functions. Assert that:

```js
const service = createLocalizationService({
  getPreference: () => preference,
  setPreference: (value) => { preference = value; },
  getPreferredSystemLanguages: () => ["en-US", "zh-Hans-CN"],
  catalogs: {
    "zh-CN": { "common.cancel": "取消" },
    en: { "common.cancel": "Cancel" }
  },
  broadcast: (snapshot) => broadcasts.push(snapshot)
});
assert.equal(service.getSnapshot().locale, "en");
assert.equal(service.t("common.cancel"), "Cancel");
service.setPreference("zh-CN");
assert.equal(broadcasts.at(-1).messages["common.cancel"], "取消");
```

Also assert invalid keys fall back to the English catalog and that an unknown preference persists as `system`.

- [ ] **Step 2: Run RED test**

Run: `node --test tests/localization-service.test.mjs`

Expected: FAIL because the service and catalogs do not exist.

- [ ] **Step 3: Implement catalogs and service**

Start catalogs with foundation keys used by Tasks 3–7. `createLocalizationService()` must expose:

```js
{
  getSnapshot,       // { preference, locale, messages }
  getPreference,
  getLocale,
  t,                 // t(key, params)
  setPreference,     // normalize, persist, apply, broadcast
  refreshSystemLocale
}
```

Update `src/main/i18n.cjs` to support `configureI18n({ locale, messages, fallbackMessages })` and `i18n.t(key, params)`. Keep the old proxy property form only until all existing `i18n.k...` calls are migrated in Task 6.

- [ ] **Step 4: Run GREEN test**

Run: `node --test tests/localization-service.test.mjs tests/locale-core.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/locales src/main/localization-service.cjs src/main/i18n.cjs tests/localization-service.test.mjs
git commit -m "feat(i18n): add catalogs and main localization service"
```

### Task 3: Locale IPC, preload APIs, and live renderer store

**Files:**
- Modify: `src/shared/ipc.cjs`
- Modify: `src/main/ipc-services.cjs`
- Modify: `src/main/index.cjs`
- Modify: `src/main/app-coordinator.cjs`
- Modify: `src/preload/island.js`
- Modify: `src/preload/settings.js`
- Modify: `src/preload/welcome.js`
- Modify: `src/preload/pet.js`
- Modify: `src/preload/pet-panel.js`
- Modify: `src/preload/debug.js`
- Modify: `src/renderer/shared/i18n.js`
- Modify: `src/renderer/vendor/react-runtime.js`
- Create: `tests/i18n-ipc.test.mjs`
- Create: `tests/renderer-i18n.test.mjs`

- [ ] **Step 1: Write failing IPC and renderer tests**

Assert the shared IPC contract includes `LOCALE_GET_STATE`, `LOCALE_SET_PREFERENCE`, and `LOCALE_DID_CHANGE`. Assert every product preload exposes `getLocaleState()`, `setLanguagePreference(preference)`, and `onLocaleChanged(callback)` without exposing raw `ipcRenderer`.

Test renderer behavior with a fake bridge:

```js
await initializeI18n(fakeBridge);
assert.equal(t("common.cancel"), "Cancel");
fakeBridge.emit({ locale: "zh-CN", messages: { "common.cancel": "取消" } });
assert.equal(t("common.cancel"), "取消");
assert.equal(changeCount, 1);
```

- [ ] **Step 2: Run RED tests**

Run: `node --test tests/i18n-ipc.test.mjs tests/renderer-i18n.test.mjs`

Expected: FAIL on missing channels and APIs.

- [ ] **Step 3: Wire the authoritative service**

Instantiate localization after Electron ready and before product windows render. Replace the old startup block that writes `settings.locale`. Inject the service into IPC registration. Broadcast `LOCALE_DID_CHANGE` to every live WorkIsland window, then rebuild application/tray menus.

When the app activates, call `refreshSystemLocale()`; it broadcasts only when preference is `system` and the resolved locale changed.

- [ ] **Step 4: Implement the renderer store**

`initializeI18n(bridge)` must await the first snapshot, set `document.documentElement.lang`, and subscribe once. Export:

```js
export { initializeI18n, t, onLocaleChange, getLocale, getLanguagePreference };
```

Modify the vendor proxy so semantic calls use `i18n.t("namespace.key", params)` during migration. Do not reload any renderer when locale changes.

- [ ] **Step 5: Run GREEN tests**

Run: `node --test tests/i18n-ipc.test.mjs tests/renderer-i18n.test.mjs tests/renderer-syntax.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.cjs src/main src/preload src/renderer/shared/i18n.js src/renderer/vendor/react-runtime.js tests/i18n-ipc.test.mjs tests/renderer-i18n.test.mjs
git commit -m "feat(i18n): synchronize locale across application surfaces"
```

### Task 4: Settings language control and complete Settings translation

**Files:**
- Modify: `src/renderer/island/renderer/settings.html`
- Modify: `src/renderer/settings-app.js`
- Modify: `src/locales/zh-CN.json`
- Modify: `src/locales/en.json`
- Modify: `tests/settings-ui.test.mjs`

- [ ] **Step 1: Write failing Settings tests**

Assert the Settings entry is an ES module, initializes localization, subscribes to locale changes, and contains a `languagePreference` select with exactly `system`, `zh-CN`, and `en`. Assert switching it calls `setLanguagePreference()` rather than the generic settings setter.

Add source assertions that navigation, confirmation, toast, placeholder, accessibility, General, Agents, Appearance, Sound, MCP, Remote, Update, Telemetry, and About labels are produced by `t("settings.` or `t("common.` keys.

- [ ] **Step 2: Run RED test**

Run: `node --test tests/settings-ui.test.mjs`

Expected: FAIL because Settings has no real language control and direct strings remain.

- [ ] **Step 3: Convert Settings to the shared translator**

Change the script to `type="module"`, import and await `initializeI18n(api)`, and subscribe with `onLocaleChange(() => renderPage())`. Add the language row near the start of General settings. Migrate every user-visible literal in Settings HTML/JS—including dynamic messages and ARIA labels—to semantic `settings.*` or `common.*` keys in both catalogs.

Keep commands, paths, URLs, product/Agent names, and user-entered feedback verbatim.

- [ ] **Step 4: Run GREEN test**

Run: `node --test tests/settings-ui.test.mjs tests/renderer-syntax.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/island/renderer/settings.html src/renderer/settings-app.js src/locales tests/settings-ui.test.mjs
git commit -m "feat(i18n): localize settings and add language override"
```

### Task 5: Island, terminal, utility, onboarding, and pet translation

**Files:**
- Modify: `src/renderer/island/app.js`
- Modify: `src/renderer/island/components/ClipboardPanel.js`
- Modify: `src/renderer/island/components/IslandPanel.js`
- Modify: `src/renderer/island/components/IslandPill.js`
- Modify: `src/renderer/island/components/LyricsPanel.js`
- Modify: `src/renderer/island/components/MediaCard.js`
- Modify: `src/renderer/island/components/PerformancePopover.js`
- Modify: `src/renderer/island/components/SettingsChangeCard.js`
- Modify: `src/renderer/island/components/ShelfPanel.js`
- Modify: `src/renderer/island/components/TerminalPanel.js`
- Modify: `src/renderer/island/components/ToolbarTools.js`
- Modify: `src/renderer/island/components/ToolboxSwitcher.js`
- Modify: `src/renderer/island/components/UpdatePopover.js`
- Modify: `src/renderer/island/components/UsagePanel.js`
- Modify: `src/renderer/assets/welcome-app.js`
- Modify: `src/renderer/assets/welcome-view.js`
- Modify: `src/renderer/pet/app.js`
- Modify: `src/renderer/pet/model.mjs`
- Modify: `src/renderer/pet/panel-app.js`
- Modify: `src/renderer/debug-app.js`
- Modify: `src/locales/zh-CN.json`
- Modify: `src/locales/en.json`
- Modify: `tests/productivity-toolbox-ui.test.mjs`
- Modify: `tests/usage-panel-ui.test.mjs`
- Create: `tests/renderer-localization-surfaces.test.mjs`

- [ ] **Step 1: Write failing surface tests**

Assert each renderer root awaits `initializeI18n()` and registers an in-place locale revision/subscription. Assert the Island, all utility panels, Welcome, Pet, Pet Panel, and Debug presentation files use semantic `island.*`, `terminal.*`, `clipboard.*`, `shelf.*`, `usage.*`, `media.*`, `performance.*`, `welcome.*`, `pet.*`, or `debug.*` keys for their user-visible content.

Add a terminal-continuity assertion that locale change handling contains neither `window.location.reload` nor a terminal restart call.

- [ ] **Step 2: Run RED tests**

Run: `node --test tests/renderer-localization-surfaces.test.mjs tests/productivity-toolbox-ui.test.mjs tests/usage-panel-ui.test.mjs`

Expected: FAIL on direct strings and missing root subscriptions.

- [ ] **Step 3: Migrate renderer surfaces**

Replace every old `i18n.k...` call and every direct user-facing literal with `i18n.t("semantic.key", params)` or shared `t()`. Add exact Chinese and reviewed English values to both catalogs. Preserve external session content, terminal data, filenames, commands, media metadata, and Agent labels.

At each React root, increment a locale revision state from `onLocaleChange`; do not change existing component keys, stores, terminal ownership, or session state.

- [ ] **Step 4: Run GREEN tests**

Run: `node --test tests/renderer-localization-surfaces.test.mjs tests/productivity-toolbox-ui.test.mjs tests/usage-panel-ui.test.mjs tests/renderer-syntax.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer src/locales tests/renderer-localization-surfaces.test.mjs tests/productivity-toolbox-ui.test.mjs tests/usage-panel-ui.test.mjs
git commit -m "feat(i18n): localize Island and companion surfaces"
```

### Task 6: Main-process notifications, dialogs, menus, and surfaced errors

**Files:**
- Modify: `src/main/index.cjs`
- Modify: `src/main/ipc-services.cjs`
- Modify: `src/main/update-service.cjs`
- Modify: `src/main/app-coordinator.cjs`
- Modify: `src/main/adapters-cli.cjs`
- Modify: `src/main/adapters-dsh.cjs`
- Modify: `src/main/adapters-extended.cjs`
- Modify: `src/main/adapters-ide.cjs`
- Modify: `src/main/adapters-work-agents.cjs`
- Modify: `src/main/agent-registry.cjs`
- Modify: `src/main/appearance-controller.cjs`
- Modify: `src/main/appearance-service.cjs`
- Modify: `src/main/bark-push.cjs`
- Modify: `src/main/bridge-server.cjs`
- Modify: `src/main/bridge-support.cjs`
- Modify: `src/main/codex-transcript-watcher.cjs`
- Modify: `src/main/display-manager.cjs`
- Modify: `src/main/mcp-diagnostics.cjs`
- Modify: `src/main/pet-library.cjs`
- Modify: `src/main/quota-service.cjs`
- Modify: `src/main/remote-bridge-server.cjs`
- Modify: `src/main/remote-host-store.cjs`
- Modify: `src/main/remote-protocol.cjs`
- Modify: `src/main/session-state.cjs`
- Modify: `src/main/template-controller.cjs`
- Modify: `src/main/template-github.cjs`
- Modify: `src/main/template-service.cjs`
- Modify: `src/main/terminal-navigation.cjs`
- Modify: `src/main/usage-discovery.cjs`
- Modify: `src/main/usage-pricing.cjs`
- Modify: `src/main/usage-service.cjs`
- Modify: `src/main/windows.cjs`
- Modify: `src/shared/agent-catalog.cjs`
- Modify: `src/shared/product-capabilities.cjs`
- Modify: `src/shared/settings-control-schema.cjs`
- Modify: `src/shared/template-manifest.cjs`
- Modify: `src/locales/zh-CN.json`
- Modify: `src/locales/en.json`
- Create: `tests/main-localization-surfaces.test.mjs`
- Modify: `tests/update-service.test.mjs`

- [ ] **Step 1: Write failing main-surface tests**

Assert update notifications, file/directory dialogs, permission guidance, Windows tray labels, macOS application menu labels, and user-surfaced service errors call `i18n.t()` with semantic keys. Assert no `i18n.k` calls remain in `src/main`.

Test the application-menu factory with both locales and verify at least About, Settings, Hide, Quit, Edit, Copy, Paste, and Window labels.

- [ ] **Step 2: Run RED tests**

Run: `node --test tests/main-localization-surfaces.test.mjs tests/update-service.test.mjs`

Expected: FAIL on fallback-only and hardcoded main strings.

- [ ] **Step 3: Migrate user-visible main boundaries**

Translate presentation strings at the point they become UI. Do not translate log-only messages, protocol error codes, third-party payloads, paths, commands, session content, or internal diagnostics.

Create a locale-aware application menu for macOS and rebuild it with the tray menu when language changes. Menu items use explicit labels with Electron roles for behavior.

- [ ] **Step 4: Run GREEN tests**

Run: `node --test tests/main-localization-surfaces.test.mjs tests/update-service.test.mjs tests/renderer-syntax.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main src/shared src/locales tests/main-localization-surfaces.test.mjs tests/update-service.test.mjs
git commit -m "feat(i18n): localize native and main-process surfaces"
```

### Task 7: Doctor localization

**Files:**
- Modify: `scripts/doctor.mjs`
- Modify: `src/shared/agent-doctor.cjs`
- Modify: `src/locales/zh-CN.json`
- Modify: `src/locales/en.json`
- Modify: `tests/agent-doctor.test.mjs`
- Create: `tests/doctor-localization.test.mjs`

- [ ] **Step 1: Write failing Doctor tests**

Run Doctor formatting against `zh-CN` and `en` and assert translated headings, statuses, remediation text, and summary. Assert Agent IDs, paths, and raw error details remain byte-for-byte unchanged.

- [ ] **Step 2: Run RED tests**

Run: `node --test tests/doctor-localization.test.mjs tests/agent-doctor.test.mjs`

Expected: FAIL because Doctor output is Chinese-only.

- [ ] **Step 3: Add locale-aware Doctor formatting**

Resolve the preference from stored settings plus system languages, then use the shared catalogs for all human-facing Doctor text. Keep machine-readable status IDs stable.

- [ ] **Step 4: Run GREEN tests**

Run: `node --test tests/doctor-localization.test.mjs tests/agent-doctor.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/doctor.mjs src/shared/agent-doctor.cjs src/locales tests/doctor-localization.test.mjs tests/agent-doctor.test.mjs
git commit -m "feat(i18n): localize Doctor output"
```

### Task 8: CI guard, contributor contract, and bundle metadata

**Files:**
- Create: `scripts/check-i18n.mjs`
- Create: `tests/i18n-source-guard.test.mjs`
- Modify: `package.json`
- Modify: `CONTRIBUTING.md`
- Create: `docs/I18N.md`

- [ ] **Step 1: Write failing catalog/source-guard tests**

Fixtures must prove the checker rejects:

```js
{ zh: { "sample.key": "中文" }, en: {} }                    // key mismatch
{ zh: { "sample.key": "共 {count} 项" }, en: { "sample.key": "Items" } } // placeholder mismatch
`el("button", "button", "保存")`                            // hardcoded Chinese UI
`button.textContent = "Save"`                                // hardcoded English UI
```

It must allow comments, logs, protocol IDs, commands, URLs, product names, and translated calls such as `t("common.save")`.

- [ ] **Step 2: Run RED test**

Run: `node --test tests/i18n-source-guard.test.mjs`

Expected: FAIL because the checker does not exist.

- [ ] **Step 3: Implement and integrate the checker**

Add `check:i18n` and run it before the broader source check:

```json
{
  "scripts": {
    "check:i18n": "node ./scripts/check-i18n.mjs",
    "check": "npm run build:renderer && npm run check:i18n && node ./scripts/check.mjs && node ./scripts/test-source.mjs && npm run test:unit"
  }
}
```

Scan explicit presentation file globs and known UI construction/assignment patterns after stripping comments. Report file, line, and literal for every violation.

- [ ] **Step 4: Document the contributor workflow**

`docs/I18N.md` must document locale policy, semantic key naming, interpolation, how to add a string, how to add a language, excluded verbatim data, and exact check commands. Link it from `CONTRIBUTING.md`.

Add macOS bundle metadata for `en`, `zh-Hans`, and English development fallback in `package.json`.

- [ ] **Step 5: Run GREEN tests and checker**

Run: `node --test tests/i18n-source-guard.test.mjs && npm run check:i18n`

Expected: PASS with equal key/placeholder sets and zero presentation violations.

- [ ] **Step 6: Commit**

```bash
git add scripts/check-i18n.mjs tests/i18n-source-guard.test.mjs package.json CONTRIBUTING.md docs/I18N.md
git commit -m "chore(i18n): enforce localization in CI"
```

### Task 9: Full verification, installed macOS acceptance, and PR

**Files:**
- Modify: no planned source files; if acceptance discovers a defect, first add a focused regression test beside the owning module, then change only that module and its two catalog entries.

- [ ] **Step 1: Run complete repository verification**

Run: `npm run check`

Expected: all source contracts and unit tests pass.

- [ ] **Step 2: Build and validate macOS artifact**

Run: `npm run package:mac`

Then run `hdiutil verify`, `codesign --verify --deep --strict`, inspect `Info.plist` localizations, and record the DMG SHA-256.

- [ ] **Step 3: Install without losing the current application**

Quit WorkIsland, move the existing `/Applications/WorkIsland.app` to a uniquely named backup, install the new packaged app with `ditto`, and confirm packaged/installed `app.asar` hashes match.

- [ ] **Step 4: Perform real interaction acceptance**

Verify system-following launch plus live `zh-CN → en → system` switching across Settings, Island, terminal, pet/onboarding, menus, dialogs, and a real notification. Record the PTY PID before and after switching language and confirm it is unchanged.

- [ ] **Step 5: Push and open the Issue #110 PR**

Push `codex/issue-110-i18n`, create a PR that links `Fixes #110`, lists the user-visible language rules and verification layers, then wait for CI. Do not merge without a separate user request.

- [ ] **Step 6: Verify remote delivery**

Fetch origin, inspect PR state/checks, verify the feature head exists on the remote branch, and report CI, installed runtime, notarization, and merge boundaries separately.
