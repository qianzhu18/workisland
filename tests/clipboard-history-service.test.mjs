import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ClipboardHistoryService } from "../src/main/clipboard-history-service.cjs";

test("disabled clipboard history neither polls nor deletes stored entries", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workisland-clipboard-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let reads = 0;
  const adapter = {
    readSnapshot() { reads += 1; return { type: "text", text: "secret" }; },
    writeEntry() {}
  };
  const service = new ClipboardHistoryService({ storePath: path.join(root, "history.json"), clipboardAdapter: adapter, pollIntervalMs: 10 });
  await service.start();
  await service.captureNow();
  assert.equal(reads, 0);
  service.setEnabled(true);
  await service.captureNow();
  assert.equal(service.snapshot().items.length, 1);
  service.setEnabled(false);
  assert.equal(service.snapshot().items.length, 1);
  await service.clear();
  assert.equal(service.snapshot().items.length, 0);
  service.dispose();
});

test("replaying an entry writes through the adapter without duplicating history", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workisland-clipboard-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const writes = [];
  let capture = { type: "text", text: "hello" };
  const adapter = { readSnapshot: () => capture, writeEntry: (entry) => writes.push(entry) };
  const service = new ClipboardHistoryService({ storePath: path.join(root, "history.json"), clipboardAdapter: adapter });
  await service.start();
  service.setEnabled(true);
  await service.captureNow();
  const entry = service.snapshot().items[0];
  await service.replay(entry.id);
  await service.captureNow();
  assert.equal(writes.length, 1);
  assert.equal(service.snapshot().items.length, 1);
  service.dispose();
});
