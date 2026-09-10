import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseSshConfig, scanSshConfig, formatSshTarget } = require("../src/main/ssh-config.cjs");

test("parseSshConfig extracts alias, hostName, user and port", () => {
  const entries = parseSshConfig(`
# comment
Host cn-tx
  HostName 118.89.62.40
  User root

Host orb jump
  HostName 127.0.0.1
  Port 32222
  User default

Host *
  Compression yes
`);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries[0], { alias: "cn-tx", hostName: "118.89.62.40", user: "root", port: "22" });
  assert.deepEqual(entries[1], { alias: "orb", hostName: "127.0.0.1", user: "default", port: "32222" });
  assert.deepEqual(entries[2], { alias: "jump", hostName: "127.0.0.1", user: "default", port: "32222" });
});

test("parseSshConfig is case-insensitive and tolerates = separators", () => {
  const entries = parseSshConfig("HOST web\n  HOSTNAME=example.com\n  user=deploy\n");
  assert.deepEqual(entries, [{ alias: "web", hostName: "example.com", user: "deploy", port: "22" }]);
});

test("scanSshConfig returns empty entries when the config is missing", () => {
  const result = scanSshConfig({ homeDir: "/nonexistent-home", readFileSync: () => { throw new Error("enoent"); } });
  assert.deepEqual(result.entries, []);
});

test("scanSshConfig dedupes repeated aliases", () => {
  const result = scanSshConfig({
    homeDir: "/h",
    readFileSync: () => "Host a\n  HostName 1.1.1.1\nHost a\n  HostName 2.2.2.2\n"
  });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].hostName, "1.1.1.1");
});

test("formatSshTarget prefers alias, falls back to user@host with non-default port", () => {
  assert.equal(formatSshTarget({ alias: "cn-tx", hostName: "118.89.62.40", user: "root", port: "22" }), "cn-tx");
  assert.equal(formatSshTarget({ alias: null, hostName: "example.com", user: "deploy", port: "22" }), "deploy@example.com");
  assert.equal(formatSshTarget({ alias: null, hostName: "example.com", user: null, port: "2222" }), "ssh://example.com:2222");
});
