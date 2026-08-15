import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const bridgeProtocol = require("../src/main/bridge-protocol.cjs");
const devSource = readFileSync(new URL("../scripts/dev.mjs", import.meta.url), "utf8");

test("isolated development derives a short worktree-specific socket path", () => {
  assert.equal(typeof bridgeProtocol.createDevelopmentSocketPath, "function");
  const socketPath = bridgeProtocol.createDevelopmentSocketPath(
    "/Users/example/a very/deep/worktree/path/that/would/exceed/the/unix/socket/path/limit",
    "/var/folders/example/a-long-temporary-directory"
  );
  assert.ok(Buffer.byteLength(socketPath) < 104);
  assert.match(socketPath, /workisland-[a-f0-9]{16}\.sock$/);
  assert.match(devSource, /FLUX_SOCKET_PATH/);
  assert.match(devSource, /createDevelopmentSocketPath\(root\)/);
});
