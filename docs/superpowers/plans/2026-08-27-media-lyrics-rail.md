# Media Lyrics Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add privacy-aware synchronized lyrics below a visually refined, top-aligned media controller without weakening Agent monitoring or media controls.

**Architecture:** Keep playback discovery in `MediaService`, add a separate main-process `LyricsService` for LRCLIB lookup/cache/rate limiting, and expose a narrow read-only lyrics state through IPC. The renderer receives normalized lyric lines and renders them in a dedicated `LyricsPanel`; `MediaCard` becomes a vertical media rail whose controller stays at the top and whose lyrics use only genuinely available height.

**Tech Stack:** Electron 43, Node.js 22 built-in `fetch`, CommonJS main/shared services, authored React runtime components, CSS animations, Node test runner.

---

## File map

- Create `src/shared/lyrics-state.cjs`: bounded lyric payload, LRC parsing, signature normalization, conservative result matching, active-line selection.
- Create `src/main/lyrics-service.cjs`: sequential LRCLIB requests, cancellation, cache persistence, expiration, limit handling and state events.
- Create `src/renderer/island/components/LyricsPanel.js`: loading, synchronized, plain, instrumental and failure presentation.
- Modify `src/shared/settings.cjs` and `src/renderer/shared/settings.js`: `lyricsEnabled: false` privacy default.
- Modify `src/shared/ipc.cjs`, `src/preload/island.js`, `src/main/ipc-services.cjs`: narrow lyrics read/update/clear-cache contract.
- Modify `src/main/app-coordinator.cjs`: wire media snapshots into lyrics service and settings into enable/disable behavior.
- Modify `src/renderer/island/app.js` and `src/renderer/island/components/IslandPanel.js`: subscribe to lyrics state and pass it to media rendering.
- Modify `src/renderer/island/components/MediaCard.js` and `src/renderer/island/app.css`: top-aligned media controller, responsive lyric rail, refined motion and reduced-motion fallback.
- Modify `src/renderer/settings-app.js`: online-lyrics disclosure, explicit enable, clear-cache action.
- Create `tests/lyrics-state.test.mjs` and `tests/lyrics-service.test.mjs`; extend workstation/settings/renderer source-contract tests.

### Task 1: Define the bounded lyric state model

**Files:**
- Create: `src/shared/lyrics-state.cjs`
- Create: `tests/lyrics-state.test.mjs`

- [ ] **Step 1: Write failing parsing, matching and active-line tests**

```js
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  createTrackSignature,
  normalizeLyricsResponse,
  parseSyncedLyrics,
  selectActiveLyricIndex
} = require("../src/shared/lyrics-state.cjs");

test("track signatures normalize metadata without discarding CJK", () => {
  assert.deepEqual(createTrackSignature({
    title: " 七里香 (Live) ", artist: "周杰伦", album: "七里香", durationSec: 297.4
  }), { title: "七里香 (live)", artist: "周杰伦", album: "七里香", duration: 297 });
});

test("LRC parser sorts bounded timed lines", () => {
  assert.deepEqual(parseSyncedLyrics("[00:02.50]第二句\n[00:01.00]第一句"), [
    { atSec: 1, text: "第一句" },
    { atSec: 2.5, text: "第二句" }
  ]);
});

test("active lyric follows projected playback", () => {
  const lines = [{ atSec: 1, text: "A" }, { atSec: 4, text: "B" }];
  assert.equal(selectActiveLyricIndex(lines, 3.9), 0);
  assert.equal(selectActiveLyricIndex(lines, 4), 1);
});

test("candidate must match title artist and duration conservatively", () => {
  const result = normalizeLyricsResponse({ trackName: "七里香", artistName: "周杰伦", duration: 297, syncedLyrics: "[00:01]A" },
    { title: "七里香", artist: "周杰伦", album: "七里香", duration: 299 });
  assert.equal(result.status, "synced");
  assert.equal(normalizeLyricsResponse({ trackName: "七里香 (Live)", artistName: "周杰伦", duration: 330, plainLyrics: "wrong" },
    { title: "七里香", artist: "周杰伦", album: "七里香", duration: 299 }).status, "not-found");
});
```

- [ ] **Step 2: Run tests and verify the module is missing**

Run: `node --test tests/lyrics-state.test.mjs`

Expected: FAIL with `Cannot find module '../src/shared/lyrics-state.cjs'`.

- [ ] **Step 3: Implement the pure bounded model**

```js
"use strict";

const MAX_LINES = 600;
const MAX_LINE_LENGTH = 500;
const MAX_LYRICS_LENGTH = 200_000;
const EMPTY_LYRICS_STATE = Object.freeze({ status: "idle", signature: "", lines: [], plainText: "", updatedAt: 0 });

const clean = (value) => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
const comparable = (value) => clean(value).normalize("NFKC").toLocaleLowerCase();

function createTrackSignature(media = {}) {
  const title = comparable(media.title);
  const artist = comparable(media.artist);
  const album = comparable(media.album);
  const duration = Math.max(0, Math.round(Number(media.durationSec ?? media.duration) || 0));
  return { title, artist, album, duration };
}

function signatureKey(signature) {
  return [signature.title, signature.artist, signature.album, signature.duration].join("\u0000");
}

function parseSyncedLyrics(value) {
  if (typeof value !== "string" || value.length > MAX_LYRICS_LENGTH) return [];
  return value.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]\s*(.*)$/);
    if (!match || !match[3].trim()) return [];
    return [{ atSec: Number(match[1]) * 60 + Number(match[2]), text: match[3].trim().slice(0, MAX_LINE_LENGTH) }];
  }).slice(0, MAX_LINES).sort((a, b) => a.atSec - b.atSec);
}

function selectActiveLyricIndex(lines, elapsedSec) {
  let result = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].atSec > elapsedSec) break;
    result = index;
  }
  return result;
}

function normalizeLyricsResponse(payload = {}, wanted = {}) {
  const candidate = createTrackSignature({ title: payload.trackName, artist: payload.artistName, album: payload.albumName, duration: payload.duration });
  if (!wanted.title || !wanted.artist || comparable(wanted.title) !== candidate.title || comparable(wanted.artist) !== candidate.artist || Math.abs(Number(wanted.duration) - candidate.duration) > 3) {
    return { ...EMPTY_LYRICS_STATE, status: "not-found" };
  }
  if (payload.instrumental === true) return { ...EMPTY_LYRICS_STATE, status: "instrumental" };
  const lines = parseSyncedLyrics(payload.syncedLyrics);
  if (lines.length) return { status: "synced", signature: signatureKey(wanted), lines, plainText: "", updatedAt: Date.now() };
  const plainText = typeof payload.plainLyrics === "string" ? payload.plainLyrics.trim().slice(0, MAX_LYRICS_LENGTH) : "";
  return plainText ? { status: "plain", signature: signatureKey(wanted), lines: [], plainText, updatedAt: Date.now() } : { ...EMPTY_LYRICS_STATE, status: "not-found" };
}

module.exports = { EMPTY_LYRICS_STATE, createTrackSignature, normalizeLyricsResponse, parseSyncedLyrics, selectActiveLyricIndex, signatureKey };
```

- [ ] **Step 4: Run the focused tests**

Run: `node --test tests/lyrics-state.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the model**

```bash
git add src/shared/lyrics-state.cjs tests/lyrics-state.test.mjs
git commit -m "feat(media): define bounded synchronized lyric state"
```

### Task 2: Add cancellable LRCLIB lookup and local cache

**Files:**
- Create: `src/main/lyrics-service.cjs`
- Create: `tests/lyrics-service.test.mjs`

- [ ] **Step 1: Write failing service tests with an injected fetch and clock**

```js
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LyricsService } from "../src/main/lyrics-service.cjs";

const media = { active: true, title: "The Chain", artist: "Fleetwood Mac", album: "Rumours", durationSec: 271 };

test("service queries once then reuses its disk cache", async () => {
  let calls = 0;
  const storePath = join(mkdtempSync(join(tmpdir(), "lyrics-")), "cache.json");
  const service = new LyricsService({ storePath, fetchImpl: async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({ trackName: "The Chain", artistName: "Fleetwood Mac", albumName: "Rumours", duration: 271, syncedLyrics: "[00:01]Listen" }) };
  }});
  service.setEnabled(true);
  await service.setTrack(media);
  await service.setTrack(media);
  assert.equal(calls, 1);
  assert.equal(service.snapshot().status, "synced");
  assert.doesNotThrow(() => JSON.parse(readFileSync(storePath, "utf8")));
});

test("stale lookup cannot overwrite a newer track", async () => {
  const resolvers = [];
  const service = new LyricsService({ storePath: join(mkdtempSync(join(tmpdir(), "lyrics-")), "cache.json"), fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    resolvers.push(resolve);
  }) });
  service.setEnabled(true);
  const first = service.setTrack(media);
  const second = service.setTrack({ ...media, title: "Dreams" });
  resolvers[1]({ ok: false, status: 404, json: async () => ({}) });
  await Promise.allSettled([first, second]);
  assert.match(service.snapshot().signature, /dreams/);
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `node --test tests/lyrics-service.test.mjs`

Expected: FAIL because `LyricsService` does not exist.

- [ ] **Step 3: Implement `LyricsService`**

Implement an `EventEmitter` service with this public contract:

```js
class LyricsService extends EventEmitter {
  constructor({ storePath, fetchImpl = globalThis.fetch, now = () => Date.now(), requestTimeoutMs = 3500 } = {})
  setEnabled(enabled)
  async setTrack(mediaSnapshot)
  snapshot()
  clearCache()
  dispose()
}
```

The implementation must wait until at least 300ms after the previous outbound request, then request:

```js
const endpoint = new URL("https://lrclib.net/api/get");
endpoint.searchParams.set("track_name", signature.title);
endpoint.searchParams.set("artist_name", signature.artist);
endpoint.searchParams.set("album_name", signature.album);
endpoint.searchParams.set("duration", String(signature.duration));

const response = await fetchImpl(endpoint, {
  signal: controller.signal,
  headers: { "User-Agent": "WorkIsland/3.0.0 (https://github.com/qianzhu18/workisland)" }
});
```

- abort the previous controller on signature change;
- reject tracks without title, artist or positive duration;
- read `response.text()`, reject it before `JSON.parse()` when it exceeds 256KB, then apply the lyric normalization limits from Task 1;
- use `/api/search` once only after a 404, select only a single conservative candidate through `normalizeLyricsResponse`;
- persist at most 500 cache entries with positive TTL 30 days and `not-found` TTL 24 hours;
- never cache `unavailable` network errors;
- use an atomic temporary-file rename for cache writes;
- treat 429 as unavailable and respect bounded `Retry-After` before the next request;
- emit `update` for `loading`, terminal states, cached states and disable/clear operations;
- never log lyric text or track metadata.

- [ ] **Step 4: Add cache expiry, 404, 429, timeout and size-limit tests**

Add tests asserting:

```js
assert.equal(service.snapshot().status, "not-found");
assert.equal(fetchCallsAfterCachedMiss, fetchCallsBeforeCachedMiss);
assert.equal(service.snapshot().status, "unavailable");
assert.equal(JSON.parse(readFileSync(storePath, "utf8")).entries.length <= 500, true);
```

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/lyrics-state.test.mjs tests/lyrics-service.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit the service**

```bash
git add src/main/lyrics-service.cjs src/shared/lyrics-state.cjs tests/lyrics-service.test.mjs tests/lyrics-state.test.mjs
git commit -m "feat(media): fetch and cache synchronized lyrics"
```

### Task 3: Wire privacy settings and narrow IPC

**Files:**
- Modify: `src/shared/settings.cjs`
- Modify: `src/renderer/shared/settings.js`
- Modify: `src/shared/ipc.cjs`
- Modify: `src/preload/island.js`
- Modify: `src/main/ipc-services.cjs`
- Modify: `src/main/app-coordinator.cjs`
- Modify: `src/renderer/settings-app.js`
- Test: `tests/settings-workstation.test.mjs`
- Test: `tests/settings-ui.test.mjs`
- Test: `tests/workstation-ipc.test.mjs`

- [ ] **Step 1: Write failing setting and IPC contract tests**

```js
assert.equal(settings.DEFAULT_SETTINGS.lyricsEnabled, false);
for (const key of ["LYRICS_GET_STATE", "LYRICS_STATE_UPDATE", "LYRICS_CLEAR_CACHE"]) assert.equal(typeof IPC[key], "string");
for (const method of ["getLyricsState", "onLyricsStateUpdate", "clearLyricsCache"]) assert.match(preloadSource, new RegExp(`${method}\\(`));
assert.match(settingsSource, /在线歌词/);
assert.match(settingsSource, /LRCLIB/);
assert.match(settingsSource, /歌曲名称、歌手、专辑和时长/);
assert.match(settingsSource, /清除歌词缓存/);
```

- [ ] **Step 2: Run tests and verify missing contracts**

Run: `node --test tests/settings-workstation.test.mjs tests/settings-ui.test.mjs tests/workstation-ipc.test.mjs`

Expected: FAIL on `lyricsEnabled` and missing IPC names.

- [ ] **Step 3: Add the setting and IPC names**

Add `lyricsEnabled: false` to both default setting definitions and normalize it as a Boolean in shared settings. Add:

```js
LYRICS_GET_STATE: "lyrics:get-state",
LYRICS_STATE_UPDATE: "lyrics:state-update",
LYRICS_CLEAR_CACHE: "lyrics:clear-cache",
```

- [ ] **Step 4: Instantiate and connect `LyricsService` in the coordinator**

Use `path.join(userDataPath, "lyrics-cache.json")`. On every media update:

```js
this.mediaService.on("update", (state) => {
  this.broadcastWorkstationState(IPC.MEDIA_STATE_UPDATE, state);
  void this.lyricsService.setTrack(state);
});
this.lyricsService.on("update", (state) => this.broadcastWorkstationState(IPC.LYRICS_STATE_UPDATE, state));
```

Enable only when both media and lyrics settings allow it:

```js
this.lyricsService.setEnabled(this.settings.mediaEnabled !== false && this.settings.lyricsEnabled === true);
```

Disabling lyrics aborts lookup and clears only current rendered lyrics, not the disk cache. App shutdown calls `dispose()`.

- [ ] **Step 5: Expose narrow handlers and preload methods**

```js
electron.ipcMain.handle(IPC.LYRICS_GET_STATE, () => coordinator.getLyricsState());
electron.ipcMain.handle(IPC.LYRICS_CLEAR_CACHE, () => coordinator.clearLyricsCache());
```

The preload exposes invocation and a tracked update listener; it never exposes arbitrary URLs, lyrics request parameters or cache file paths.

- [ ] **Step 6: Add the settings disclosure**

Inside media detailed settings render:

```js
row("在线歌词", "开启后会把歌曲名称、歌手、专辑和时长发送给 LRCLIB，用于匹配歌词；结果缓存在本机。", toggle(
  state.settings.lyricsEnabled,
  value => save({ lyricsEnabled: value }),
  "在线歌词"
)),
row("歌词缓存", "清除已缓存在本机的歌词，不影响媒体播放。", button("清除歌词缓存", async () => {
  await api.clearLyricsCache();
  showToast("歌词缓存已清除");
}))
```

Add the corresponding narrow settings preload method rather than reusing Island-only APIs.

- [ ] **Step 7: Run focused tests and commit**

Run: `node --test tests/settings-workstation.test.mjs tests/settings-ui.test.mjs tests/workstation-ipc.test.mjs tests/lyrics-service.test.mjs`

Expected: PASS.

```bash
git add src/shared/settings.cjs src/renderer/shared/settings.js src/shared/ipc.cjs src/preload/island.js src/preload/settings.js src/main/ipc-services.cjs src/main/app-coordinator.cjs src/renderer/settings-app.js tests/settings-workstation.test.mjs tests/settings-ui.test.mjs tests/workstation-ipc.test.mjs
git commit -m "feat(media): expose privacy-aware online lyrics"
```

### Task 4: Render synchronized and fallback lyrics

**Files:**
- Create: `src/renderer/island/components/LyricsPanel.js`
- Modify: `src/renderer/island/app.js`
- Modify: `src/renderer/island/components/IslandPanel.js`
- Modify: `src/renderer/island/components/MediaCard.js`
- Test: `tests/workstation-ipc.test.mjs`
- Test: `tests/renderer-syntax.test.mjs`

- [ ] **Step 1: Write failing renderer source contracts**

```js
assert.match(appSource, /getLyricsState/);
assert.match(appSource, /onLyricsStateUpdate/);
assert.match(panelSource, /lyricsState/);
assert.match(mediaCardSource, /LyricsPanel/);
assert.match(lyricsPanelSource, /selectActiveLyricIndex/);
for (const copy of ["正在匹配歌词", "纯音乐", "暂未匹配到歌词", "歌词暂不可用"]) {
  assert.match(lyricsPanelSource, new RegExp(copy));
}
```

- [ ] **Step 2: Run renderer tests and verify failure**

Run: `node --test tests/workstation-ipc.test.mjs tests/renderer-syntax.test.mjs`

Expected: FAIL because `LyricsPanel.js` and subscriptions do not exist.

- [ ] **Step 3: Subscribe once in `app.js` and pass state down**

Initialize from `{ status: "idle", signature: "", lines: [], plainText: "" }`, fetch once, subscribe once, and pass `lyricsState` through `IslandPanel` to `MediaCard`. Do not couple lyrics state to Agent sessions.

- [ ] **Step 4: Implement `LyricsPanel`**

Use the same projected elapsed time calculated by `MediaCard`. The component contract is:

```js
export function LyricsPanel({ lyrics, elapsedSec, roomy })
```

For synchronized lyrics:

```js
const activeIndex = selectActiveLyricIndex(lyrics.lines, elapsedSec);
React.useEffect(() => {
  if (!following || activeIndex < 0) return;
  lineRefs.current[activeIndex]?.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
}, [activeIndex, following, reducedMotion]);
```

Manual wheel/touch scrolling sets `following` false and restores it after 4 seconds. Render plain lyrics as bounded paragraphs without fake highlighting. When `roomy` is false, render nothing so a short one-Agent panel retains the compact controller.

- [ ] **Step 5: Run renderer tests and commit**

Run: `node --test tests/lyrics-state.test.mjs tests/workstation-ipc.test.mjs tests/renderer-syntax.test.mjs`

Expected: PASS.

```bash
git add src/renderer/island/app.js src/renderer/island/components/IslandPanel.js src/renderer/island/components/MediaCard.js src/renderer/island/components/LyricsPanel.js tests/workstation-ipc.test.mjs tests/renderer-syntax.test.mjs
git commit -m "feat(media): render synchronized lyrics with playback"
```

### Task 5: Refine the media rail visual system

**Files:**
- Modify: `src/renderer/island/components/MediaCard.js`
- Modify: `src/renderer/island/components/LyricsPanel.js`
- Modify: `src/renderer/island/app.css`
- Test: `tests/workstation-ipc.test.mjs`

- [ ] **Step 1: Add failing structural and reduced-motion assertions**

```js
assert.match(mediaCardSource, /media-player/);
assert.match(mediaCardSource, /media-rail/);
assert.match(css, /\.media-rail[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\)/s);
assert.match(css, /\.media-player[^}]*align-self:\s*start/s);
assert.match(css, /\.lyrics-panel[^}]*mask-image/s);
assert.match(css, /prefers-reduced-motion[\s\S]*lyrics-line/s);
```

- [ ] **Step 2: Run the contract test and verify failure**

Run: `node --test tests/workstation-ipc.test.mjs`

Expected: FAIL on missing refined media rail selectors.

- [ ] **Step 3: Split the card into a top controller and lyric region**

Render:

```js
<section className="media-rail">
  <div className="media-player">…existing artwork, copy, progress and controls…</div>
  <LyricsPanel lyrics={lyrics} elapsedSec={elapsed} roomy={roomy} />
</section>
```

Use a `ResizeObserver` on the rail and set `roomy` only when its measured height is at least 310px. This responds to real panel height instead of guessing from Agent count.

- [ ] **Step 4: Implement the independent polished visual language**

Required CSS behavior:

```css
.media-rail {
  position: relative;
  width: 300px;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  background: radial-gradient(140% 80% at 18% 0%, rgba(125,145,220,.18), transparent 58%);
}
.media-player {
  align-self: start;
  display: grid;
  grid-template-columns: 88px minmax(0,1fr);
  grid-template-areas: "art copy" "art progress" "art controls";
  gap: 7px 14px;
  padding: 16px 18px 14px 20px;
}
.lyrics-panel {
  min-height: 0;
  overflow-y: auto;
  padding: 14px 22px 22px;
  mask-image: linear-gradient(to bottom, transparent 0, #000 18px, #000 calc(100% - 26px), transparent 100%);
}
.lyrics-line {
  margin: 0 0 12px;
  color: rgba(255,255,255,.28);
  font-size: 12px;
  line-height: 1.55;
  transform-origin: left center;
  transition: color 260ms ease, transform 360ms cubic-bezier(.22,1,.36,1), opacity 260ms ease;
}
.lyrics-line.is-active {
  color: rgba(255,255,255,.96);
  font-size: 14px;
  font-weight: 650;
  transform: translateX(2px);
  text-shadow: 0 6px 22px rgba(130,155,255,.22);
}
```

Keep artwork breathing subtle; do not rotate continuously. Paused media reduces saturation and stops active-line advancement. Source icon, focus states and progress thumb remain accessible. The implementation is visually inspired by premium notch utilities but does not copy Atoll code or assets.

- [ ] **Step 5: Add reduced-motion behavior**

Under `prefers-reduced-motion: reduce`, disable lyric smooth scrolling, artwork breathing, line transforms and entry motion while retaining state contrast.

- [ ] **Step 6: Run focused tests and commit**

Run: `node --test tests/workstation-ipc.test.mjs tests/renderer-syntax.test.mjs tests/workstation-model.test.mjs`

Expected: PASS.

```bash
git add src/renderer/island/components/MediaCard.js src/renderer/island/components/LyricsPanel.js src/renderer/island/app.css tests/workstation-ipc.test.mjs
git commit -m "feat(media): polish the adaptive media lyrics rail"
```

### Task 6: Full verification and local acceptance build

**Files:**
- Modify only if tests expose a defect in the files listed above.

- [ ] **Step 1: Run whitespace and complete source checks**

Run:

```bash
git diff --check
npm run check
```

Expected: no whitespace errors; all source contracts and unit tests pass.

- [ ] **Step 2: Build the Apple Silicon package**

Run: `npm run package:mac`

Expected: `release/mac-arm64/WorkIsland.app` and `release/WorkIsland-3.0.0-arm64.dmg` are created; local packaging may skip notarization.

- [ ] **Step 3: Install safely for the owner’s test**

Quit the running app, move the existing `/Applications/WorkIsland.app` to a timestamped temporary backup, copy the newly built app into `/Applications`, verify with `codesign --verify --deep --strict`, then launch it. If copying or verification fails, restore the backup.

- [ ] **Step 4: Perform real UI acceptance**

Verify with Apple Music and 网易云音乐:

1. With online lyrics disabled, no LRCLIB request occurs and media control looks polished.
2. Enable online lyrics in Settings and confirm the disclosure is visible.
3. One short Agent row keeps the media controller compact without forced lyrics.
4. Multiple Agent rows make the rail taller and reveal lyrics below the fixed controller.
5. Synced lyrics highlight and scroll; pause freezes advancement; seek repositions it; manual scroll pauses following for four seconds.
6. Switching tracks immediately removes stale lyrics; returning to a cached track is immediate.
7. No-match and offline states do not break play/pause, previous, next, Agent approval or tool navigation.

- [ ] **Step 5: Report, do not merge**

Report the installed app path, exact test totals, cache/privacy behavior and any remaining limitations. Do not push, open a PR or merge until the owner visually accepts the result.
