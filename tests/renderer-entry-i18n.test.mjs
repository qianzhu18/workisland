import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("Island and Welcome initialize locale before first render and rerender in place", () => {
  for (const path of ["../src/renderer/island/app.js", "../src/renderer/assets/welcome-app.js", "../src/renderer/pet/panel-app.js"]) {
    const value = source(path);
    assert.match(value, /initializeI18n/);
    assert.match(value, /await initializeI18n/);
    assert.match(value, /onLocaleChange/);
  }
});

test("terminal and welcome visible copy use semantic catalog keys", () => {
  const terminal = source("../src/renderer/island/components/TerminalPanel.js");
  const welcome = source("../src/renderer/assets/welcome-view.js");
  assert.match(terminal, /t\("terminal\.full\.title"\)/);
  assert.match(terminal, /t\("terminal\.quick\.empty\.action"\)/);
  assert.doesNotMatch(terminal, /进入完整终端|前往设置添加|重新启动终端/);
  assert.match(welcome, /t\("welcome\.description\./);
  assert.match(welcome, /t\("welcome\.action\.enter"\)/);
  assert.doesNotMatch(welcome, /进入 WorkIsland|本地运行|桌宠模式/);
});
