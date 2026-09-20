# MCP Lifecycle Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that WorkIsland MCP processes exit with their stdio clients and preserve every existing product-control tool.

**Architecture:** Extend the existing SDK-backed integration tests rather than changing the protocol. Exercise repeated `Client`/`StdioClientTransport` connect-close cycles, observe each spawned transport process, and modify the stdio entrypoint only if the test proves an orphan.

**Tech Stack:** Node.js test runner, MCP SDK v2, stdio transport, WorkIsland local socket protocol.

---

### Task 1: Add repeated lifecycle coverage

**Files:**
- Modify: `tests/workisland-mcp.test.mjs`

- [ ] **Step 1: Write the failing lifecycle test**

Expose the child PID from `StdioClientTransport` through its documented process handle when available, connect and close 50 clients sequentially, and wait up to two seconds for every observed PID to disappear. Keep one fake WorkIsland socket for the test and assert `listTools()` still returns `EXPECTED_TOOLS` before each close.

- [ ] **Step 2: Run the focused test**

Run: `node --test tests/workisland-mcp.test.mjs`

Expected: the new test either passes, proving no code change is needed, or fails with one or more living PIDs and supplies the evidence required for Task 2.

- [ ] **Step 3: Preserve or minimally repair the entrypoint**

If all children exit, leave `src/island/workisland-mcp/index.mjs` unchanged. If a child survives EOF, attach cleanup to the stdio transport close/end path and close the MCP server without adding an idle timeout or changing tools.

- [ ] **Step 4: Verify tool compatibility and lifecycle**

Run: `node --test tests/workisland-mcp.test.mjs tests/local-control-package.test.mjs tests/mcp-client-config.test.mjs`

Expected: all tests pass; tool names and configuration remain byte-for-byte compatible with the existing assertions.

- [ ] **Step 5: Record the measured outcome**

Add the count, exit result, elapsed range, and sampled RSS to `docs/perf/2026-09-19-performance-audit.md`. State explicitly whether product code changed.

- [ ] **Step 6: Commit**

```bash
git add tests/workisland-mcp.test.mjs src/island/workisland-mcp/index.mjs docs/perf/2026-09-19-performance-audit.md
git commit -m "test(mcp): verify client process cleanup"
```

