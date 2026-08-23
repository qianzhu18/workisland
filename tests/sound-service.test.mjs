import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createSoundService, SOUND_FILES } = require("../src/main/sound-service.cjs");
const { mergeSettings } = require("../src/shared/settings.cjs");

function makeService() {
  const root = mkdtempSync(join(tmpdir(), "workisland-sound-"));
  const userDir = join(root, "user-data");
  const calls = [];
  const service = createSoundService({
    electronApi: {
      app: {
        isPackaged: false,
        getAppPath: () => resolve("."),
        getPath: () => userDir
      }
    },
    platform: "darwin",
    execFile: (command, args, options, callback) => {
      calls.push({ command, args, options });
      callback?.(null);
    }
  });
  return { calls, service, userDir };
}

function makeWindowsService() {
  const fixture = makeService();
  const calls = [];
  const service = createSoundService({
    electronApi: {
      app: {
        isPackaged: false,
        getAppPath: () => resolve("."),
        getPath: () => fixture.userDir
      }
    },
    platform: "win32",
    execFile: (command, args, options, callback) => {
      calls.push({ command, args, options });
      callback?.(null);
    }
  });
  return { calls, service };
}

test("sound playback uses bundled assets, clamped volume, and canonical afplay args", () => {
  const { calls, service } = makeService();
  service.initSoundDirs();
  assert.equal(service.playSoundEvent("taskComplete", { sound: { enabled: true, volume: 75 } }), true);
  assert.deepEqual(calls[0].args, ["-v", "0.75", join(service.getUserSoundsDir(), SOUND_FILES.taskComplete)]);
  assert.equal(calls[0].command, "afplay");
});

test("sound playback respects disabled events and rejects unknown preview paths", () => {
  const { calls, service } = makeService();
  assert.equal(service.playSoundEvent("taskComplete", { sound: { enabled: false } }), false);
  assert.equal(service.playSoundEvent("taskComplete", { sound: { enabled: true, events: { taskComplete: { enabled: false } } } }), false);
  assert.equal(service.previewSound("../task_complete.wav", 50), true);
  assert.equal(service.previewSound("../../private.wav", 50), false);
  assert.equal(calls.length, 1);
});

test("Windows sound playback uses the built-in hidden PowerShell player", () => {
  const { calls, service } = makeWindowsService();
  service.initSoundDirs();
  assert.equal(service.playSoundEvent("taskComplete", { sound: { enabled: true, volume: 75 } }), true);
  assert.equal(calls[0].command, "powershell.exe");
  assert.deepEqual(calls[0].args.slice(0, 4), ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden"]);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[0].options.env.WORKISLAND_SOUND_FILE, service.resolveSoundFile(SOUND_FILES.taskComplete));
});

test("partial persisted sound settings retain every default event", () => {
  const merged = mergeSettings({ sound: { events: { taskComplete: { enabled: false } } } });
  assert.equal(merged.sound.events.taskComplete.enabled, false);
  assert.equal(merged.sound.events.sessionStart.enabled, true);
  assert.equal(merged.sound.events.approvalNeeded.enabled, true);
});

test("completion notifications default to ten seconds when no user value exists", () => {
  assert.equal(mergeSettings({}).completionPopupDurationSec, 10);
});
