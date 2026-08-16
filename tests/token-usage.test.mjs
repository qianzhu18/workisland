import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "electron") {
    return { app: { getPath: () => path.join(os.tmpdir(), "workisland-token-userdata") } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { parseClaudeTokens } = require("../src/main/adapters-extended.cjs");
Module._load = originalLoad;

test("Claude token parsing ignores duplicate request usage records", async () => {
  const file = path.join(os.tmpdir(), `workisland-token-${process.pid}-${Date.now()}.jsonl`);
  const usage = (input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens) => ({
    type: "assistant",
    requestId: "req-1",
    message: {
      model: "claude-test",
      usage: { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens }
    }
  });
  fs.writeFileSync(file, [
    usage(2, 500, 1_000, 10),
    { ...usage(2, 500, 1_000, 10), uuid: "duplicate" },
    { ...usage(3, 700, 2_000, 20), requestId: "req-2" }
  ].map((record) => JSON.stringify(record)).join("\n") + "\n");
  try {
    assert.deepEqual(await parseClaudeTokens(file), {
      inputTokens: 5,
      outputTokens: 1_200,
      cacheReadTokens: 3_000,
      cacheCreationTokens: 30,
      totalTokens: 1_205,
      model: "claude-test",
      isEstimated: false
    });
  } finally {
    fs.unlinkSync(file);
  }
});
