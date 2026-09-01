import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/main/app-coordinator.cjs", import.meta.url), "utf8");

test("the running app owns and injects the local control policy service", () => {
  assert.match(source, /new LocalControlService\s*\(/);
  assert.match(source, /new LocalControlAudit\s*\(/);
  assert.match(source, /new BridgeServer\s*\(\s*\{[\s\S]*controlService:/);
  assert.match(source, /local-agent-control-activity\.json/);
});

test("the control service delegates to existing settings sessions and UI paths", () => {
  for (const contract of [
    /getSettings:\s*\(\)\s*=>\s*this\.getSettings\(\)/,
    /updateSettings:\s*\(partial, source\)\s*=>\s*this\.updateSettings\(partial, source\)/,
    /getSessions:\s*\(\)\s*=>\s*this\.getSessions\(\)/,
    /jumpToSession:\s*\(sessionId\)\s*=>\s*this\.jumpToSession\(sessionId\)/,
    /openSettingsTab:\s*\(section\)\s*=>\s*this\.openSettingsTab\(section\)/,
    /setDisplaySurface:\s*\(surface\)\s*=>\s*this\.setDisplaySurface\(surface\)/
  ]) {
    assert.match(source, contract);
  }
});
