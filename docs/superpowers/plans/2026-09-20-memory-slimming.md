# WorkIsland Memory Slimming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve all token-accounting behavior while removing whole-file transcript copies and concurrent startup backfill that cause 1–2 GB main-process peaks.

**Architecture:** Keep the existing parser and StatsService interfaces. Replace `readFile + split` inside the Codex and Claude parsers with Node `readline` over `fs.createReadStream`, then add an exported sequential backfill helper used by `AppCoordinator`. MCP, search, UI, and settings remain untouched.

**Tech Stack:** Node.js 22, CommonJS, `node:fs`, `node:readline`, Node test runner, Electron 43.

---

## File map

- Modify `tests/token-capture.test.mjs`: prove parsers return the same values without using `fs.promises.readFile`; cover malformed trailing records.
- Modify `src/main/adapters-extended.cjs`: stream Codex and Claude JSONL; add a small sequential startup-backfill helper.
- Modify `src/main/app-coordinator.cjs`: call the sequential helper instead of launching every collection concurrently.
- Modify `docs/perf/2026-09-19-performance-audit.md`: record final A/B only after packaged verification; do not include this untracked report in implementation commits unless explicitly requested.

### Task 1: Stream Codex and Claude transcripts

**Files:**
- Modify: `tests/token-capture.test.mjs:1-86`
- Modify: `src/main/adapters-extended.cjs:1-9,235-324`

- [ ] **Step 1: Write failing tests that forbid whole-file reads**

Add `fsPromises` and tests that temporarily replace `readFile` with a throwing function. The existing implementation catches that error and returns `null`, so both assertions fail for the intended reason.

```js
const fsPromises = require("node:fs/promises");

test("claude token parser streams JSONL without reading the whole file", async (t) => {
  const file = write("claude-streamed.jsonl", [
    { type: "assistant", requestId: "r1", message: { model: "claude-x", usage: { input_tokens: 12, output_tokens: 4 } } },
    "{ unfinished"
  ]);
  const originalReadFile = fsPromises.readFile;
  fsPromises.readFile = async () => { throw new Error("whole-file reads are forbidden"); };
  t.after(() => { fsPromises.readFile = originalReadFile; });

  const result = await parseClaudeTokens(file);
  assert.equal(result?.totalTokens, 16);
});

test("codex token parser streams JSONL without reading the whole file", async (t) => {
  const file = write("codex-streamed.jsonl", [
    { payload: { type: "thread_settings_applied", thread_settings: { model: "gpt-x" } } },
    { payload: { type: "token_count", info: { total_token_usage: { input_tokens: 30, cached_input_tokens: 10, output_tokens: 5 } } } },
    "{ unfinished"
  ]);
  const originalReadFile = fsPromises.readFile;
  fsPromises.readFile = async () => { throw new Error("whole-file reads are forbidden"); };
  t.after(() => { fsPromises.readFile = originalReadFile; });

  const result = await parseCodexTokens(file);
  assert.deepEqual(
    { input: result?.inputTokens, cacheRead: result?.cacheReadTokens, output: result?.outputTokens, model: result?.model },
    { input: 20, cacheRead: 10, output: 5, model: "gpt-x" }
  );
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test --test-name-pattern='streams JSONL' tests/token-capture.test.mjs
```

Expected: 2 failed assertions because both parsers return `null` after the injected `readFile` error.

- [ ] **Step 3: Implement the smallest streaming change**

Add:

```js
const readline = require("node:readline");

async function* readJsonLines(filePath) {
  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // A transcript may be observed while its final line is still being written.
    }
  }
}
```

In both parsers, move the accumulator declarations before the `try`, replace `readFile` and `content.split("\n")` with:

```js
try {
  for await (const item of readJsonLines(transcriptPath)) {
    // Keep the current usage/model accumulation unchanged.
  }
} catch (err) {
  log.warn("[codexTokens] stream failed for %s:", transcriptPath, err);
  return null;
}
```

Use the corresponding `claudeTokens` log prefix in the Claude parser. Do not alter the returned object or accounting rules.

- [ ] **Step 4: Verify GREEN and existing token behavior**

Run:

```bash
node --test tests/token-capture.test.mjs
```

Expected: all token-capture tests pass with no unhandled stream errors.

- [ ] **Step 5: Commit the parser change**

```bash
git add tests/token-capture.test.mjs src/main/adapters-extended.cjs
git commit -m "perf(tokens): stream transcript parsing"
```

### Task 2: Serialize startup token backfill

**Files:**
- Modify: `tests/token-capture.test.mjs:22-145`
- Modify: `src/main/adapters-extended.cjs:325-380,2555-2566`
- Modify: `src/main/app-coordinator.cjs:30,667-675`

- [ ] **Step 1: Write failing behavioral tests for the desired helper**

Import `runTokenBackfill` from `adapters-extended.cjs`. Add one test that records active collector count and one that makes the first collection reject.

```js
test("startup token backfill processes one transcript at a time", async () => {
  assert.equal(typeof runTokenBackfill, "function", "runTokenBackfill must be exported");
  let active = 0;
  let maxActive = 0;
  const order = [];
  const files = [
    { sessionId: "s1", path: "/tmp/one" },
    { sessionId: "s2", path: "/tmp/two" },
    { sessionId: "s3", path: "/tmp/three" }
  ];

  await runTokenBackfill(files, async (_tool, sessionId) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setImmediate(resolve));
    order.push(sessionId);
    active -= 1;
  });

  assert.equal(maxActive, 1);
  assert.deepEqual(order, ["s1", "s2", "s3"]);
});

test("startup token backfill continues after one transcript fails", async () => {
  const completed = [];
  const errors = [];
  await runTokenBackfill(
    [{ sessionId: "bad", path: "/tmp/bad" }, { sessionId: "good", path: "/tmp/good" }],
    async (_tool, sessionId) => {
      if (sessionId === "bad") throw new Error("broken transcript");
      completed.push(sessionId);
    },
    (error, file) => errors.push([error.message, file.sessionId])
  );
  assert.deepEqual(completed, ["good"]);
  assert.deepEqual(errors, [["broken transcript", "bad"]]);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test --test-name-pattern='startup token backfill' tests/token-capture.test.mjs
```

Expected: assertions fail because `runTokenBackfill` is not exported.

- [ ] **Step 3: Add the minimal sequential helper**

Add before `collectAndReportTokens`:

```js
async function runTokenBackfill(files, collect = collectAndReportTokens, onError = () => {}) {
  for (const file of files) {
    try {
      await collect("codex", file.sessionId, file.path);
    } catch (error) {
      onError(error, file);
    }
  }
}
```

Export `runTokenBackfill`, import it in `app-coordinator.cjs`, and replace the concurrent `for` loop with:

```js
void runTokenBackfill(tracked, collectAndReportTokens, (err) => {
  log.warn("[AppCoordinator] codex token backfill failed:", err?.message ?? err);
});
```

Keep the existing five-second delay and file-count log.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test tests/token-capture.test.mjs
```

Expected: all tests pass; maximum observed backfill concurrency is 1 and failure isolation is preserved.

- [ ] **Step 5: Commit the backfill change**

```bash
git add tests/token-capture.test.mjs src/main/adapters-extended.cjs src/main/app-coordinator.cjs
git commit -m "perf(tokens): serialize startup backfill"
```

### Task 3: Full verification and packaged A/B

**Files:**
- Read: `docs/superpowers/specs/2026-09-20-memory-slimming-design.md`
- Read: `docs/perf/2026-09-19-performance-audit.md`
- Generate locally: packaged preview under the repository release output; do not commit artifacts.

- [ ] **Step 1: Run repository validation**

```bash
npm run check
```

Expected: renderer build, source checks, i18n checks, and all unit tests pass.

- [ ] **Step 2: Run the isolated large-file benchmark**

Use the same local approximately 150 MB Codex transcript already measured. Run the parser in a fresh Node process and record peak RSS. Do not print, copy, or commit transcript contents.

Expected: token/model result matches the previous parser; peak RSS is at most 150 MiB, compared with the previous approximately 503 MiB.

- [ ] **Step 3: Package an arm64 preview**

```bash
npm run package:mac
```

If Electron download is unavailable but the matching local Electron exists, use the repository's established local Electron packaging fallback rather than changing dependencies.

Expected: signed arm64 app/DMG artifacts are produced and package checks pass.

- [ ] **Step 4: Install and measure the preview**

Install only after preserving the current `/Applications/WorkIsland.app`. Launch the preview with the same user data and capture main footprint at startup, 20 seconds, 60 seconds, and peak. Record desktop core and MCP separately.

Expected: token statistics remain correct; main peak targets at most 450 MB; search, Island UI, and MCP configuration are unchanged.

- [ ] **Step 5: Update evidence and decide merge readiness**

Add only measured A/B results to the performance report and Issue #185. If the peak target or any functional check fails, do not merge; retain the branch for further diagnosis.
