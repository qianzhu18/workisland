# Adaptive Background Sampling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce hidden WorkIsland performance sampling from every 2 seconds to every 10 seconds while retaining immediate, 2-second updates when details are visible.

**Architecture:** Keep sampling logic unchanged and centralize timer scheduling inside `PerformanceService`. Inject timer functions for deterministic unit tests, and reschedule only when enabled, started, or detail visibility changes.

**Tech Stack:** Node.js, EventEmitter, injected timers, Node.js test runner.

---

### Task 1: Define adaptive scheduling behavior

**Files:**
- Modify: `tests/performance-service.test.mjs`
- Modify: `src/main/performance-service.cjs`

- [ ] **Step 1: Write failing timer tests**

Construct the service with `intervalMs: 2_000`, `backgroundIntervalMs: 10_000`, and injected `setIntervalFn`/`clearIntervalFn`. Assert start schedules 10,000 ms, `setDetailsVisible(true)` clears it, samples immediately, and schedules 2,000 ms; hiding clears it and schedules 10,000 ms. Assert stop leaves no timer.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test tests/performance-service.test.mjs`

Expected: FAIL because `backgroundIntervalMs`, injected timers, and adaptive rescheduling are not implemented.

- [ ] **Step 3: Implement one-timer adaptive scheduling**

Add constructor inputs `backgroundIntervalMs = 10_000`, `setIntervalFn = setInterval`, and `clearIntervalFn = clearInterval`. Store the started state separately from the timer. Add a scheduling helper that clears the previous timer and selects `detailsVisible ? intervalMs : backgroundIntervalMs`. `setDetailsVisible(true)` must request an immediate sample before rescheduling.

- [ ] **Step 4: Run performance tests**

Run: `node --test tests/performance-service.test.mjs tests/performance-process-model.test.mjs`

Expected: all tests pass and existing process-detail sampling semantics remain unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/main/performance-service.cjs tests/performance-service.test.mjs
git commit -m "perf: reduce hidden performance sampling"
```

### Task 2: Measure idle and visible behavior

**Files:**
- Modify: `docs/perf/2026-09-19-performance-audit.md`

- [ ] **Step 1: Build and launch the arm64 preview**

Run: `npm run package:mac`

Expected: signed `release/mac-arm64/WorkIsland.app` and DMG are created.

- [ ] **Step 2: Capture comparable CPU samples**

Run the existing performance benchmark for five minutes with the Island hidden, then with the performance detail visible. Record CPU median/P95 and confirm visible metrics refresh at two-second cadence.

- [ ] **Step 3: Record results and commit**

```bash
git add docs/perf/2026-09-19-performance-audit.md
git commit -m "docs(perf): record adaptive sampling results"
```

