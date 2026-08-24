import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("native build and package include the pinned MediaRemote Adapter", () => {
  const build = readFileSync(new URL("../scripts/build-native.mjs", import.meta.url), "utf8");
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(build, /v0\.7\.6/);
  assert.match(build, /0891554af8ee8fc1bb1d14ddf023f8e4ce3093387391122c865f7e02c2d1f3de/);
  assert.match(build, /MediaRemoteAdapter\.framework/);
  assert.doesNotMatch(build, /native\/media-bridge/);
  assert.ok(packageJson.build.extraResources.some((entry) => entry.from === "resources/mediaremote-adapter"));
});
