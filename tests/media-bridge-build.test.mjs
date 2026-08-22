import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("native build and package include the media bridge executable", () => {
  const build = readFileSync(new URL("../scripts/build-native.mjs", import.meta.url), "utf8");
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(build, /native\/media-bridge\/src\/media_bridge\.mm/);
  assert.match(build, /copyFileSync\(mediaBridge, join\(outDir, "media-bridge"\)\)/);
  assert.ok(packageJson.build.extraResources.some((entry) => entry.from === "resources/bin/media-bridge"));
});
