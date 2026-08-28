import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureNodePtyHelperExecutable } from "../scripts/prepare-node-pty.mjs";

test("packaged app declares terminal runtime assets and native unpacking", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(typeof pkg.dependencies["node-pty"], "string");
  assert.equal(typeof pkg.dependencies["@xterm/xterm"], "string");
  assert.equal(pkg.build.asarUnpack.some((pattern) => pattern.includes("node-pty")), true);
  assert.equal(pkg.build.npmRebuild, false, "node-pty ships N-API prebuilds, so packaging must not require Visual Studio");
  assert.equal(pkg.scripts.postinstall, "node ./scripts/prepare-node-pty.mjs");
});

test("node-pty preparation restores the macOS spawn helper execute bit", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workisland-node-pty-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const helper = path.join(root, "node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper");
  mkdirSync(path.dirname(helper), { recursive: true });
  writeFileSync(helper, "helper");
  const changes = [];
  ensureNodePtyHelperExecutable(root, { platform: "darwin", arch: "arm64", chmod: (...args) => changes.push(args) });
  assert.deepEqual(changes, [[helper, 0o755]]);
});
