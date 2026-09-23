# Token Collector Memory Storm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate duplicate concurrent token scans and bound Codex transcript watcher allocation without changing token totals or lifecycle behavior.

**Architecture:** Add a small keyed single-flight primitive and route `collectAndReportTokens` through it so duplicate work shares one Promise. Replace whole-increment allocation in `CodexTranscriptWatcher.readIncrement` with fixed-size byte chunks and a per-file incomplete-line buffer; keep the existing `processLine` state machine unchanged.

**Tech Stack:** Node.js CommonJS, Electron main process, `node:test`, macOS `footprint`/`vmmap`, electron-builder.

---

### Task 1: Keyed single-flight primitive

**Files:**
- Create: `src/main/keyed-single-flight.cjs`
- Create: `tests/keyed-single-flight.test.mjs`

- [ ] **Step 1: Write failing concurrency and cleanup tests**

```js
test("same-key callers share one in-flight task", async () => {
  const flight = new KeyedSingleFlight();
  let executions = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = Array.from({ length: 100 }, () => flight.run("codex:s1", async () => {
    executions += 1;
    await gate;
    return "done";
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(executions, 1);
  release();
  assert.deepEqual(await Promise.all(calls), Array(100).fill("done"));
});

test("different keys run independently and rejected tasks release their key", async () => {
  const flight = new KeyedSingleFlight();
  await assert.rejects(flight.run("codex:bad", async () => { throw new Error("boom"); }), /boom/);
  assert.equal(await flight.run("codex:bad", async () => "retry"), "retry");
  assert.deepEqual(await Promise.all([
    flight.run("codex:a", async () => "a"),
    flight.run("codex:b", async () => "b")
  ]), ["a", "b"]);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/keyed-single-flight.test.mjs`

Expected: FAIL because `src/main/keyed-single-flight.cjs` does not exist.

- [ ] **Step 3: Implement the minimal keyed scheduler**

```js
"use strict";

class KeyedSingleFlight {
  constructor() {
    this.inFlight = new Map();
  }

  has(key) {
    return this.inFlight.has(key);
  }

  run(key, task) {
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    let tracked;
    tracked = Promise.resolve()
      .then(task)
      .finally(() => {
        if (this.inFlight.get(key) === tracked) this.inFlight.delete(key);
      });
    this.inFlight.set(key, tracked);
    return tracked;
  }
}

module.exports = { KeyedSingleFlight };
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/keyed-single-flight.test.mjs`

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/keyed-single-flight.cjs tests/keyed-single-flight.test.mjs
git commit -m "perf: add keyed token collection single flight"
```

### Task 2: Coalesce real token collection requests

**Files:**
- Modify: `src/main/adapters-extended.cjs:140-390`
- Modify: `tests/token-capture.test.mjs`

- [ ] **Step 1: Add a failing integration regression**

Patch `fs.createReadStream` only to count real parser openings, create one valid Codex JSONL file, invoke `collectAndReportTokens("codex", sessionId, file)` 100 times in the same tick, await all calls, and assert `readCount === 1`. Restore the original function with `t.after`.

```js
test("100 concurrent collections of one session open its transcript once", async (t) => {
  const file = write("codex-single-flight.jsonl", [
    { payload: { type: "token_count", info: { total_token_usage: { input_tokens: 30, cached_input_tokens: 10, output_tokens: 5 } } } }
  ]);
  const fs = require("node:fs");
  const original = fs.createReadStream;
  let readCount = 0;
  fs.createReadStream = (...args) => {
    readCount += 1;
    return original(...args);
  };
  t.after(() => { fs.createReadStream = original; });
  const { collectAndReportTokens } = require("../src/main/adapters-extended.cjs");
  await Promise.all(Array.from({ length: 100 }, () =>
    collectAndReportTokens("codex", "single-flight-s1", file)
  ));
  assert.equal(readCount, 1);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-name-pattern='100 concurrent collections' tests/token-capture.test.mjs`

Expected: FAIL with `readCount` equal to 100.

- [ ] **Step 3: Route the public collector through single-flight**

Add one module-level scheduler and keep the existing body as `collectAndReportTokensOnce`:

```js
const { KeyedSingleFlight } = require("./keyed-single-flight.cjs");
const tokenCollectionFlights = new KeyedSingleFlight();

function collectAndReportTokens(tool, sessionId, transcriptPath) {
  const dedupeKey = `${tool}:${sessionId}`;
  if (tokenCollectionFlights.has(dedupeKey)) {
    log.debug("[TokenCollector] 合并进行中的采集 %s", dedupeKey);
  }
  return tokenCollectionFlights.run(dedupeKey, () =>
    collectAndReportTokensOnce(tool, sessionId, transcriptPath)
  );
}

async function collectAndReportTokensOnce(tool, sessionId, transcriptPath) {
  // This is the current collectAndReportTokens implementation renamed in
  // place; its try/catch, switch, baseline diff, report, and map cleanup
  // statements remain byte-for-byte unchanged.
}
```

The edit is deliberately limited to renaming the current function declaration to `collectAndReportTokensOnce` and adding the complete wrapper above it. No statement inside the renamed function changes.

- [ ] **Step 4: Verify focused and existing token tests**

Run: `node --test tests/keyed-single-flight.test.mjs tests/token-capture.test.mjs`

Expected: all tests pass; token totals, restart baseline, cache-only deltas, and serial backfill remain unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/main/adapters-extended.cjs tests/token-capture.test.mjs
git commit -m "perf: coalesce duplicate token scans"
```

### Task 3: Bound transcript watcher incremental allocation

**Files:**
- Modify: `src/main/codex-transcript-watcher.cjs:30-270`
- Create: `tests/codex-transcript-watcher.test.mjs`

- [ ] **Step 1: Write failing chunk, UTF-8, partial-line, and truncation tests**

Create a temporary JSONL file with lifecycle records containing Chinese text. Instantiate `new CodexTranscriptWatcher({ incrementChunkBytes: 17, fsModule: trackedFs })`, call `readIncrement(file)`, and assert:

```js
assert.ok(maxRequestedBytes <= 17);
assert.deepEqual(events.map(({ type }) => type), [
  "turnStarted", "sessionStarted", "sessionCompleted"
]);
assert.equal(events.find((event) => event.type === "sessionStarted").latestUserPrompt, "跨块中文消息");
assert.ok(file.pendingLineBytes.length > 0, "unfinished tail must be retained");
```

Append the remainder plus newline and assert it emits exactly once. Truncate and replace the file, then assert offset/carry reset and the new event is parsed.

- [ ] **Step 2: Run watcher tests and verify RED**

Run: `node --test tests/codex-transcript-watcher.test.mjs`

Expected: FAIL because the constructor ignores chunk options and `readIncrement` requests the complete increment.

- [ ] **Step 3: Implement fixed-size byte parsing**

Add constructor options without changing the default call site:

```js
const DEFAULT_INCREMENT_CHUNK_BYTES = 256 * 1024;

constructor(options = {}) {
  super();
  this.fs = options.fsModule || fs;
  this.incrementChunkBytes = Math.max(1, options.incrementChunkBytes || DEFAULT_INCREMENT_CHUNK_BYTES);
  // existing fields
}
```

In `readIncrement`, use `this.fs.statSync/openSync/readSync/closeSync`, reset `pendingLineBytes` on truncation, loop until the stat snapshot is consumed, combine only the current chunk with the previous incomplete line, split on newline byte `0x0a`, decode complete lines, and copy only the remaining tail:

```js
const readSize = Math.min(this.incrementChunkBytes, stat.size - position);
const chunk = Buffer.allocUnsafe(readSize);
const bytesRead = this.fs.readSync(fd, chunk, 0, readSize, position);
const incoming = chunk.subarray(0, bytesRead);
const combined = file.pendingLineBytes?.length
  ? Buffer.concat([file.pendingLineBytes, incoming])
  : incoming;
let lineStart = 0;
for (let newline = combined.indexOf(0x0a); newline >= 0; newline = combined.indexOf(0x0a, lineStart)) {
  const line = combined.subarray(lineStart, newline).toString("utf8").trim();
  if (line.startsWith("{")) this.processLine(file, line);
  lineStart = newline + 1;
}
file.pendingLineBytes = Buffer.from(combined.subarray(lineStart));
position += bytesRead;
file.lastReadSize = position;
```

- [ ] **Step 4: Run watcher and sound-policy tests**

Run: `node --test tests/codex-transcript-watcher.test.mjs tests/agent-sound-policy.test.mjs`

Expected: all tests pass and the existing lifecycle sound mapping remains unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/main/codex-transcript-watcher.cjs tests/codex-transcript-watcher.test.mjs
git commit -m "perf: stream transcript watcher increments"
```

### Task 4: Full verification, package stress, and report

**Files:**
- Modify: `docs/perf/2026-09-19-performance-audit.md`

- [ ] **Step 1: Run static and full tests**

Run: `npm ci --ignore-scripts && npm run postinstall && npm run check`

Expected: all source checks and unit tests pass with no new warnings.

- [ ] **Step 2: Build and verify the signed macOS preview**

Run: `npm run package:mac`

Expected: `.app` and DMG are produced, `codesign --verify --deep --strict release/mac-arm64/WorkIsland.app` passes, and `hdiutil verify release/WorkIsland-1.5.1-arm64.dmg` reports a valid checksum.

- [ ] **Step 3: Run the duplicate-event stress case against the packaged code**

Use the same 93 MB transcript shape and 100 concurrent same-session collection calls under Electron Node mode. Record parser-open count, duration, main-process `phys_footprint`, and peak. Expected: one transcript open, no duplicate token accounting, and no multi-GB peak.

- [ ] **Step 4: Verify packaged UI and capability smoke paths**

Launch the isolated preview without replacing `/Applications/WorkIsland.app`. Verify search input/clear, Settings and MCP page, media/lyrics, CLI help, and MCP 13-tool listing. Expected: no observed regression.

- [ ] **Step 5: Update the performance report with measured results**

Record process path, sample duration, main/process-group footprint, stress parameters, package validation, and remaining Electron baseline. Do not substitute RSS for footprint.

- [ ] **Step 6: Commit final evidence**

```bash
git add docs/perf/2026-09-19-performance-audit.md
git commit -m "docs(perf): record token storm verification"
```

- [ ] **Step 7: Review branch scope before any PR**

Run: `git diff --check && git status --short --branch && git log --oneline origin/main..HEAD`

Expected: only the design, plan, focused implementation/tests, and performance evidence are present. Do not merge unless footprint and functionality gates pass.
