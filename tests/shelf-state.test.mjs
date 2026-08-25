import assert from "node:assert/strict";
import test from "node:test";
import { normalizeShelfPayload, shelfItemId } from "../src/shared/shelf-state.cjs";

test("shelf text and URL payloads are bounded and typed", () => {
  assert.equal(normalizeShelfPayload({ type: "url", value: "https://example.com" }).type, "url");
  assert.equal(normalizeShelfPayload({ type: "text", value: " hello " }).value, "hello");
  assert.equal(normalizeShelfPayload({ type: "text", value: "" }), null);
  assert.equal(normalizeShelfPayload({ type: "html", value: "<b>x</b>" }), null);
});

test("file-backed shelf IDs are deterministic", () => {
  assert.equal(shelfItemId("/tmp/example.txt"), shelfItemId("/tmp/example.txt"));
  assert.notEqual(shelfItemId("/tmp/example.txt"), shelfItemId("/tmp/other.txt"));
});
