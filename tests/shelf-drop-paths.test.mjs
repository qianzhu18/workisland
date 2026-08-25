import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

test("Finder file URL pasteboard data becomes local filesystem paths", () => {
  const { parseFileUriList } = require("../src/shared/shelf-drop-paths.cjs");
  assert.deepEqual(parseFileUriList([
    "# Finder drag",
    "file:///Users/test/Desktop/hello%20world.txt",
    "https://example.com/not-a-file",
    "file:///Users/test/Desktop/hello%20world.txt"
  ].join("\r\n")), ["/Users/test/Desktop/hello world.txt"]);
});
