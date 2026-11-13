import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("production updater forwards fetch through Electron's network stack", async () => {
  const main = await readFile(new URL("../src/main/index.cjs", import.meta.url), "utf8");
  const wiring = main.match(/updateService = createUpdateService\(\{([\s\S]*?)\n  \}\);/);
  assert.ok(wiring, "production updater initialization must be present");
  const transport = wiring[1].match(/fetchImpl:\s*(\([^\n]+?\)\s*=>\s*electron\.net\.fetch\([^\n]+?\)),?\s*\n/);
  assert.ok(transport, "production updater must inject electron.net.fetch instead of default Node fetch");
  const calls = [];
  const response = { ok: true };
  const net = { fetch(url, options) {
    assert.equal(this, net, "Electron net.fetch retains its receiver");
    calls.push({ url, options });
    return response;
  } };
  const fetchImpl = vm.runInNewContext(`(${transport[1]})`, { electron: { net } });
  const options = { headers: { Range: "bytes=4-" }, signal: new AbortController().signal };
  assert.equal(fetchImpl("https://github.com/example.dmg", options), response);
  assert.deepEqual(calls, [{ url: "https://github.com/example.dmg", options }]);
});
