import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function createClock() {
  let now = 0;
  let nextId = 0;
  const tasks = new Map();
  return {
    now: () => now,
    setTimer(fn, delay) {
      const id = ++nextId;
      tasks.set(id, { at: now + delay, fn });
      return id;
    },
    clearTimer(id) {
      tasks.delete(id);
    },
    advance(ms) {
      now += ms;
      let due;
      do {
        due = [...tasks.entries()].filter(([, task]) => task.at <= now).sort((a, b) => a[1].at - b[1].at);
        for (const [id, task] of due) {
          tasks.delete(id);
          task.fn();
        }
      } while (due.length > 0);
    }
  };
}

test("same-client settings changes are grouped into one five-second notice", () => {
  const { SettingsChangePresenter } = require("../src/main/settings-change-presenter.cjs");
  const clock = createClock();
  const shown = [];
  const presenter = new SettingsChangePresenter({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    hasAttention: () => false,
    present: (surface) => shown.push(surface)
  });

  presenter.enqueue({ changeId: "one", client: "Codex", changes: [{ key: "mediaEnabled", oldValue: true, newValue: false }] });
  clock.advance(500);
  presenter.enqueue({ changeId: "two", client: "Codex", changes: [{ key: "lyricsEnabled", oldValue: true, newValue: false }] });
  clock.advance(999);
  assert.equal(shown.length, 0);
  clock.advance(1);

  assert.equal(shown.length, 1);
  assert.deepEqual(shown[0].changeIds, ["one", "two"]);
  assert.equal(shown[0].changes.length, 2);
  assert.equal(shown[0].autoDismissMs, 5_000);
});

test("settings notices wait behind attention and expire instead of interrupting", () => {
  const { SettingsChangePresenter } = require("../src/main/settings-change-presenter.cjs");
  const clock = createClock();
  const shown = [];
  let attention = true;
  const presenter = new SettingsChangePresenter({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    hasAttention: () => attention,
    present: (surface) => shown.push(surface)
  });

  presenter.enqueue({ changeId: "one", client: "Codex", changes: [] });
  clock.advance(1_000);
  assert.equal(shown.length, 0);
  clock.advance(2_000);
  attention = false;
  clock.advance(500);
  assert.equal(shown.length, 1);

  attention = true;
  presenter.enqueue({ changeId: "two", client: "Codex", changes: [] });
  clock.advance(6_000);
  assert.equal(shown.length, 1);
});

test("the Island and pet panel expose undo and settings actions for notices", () => {
  const card = fs.readFileSync(new URL("../src/renderer/island/components/SettingsChangeCard.js", import.meta.url), "utf8");
  const island = fs.readFileSync(new URL("../src/renderer/island/components/IslandPanel.js", import.meta.url), "utf8");
  const pet = fs.readFileSync(new URL("../src/renderer/pet/panel-app.js", import.meta.url), "utf8");
  assert.match(card, /修改了 WorkIsland 设置/);
  assert.match(card, /undoSettingsChanges/);
  assert.match(card, /撤销/);
  assert.match(card, /查看设置/);
  assert.match(island, /SettingsChangeCard/);
  assert.match(pet, /SettingsChangeCard/);
});
