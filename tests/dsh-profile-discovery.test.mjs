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
    port: 3080,
    homeDir: "/Users/bao/Desktop/deepseek-harness-demo/.dsh",
    profileDir: "/Users/bao/Desktop/deepseek-harness-demo/.dsh/profiles/dev"
  }]);
});

test("discovers another user's DSH profile and non-default port without local path assumptions", () => {
  const output = "8301 ?? S 0:00 node /usr/local/bin/dsh --profile research --port=4912 DSH_HOME=/Users/alice/Agents/harness/.dsh HOME=/Users/alice";
  assert.deepEqual(discoverRunningDshProfiles(output), [{
    pid: 8301,
    name: "research",
    port: 4912,
    homeDir: "/Users/alice/Agents/harness/.dsh",
    profileDir: "/Users/alice/Agents/harness/.dsh/profiles/research"
  }]);
});

test("ignores unrelated processes and deduplicates one running profile", () => {
  const dsh = "55307 ?? S 0:00 pnpm dsh --profile=dev DSH_HOME=/tmp/demo/.dsh HOME=/Users/bao";
  const output = `${dsh}\n55328 ?? S 0:00 node dsh --profile dev DSH_HOME=/tmp/demo/.dsh HOME=/Users/bao\n99 ?? S 0:00 node other --profile dev HOME=/Users/bao`;
  assert.equal(discoverRunningDshProfiles(output).length, 1);
});

test("discovers the launcher-started web profile without --profile or DSH_HOME", () => {
  const output = "9233 ?? S 0:00 node /opt/homebrew/lib/node_modules/@deepseek-ai/dsh/lib/bin.js web --port 3080 --no-open HOME=/Users/bao";
  assert.deepEqual(discoverRunningDshProfiles(output, { homeDir: "/Users/bao/.dsh" }), [{
    pid: 9233,
    name: "web",
    port: 3080,
    homeDir: "/Users/bao/.dsh",
    profileDir: "/Users/bao/.dsh/profiles/web"
  }]);
});

test("derives the profile from the DSH subcommand when launched as a bare CLI", () => {
  const output = "4242 ?? S 0:00 /usr/local/bin/dsh tui --port 4000";
  assert.deepEqual(discoverRunningDshProfiles(output, { homeDir: "/Users/bao/.dsh" }), [{
    pid: 4242,
    name: "tui",
    port: 4000,
    homeDir: "/Users/bao/.dsh",
    profileDir: "/Users/bao/.dsh/profiles/tui"
  }]);
});

test("ignores dsh mentions that do not describe a running harness", () => {
  const output = "99 ?? S 0:00 node /tmp/dsh-helper.js --watch\n100 ?? S 0:00 node /tmp/dsh-cache-worker.js";
  assert.deepEqual(discoverRunningDshProfiles(output, { homeDir: "/Users/bao/.dsh" }), []);
});
