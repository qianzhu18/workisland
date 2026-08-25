import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("authored Island renderer modules parse as browser ESM", () => {
  const files = [
    "src/renderer/island/app.js",
    "src/renderer/island/components/IslandPanel.js",
    "src/renderer/island/components/IslandPill.js",
    "src/renderer/island/components/MediaCard.js",
    "src/renderer/island/components/PerformancePopover.js",
    "src/renderer/island/components/ClipboardPanel.js",
    "src/renderer/island/components/ShelfPanel.js",
    "src/renderer/island/components/TerminalPanel.js",
    "src/renderer/island/components/ToolboxSwitcher.js"
  ];
  const script = 'const fs=require("fs"),vm=require("vm"); for (const file of process.argv.slice(1)) new vm.SourceTextModule(fs.readFileSync(file,"utf8"),{identifier:file})';
  const result = spawnSync(process.execPath, ["--experimental-vm-modules", "-e", script, ...files], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
