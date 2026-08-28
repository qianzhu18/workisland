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
  ].join("\r\n"), { platform: "darwin" }), ["/Users/test/Desktop/hello world.txt"]);
});

test("Windows file URL data becomes drive and UNC paths", () => {
  const { parseFileUriList } = require("../src/shared/shelf-drop-paths.cjs");
  assert.deepEqual(parseFileUriList("file:///C:/Users/test/hello%20world.txt\nfile://server/share/report.pdf", { platform: "win32" }), [
    "C:\\Users\\test\\hello world.txt",
    "\\\\server\\share\\report.pdf"
  ]);
});
