import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { discoverRunningDshProfiles } = require("../src/main/dsh-profile-discovery.cjs");

test("discovers a running custom DSH_HOME and profile from macOS process output", () => {
  const output = "55307 s012 S+ 0:00 node /opt/homebrew/bin/pnpm dsh --profile dev --port 3080 DSH_HOME=/Users/bao/Desktop/deepseek-harness-demo/.dsh TERM_PROGRAM=Apple_Terminal HOME=/Users/bao";
  assert.deepEqual(discoverRunningDshProfiles(output), [{
    pid: 55307,
    name: "dev",
    homeDir: "/Users/bao/Desktop/deepseek-harness-demo/.dsh",
    profileDir: "/Users/bao/Desktop/deepseek-harness-demo/.dsh/profiles/dev"
  }]);
});

test("ignores unrelated processes and deduplicates one running profile", () => {
  const dsh = "55307 ?? S 0:00 pnpm dsh --profile=dev DSH_HOME=/tmp/demo/.dsh HOME=/Users/bao";
  const output = `${dsh}\n55328 ?? S 0:00 node dsh --profile dev DSH_HOME=/tmp/demo/.dsh HOME=/Users/bao\n99 ?? S 0:00 node other --profile dev HOME=/Users/bao`;
  assert.equal(discoverRunningDshProfiles(output).length, 1);
});
