import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
let createSerializedJsonUpdater;
try {
  ({ createSerializedJsonUpdater } = require("../src/main/serialized-json-updater.cjs"));
} catch {}

test("DSH verification config remains valid during concurrent event updates", async () => {
  assert.equal(typeof createSerializedJsonUpdater, "function", "serialized JSON updater must exist");
  const dir = await mkdtemp(join(tmpdir(), "workisland-dsh-config-"));
  const configPath = join(dir, "bridge.json");
  await writeFile(configPath, JSON.stringify({ command: "flux-hooks --source dsh", profiles: [{ name: "dev" }] }, null, 2) + "\n");

  const update = createSerializedJsonUpdater(configPath);
  await Promise.all([
    update((current) => ({ ...current, lastVerifiedAt: "2026-08-20T10:20:53.983Z", lastVerifiedEvent: "jumpTargetUpdated" })),
    update((current) => ({ ...current, lastVerifiedAt: "2026-08-20T10:20:53.984Z", lastVerifiedEvent: "sessionStarted" }))
  ]);

  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw);
  assert.equal(parsed.command, "flux-hooks --source dsh");
  assert.deepEqual(parsed.profiles, [{ name: "dev" }]);
  assert.equal(parsed.lastVerifiedEvent, "sessionStarted");
});

test("DSH reinstall preserves verification only for the same discovered profiles", () => {
  const managerSource = readFileSync(new URL("../src/main/hooks-custom.cjs", import.meta.url), "utf8");
  const helperSource = readFileSync(new URL("../src/shared/dsh-auto-connect.cjs", import.meta.url), "utf8");
  // 配置拼装收敛到纯函数里（可单测），manager 只负责读写 profile。
  assert.match(managerSource, /buildDshBridgeConfig\(/);
  assert.match(helperSource, /profileDirs = \(profiles \|\| \[\]\)/);
  assert.match(helperSource, /preservesVerification = JSON\.stringify\(profileDirs\) === JSON\.stringify\(existingDirs\)/);
  assert.match(helperSource, /preservesVerification && existing\?\.lastVerifiedAt/);
  assert.match(managerSource, /if \(!options\.preserveVerification\)[\s\S]*unlink\(this\.configPath\)/);
});
