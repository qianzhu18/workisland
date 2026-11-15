import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir, access } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const {
  ALMA_EVENTS,
  installAlmaHooks,
  uninstallAlmaHooks,
  checkAlmaHooks,
  getAlmaHooksPath
} = require("../src/main/alma-hooks.cjs");

const command = "node '/app/src/island/hooks-cli/index.cjs' --source alma";

async function fixture(fn) {
  const home = await mkdtemp(join(tmpdir(), "wi-alma-"));
  try {
    await fn(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test("Alma hook install is idempotent and keeps user rules", () => fixture(async (home) => {
  const configPath = getAlmaHooksPath(home);
  await mkdir(join(home, ".config", "alma"), { recursive: true });
  await writeFile(configPath, JSON.stringify({
    hooks: {
      "chat.message.willSend": [{ matcher: "secret", hooks: [{ type: "command", command: "echo keep" }] }]
    },
    note: "user"
  }));
  await installAlmaHooks({ homeDir: home, hookCommand: command });
  await installAlmaHooks({ homeDir: home, hookCommand: command });
  const doc = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(doc.note, "user");
  assert.deepEqual(Object.keys(doc.hooks).sort(), [...ALMA_EVENTS].sort());
  const promptGroups = doc.hooks["chat.message.willSend"];
  assert.equal(promptGroups[0].hooks[0].command, "echo keep");
  assert.equal(promptGroups.filter((group) => group.hooks.some((hook) => hook.command === command)).length, 1);
  assert.deepEqual(await checkAlmaHooks({ homeDir: home, hookCommand: command }), { configPath, issues: [] });
}));

test("Alma hook install refuses a malformed hooks section", () => fixture(async (home) => {
  const configPath = getAlmaHooksPath(home);
  await mkdir(join(home, ".config", "alma"), { recursive: true });
  await writeFile(configPath, "{\"hooks\":[]}\n");
  await assert.rejects(installAlmaHooks({ homeDir: home, hookCommand: command }));
  assert.equal(await readFile(configPath, "utf8"), "{\"hooks\":[]}\n");
}));

test("Alma hook uninstall removes only WorkIsland commands", () => fixture(async (home) => {
  await installAlmaHooks({ homeDir: home, hookCommand: command });
  const configPath = getAlmaHooksPath(home);
  const doc = JSON.parse(await readFile(configPath, "utf8"));
  doc.hooks["tool.willExecute"][0].hooks.push({ type: "command", command: "echo user" });
  await writeFile(configPath, JSON.stringify(doc));
  await uninstallAlmaHooks(home);
  const remaining = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(remaining.hooks["tool.willExecute"][0].hooks, [{ type: "command", command: "echo user" }]);
  assert.equal(remaining.hooks["thread.created"], undefined);
}));

test("Alma hook uninstall deletes a file that only contained WorkIsland rules", () => fixture(async (home) => {
  await installAlmaHooks({ homeDir: home, hookCommand: command });
  await uninstallAlmaHooks(home);
  await assert.rejects(access(getAlmaHooksPath(home)));
}));

test("stale Alma commands are reported", () => fixture(async (home) => {
  await installAlmaHooks({ homeDir: home, hookCommand: command });
  const health = await checkAlmaHooks({ homeDir: home, hookCommand: `${command} --stale` });
  assert.ok(health.issues.some((issue) => /Stale command/.test(issue)));
}));
