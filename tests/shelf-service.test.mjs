import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ShelfService } from "../src/main/shelf-service.cjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "workisland-shelf-"));
  return { root, storePath: path.join(root, "shelf.json") };
}

test("removing a shelf item never deletes its source", async (t) => {
  const { root, storePath } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "report.txt");
  await writeFile(source, "keep");
  const service = new ShelfService({ storePath });
  await service.start();
  const [item] = await service.addPaths([source]);
  await service.remove([item.id]);
  assert.equal(await readFile(source, "utf8"), "keep");
  assert.equal(service.snapshot().items.length, 0);
});

test("shelf deduplicates canonical paths and marks missing files", async (t) => {
  const { root, storePath } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "one.txt");
  await writeFile(source, "one");
  const service = new ShelfService({ storePath });
  await service.start();
  const items = await service.addPaths([source, source]);
  assert.equal(items.length, 1);
  await unlink(source);
  const refreshed = await service.refreshAvailability();
  assert.equal(refreshed.items[0].available, false);
});

test("corrupt shelf storage is quarantined instead of crashing startup", async (t) => {
  const { root, storePath } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(storePath, "not-json");
  const service = new ShelfService({ storePath });
  await service.start();
  assert.deepEqual(service.snapshot().items, []);
  const names = await import("node:fs/promises").then(({ readdir }) => readdir(root));
  assert.equal(names.some((name) => name.startsWith("shelf.json.corrupt-")), true);
});
